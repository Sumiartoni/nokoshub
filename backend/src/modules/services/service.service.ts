import { prisma } from '../../database/prisma.client';
import type { ProviderCountry, ProviderPrice, ProviderService } from '../providers/herosms.provider';
import { buildProviderPriceId, getConfiguredOtpProviders } from '../providers/provider-runtime';
import { getProviderDescriptor, parseProviderKeyFromPriceId } from '../providers/provider-registry';
import { calculateSellPrice } from '../../utils/helpers';
import logger from '../../utils/logger';
import { pricingService } from '../pricing/pricing.service';

type SyncResult = { services: number; prices: number; skipped?: boolean };
type ProviderSyncBreakdown = {
    providerKey: string;
    providerLabel: string;
    services: number;
    prices: number;
};

let providerSyncRunning = false;

export function isProviderSyncRunning() {
    return providerSyncRunning;
}

export const serviceService = {
    /**
     * Sync services, countries, and prices from every configured OTP provider.
     */
    async syncFromProvider(): Promise<SyncResult & { providers?: ProviderSyncBreakdown[] }> {
        if (providerSyncRunning) {
            logger.info('Provider sync already running, skipping duplicate request');
            return { services: 0, prices: 0, skipped: true };
        }

        providerSyncRunning = true;
        logger.info('Starting provider sync...');

        try {
            const providers = getConfiguredOtpProviders();
            if (!providers.length) {
                logger.warn('No OTP providers configured for sync');
                return { services: 0, prices: 0 };
            }

            let servicesCount = 0;
            let pricesCount = 0;
            const providerBreakdown: ProviderSyncBreakdown[] = [];
            const [sellPriceMultiplier, pricingProtectionPercent] = await Promise.all([
                pricingService.getSellPriceMultiplier(),
                pricingService.getPricingProtectionPercent(),
            ]);
            const [existingServices, existingCountries] = await Promise.all([
                prisma.service.findMany({
                    select: { id: true, name: true, serviceCode: true, isActive: true },
                }),
                prisma.country.findMany({
                    select: { id: true, name: true, countryCode: true, isActive: true },
                }),
            ]);

            const servicesByCode = new Map(existingServices.map((service) => [service.serviceCode, service]));
            const countriesByCode = new Map(existingCountries.map((country) => [country.countryCode, country]));

            for (const { providerKey, provider, descriptor } of providers) {
                const services = await provider.getServices();
                if (!services.length) {
                    logger.warn({ providerKey }, 'No services returned from provider');
                    providerBreakdown.push({
                        providerKey,
                        providerLabel: descriptor.displayName,
                        services: 0,
                        prices: 0,
                    });
                    continue;
                }

                let providerServicesCount = 0;
                let providerPricesCount = 0;
                for (const svc of services) {
                    if (!svc.service_code || !svc.service_name) continue;

                    const service = await ensureServiceRecord(
                        providerKey,
                        svc,
                        servicesByCode
                    );
                    servicesCount++;
                    providerServicesCount++;

                    const countries = await provider.getCountries(svc.service_code);
                    const activePriceIdsForService = new Set<string>();

                    for (const ctr of countries) {
                        if (!ctr.name || !ctr.number_id || !Array.isArray(ctr.pricelist)) continue;

                        const country = await ensureCountryRecord(ctr, countriesByCode);
                        const validPrices = ctr.pricelist
                            .map((price) =>
                                normalizePriceForSync(
                                    providerKey,
                                    price,
                                    sellPriceMultiplier,
                                    pricingProtectionPercent,
                                    String(svc.service_code),
                                    String(ctr.number_id)
                                )
                            )
                            .filter((price): price is NormalizedPriceForSync => Boolean(price));

                        if (validPrices.length === 0) continue;

                        validPrices.forEach((price) => activePriceIdsForService.add(price.priceId));

                        const inserted = await bulkUpsertPrices(service.id, country.id, validPrices, {
                            providerKey,
                            countryName: ctr.name,
                            serviceName: svc.service_name,
                            providerLabel: descriptor.displayName,
                        });
                        pricesCount += inserted;
                        providerPricesCount += inserted;
                    }

                    await deactivateStalePricesForService(service.id, providerKey, activePriceIdsForService);
                }

                providerBreakdown.push({
                    providerKey,
                    providerLabel: descriptor.displayName,
                    services: providerServicesCount,
                    prices: providerPricesCount,
                });
                logger.info(
                    { providerKey, providerLabel: descriptor.displayName, services: providerServicesCount, prices: providerPricesCount },
                    'Provider sync finished'
                );
            }

            logger.info({ servicesCount, pricesCount, providers: providerBreakdown }, 'Provider sync completed');
            return { services: servicesCount, prices: pricesCount, providers: providerBreakdown };
        } finally {
            providerSyncRunning = false;
        }
    },

    /** List all active services */
    async getServices() {
        const services = await prisma.service.findMany({
            where: { isActive: true },
            orderBy: { id: 'asc' },
        });
        return services.map((service) => ({
            ...service,
            ...describeServiceProvider(service.serviceCode),
        }));
    },

    async getServicesWithStats(includeInactive = true) {
        const services = await prisma.service.findMany({
            where: includeInactive ? undefined : { isActive: true },
            orderBy: { id: 'asc' },
        });
        const serviceIds = services.map((service) => service.id);
        const priceStats = serviceIds.length
            ? await prisma.price.groupBy({
                by: ['serviceId'],
                where: { serviceId: { in: serviceIds }, isActive: true },
                _min: { sellPrice: true },
                _count: { _all: true },
            })
            : [];
        const statsByService = new Map(priceStats.map((stat) => [stat.serviceId, stat]));

        return services.map((service) => {
            const stat = statsByService.get(service.id);
            return {
                ...service,
                ...describeServiceProvider(service.serviceCode),
                minSellPrice: stat?._min.sellPrice ?? null,
                priceCount: stat?._count._all ?? 0,
            };
        });
    },

    /** List countries that have prices for a given service */
    async getCountriesByService(serviceId: string) {
        const prices = await prisma.price.findMany({
            where: { serviceId, isActive: true },
            include: { country: true },
            distinct: ['countryId'],
            orderBy: { countryId: 'asc' }
        });
        return prices.map((p) => p.country).filter((c) => c.isActive).sort((a, b) => a.id.localeCompare(b.id));
    },

    /** List countries that have prices for a given service, including cheapest sell price */
    async getCountriesWithPriceByService(serviceId: string) {
        const prices = await prisma.price.findMany({
            where: {
                serviceId,
                isActive: true,
                country: { isActive: true },
            },
            include: { country: true },
            orderBy: [{ countryId: 'asc' }, { sellPrice: 'asc' }],
        });

        const countries = new Map<string, {
            id: string;
            name: string;
            countryCode: string;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
            minSellPrice: number;
            priceId: string;
            priceCount: number;
        }>();

        for (const price of prices) {
            const existing = countries.get(price.countryId);
            if (!existing) {
                countries.set(price.countryId, {
                    ...price.country,
                    minSellPrice: price.sellPrice,
                    priceId: price.id,
                    priceCount: 1,
                });
                continue;
            }

            existing.priceCount += 1;
            if (price.sellPrice < existing.minSellPrice) {
                existing.minSellPrice = price.sellPrice;
                existing.priceId = price.id;
            }
        }

        return [...countries.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    /** List all active countries */
    async getCountries() {
        return prisma.country.findMany({
            where: { isActive: true },
            orderBy: { id: 'asc' },
        });
    },

    /** Get prices for a service + country combination */
    async getPrices(serviceId: string, countryId: string) {
        const prices = await prisma.price.findMany({
            where: { serviceId, countryId, isActive: true },
            orderBy: { sellPrice: 'asc' },
        });

        return prices
            .map((price) => {
                const providerKey = parseProviderKeyFromPriceId(price.priceId);
                const provider = getProviderDescriptor(providerKey);
                return {
                    ...price,
                    providerKey,
                    providerLabel: provider.displayName,
                    serverLabel: provider.serverLabel,
                    providerSortOrder: provider.sortOrder,
                };
            })
            .sort((a, b) => {
                if (a.sellPrice !== b.sellPrice) return a.sellPrice - b.sellPrice;
                if (a.providerSortOrder !== b.providerSortOrder) return a.providerSortOrder - b.providerSortOrder;
                return a.providerLabel.localeCompare(b.providerLabel);
            });
    },

    /** Get a single price by its internal id */
    async getPriceById(id: string) {
        return prisma.price.findUnique({
            where: { id },
            include: { service: true, country: true },
        });
    },

    async recalculateSellPrices(multiplier: number, usdIdrRate?: number, pricingProtectionPercent = 0) {
        const protectionFactor = 1 + (Math.max(0, pricingProtectionPercent) / 100);
        if (usdIdrRate && Number.isFinite(usdIdrRate) && usdIdrRate > 0) {
            await prisma.$executeRaw`
                UPDATE "Price"
                SET "providerPrice" = CASE
                        WHEN "providerPriceUsd" IS NOT NULL THEN CEIL("providerPriceUsd" * ${usdIdrRate}::numeric)::integer
                        ELSE "providerPrice"
                    END,
                    "sellPrice" = CASE
                        WHEN "providerPriceUsd" IS NOT NULL THEN CEIL((CEIL("providerPriceUsd" * ${usdIdrRate}::numeric) * ${protectionFactor}::numeric) * ${multiplier}::numeric)::integer
                        ELSE CEIL("providerPrice"::numeric * ${multiplier}::numeric)::integer
                    END,
                    "updatedAt" = current_timestamp(3);
            `;
            return;
        }

        await prisma.$executeRaw`
            UPDATE "Price"
            SET "sellPrice" = CEIL("providerPrice"::numeric * ${multiplier}::numeric)::integer,
                "updatedAt" = current_timestamp(3);
        `;
    },
};

async function withDeadlockRetry<T>(task: () => Promise<T>, label: string, meta?: Record<string, unknown>): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < 3) {
        attempt += 1;
        try {
            return await task();
        } catch (err: any) {
            lastError = err;
            const code = String(err?.code || err?.meta?.code || '');
            const message = String(err?.message || '');
            const isDeadlock = code === '40P01' || message.toLowerCase().includes('deadlock detected');
            if (!isDeadlock || attempt >= 3) {
                throw err;
            }

            const retryMs = attempt * 250;
            logger.warn({ label, attempt, retryMs, code, ...meta }, 'Deadlock detected, retrying database operation');
            await new Promise((resolve) => setTimeout(resolve, retryMs));
        }
    }

    throw lastError;
}

interface NormalizedPriceForSync {
    priceId: string;
    providerPrice: number;
    providerPriceUsd: string | null;
    sellPrice: number;
}

function normalizePriceForSync(
    providerKey: 'server1' | 'herosms',
    price: ProviderPrice,
    multiplier: number,
    pricingProtectionPercent: number,
    serviceCode: string,
    countryCode: string
): NormalizedPriceForSync | null {
    if (!price.provider_id) return null;

    const providerPrice = Math.ceil(Number(price.price));
    if (!Number.isFinite(providerPrice) || providerPrice <= 0) return null;

    const protectionPercent = price.provider_price_usd !== null ? pricingProtectionPercent : 0;
    const sellPrice = calculateSellPrice(providerPrice, multiplier, protectionPercent);
    if (!Number.isFinite(sellPrice) || sellPrice <= 0) return null;

    const providerPriceUsd = typeof price.provider_price_usd === 'number' && Number.isFinite(price.provider_price_usd)
        ? price.provider_price_usd.toFixed(6)
        : null;

    return {
        priceId: buildProviderPriceId(providerKey, serviceCode, countryCode, String(price.provider_id)),
        providerPrice,
        providerPriceUsd,
        sellPrice,
    };
}

async function ensureServiceRecord(
    providerKey: 'server1' | 'herosms',
    svc: ProviderService,
    servicesByCode: Map<string, { id: string; name: string; serviceCode: string; isActive: boolean }>
) {
    const providerServiceCode = String(svc.service_code);
    const compositeServiceCode = buildStoredServiceCode(providerKey, providerServiceCode);

    const existing = servicesByCode.get(compositeServiceCode);

    if (existing) {
        const updated = await prisma.service.update({
            where: { id: existing.id },
            data: { name: svc.service_name, isActive: true },
        });
        servicesByCode.set(updated.serviceCode, updated);
        return updated;
    }

    const created = await prisma.service.create({
        data: {
            name: svc.service_name,
            serviceCode: compositeServiceCode,
            isActive: true,
        },
    });
    servicesByCode.set(created.serviceCode, created);
    return created;
}

async function ensureCountryRecord(
    ctr: ProviderCountry,
    countriesByCode: Map<string, { id: string; name: string; countryCode: string; isActive: boolean }>
) {
    const countryCode = String(ctr.number_id);
    const existing = countriesByCode.get(countryCode);
    if (existing) {
        const updated = await prisma.country.update({
            where: { id: existing.id },
            data: { name: ctr.name, isActive: true },
        });
        countriesByCode.set(updated.countryCode, updated);
        return updated;
    }

    const created = await prisma.country.create({
        data: { name: ctr.name, countryCode, isActive: true },
    });
    countriesByCode.set(created.countryCode, created);
    return created;
}

async function bulkUpsertPrices(
    serviceId: string,
    countryId: string,
    validPrices: NormalizedPriceForSync[],
    meta: { providerKey: string; providerLabel: string; countryName: string; serviceName: string }
) {
    let inserted = 0;
    const CHUNK_SIZE = 500;
    for (let i = 0; i < validPrices.length; i += CHUNK_SIZE) {
        const chunk = validPrices.slice(i, i + CHUNK_SIZE);
        const values = chunk
            .map(
                (price) => `(
                    gen_random_uuid()::text,
                    ${sqlString(serviceId)},
                    ${sqlString(countryId)},
                    ${sqlString(price.priceId)},
                    ${price.providerPrice}::integer,
                    ${price.providerPriceUsd ?? 'NULL'}::numeric,
                    ${price.sellPrice}::integer,
                    true,
                    current_timestamp(3)
                )`
            )
            .join(', ');

        const query = `
            INSERT INTO "Price" ("id", "serviceId", "countryId", "priceId", "providerPrice", "providerPriceUsd", "sellPrice", "isActive", "updatedAt")
            VALUES ${values}
            ON CONFLICT ("priceId") DO UPDATE SET
            "serviceId" = EXCLUDED."serviceId",
            "countryId" = EXCLUDED."countryId",
            "providerPrice" = EXCLUDED."providerPrice",
            "providerPriceUsd" = EXCLUDED."providerPriceUsd",
            "sellPrice" = EXCLUDED."sellPrice",
            "isActive" = true,
            "updatedAt" = EXCLUDED."updatedAt";
        `;

        try {
            await withDeadlockRetry(
                () => prisma.$executeRawUnsafe(query),
                'price_bulk_upsert',
                {
                    providerKey: meta.providerKey,
                    provider: meta.providerLabel,
                    country: meta.countryName,
                    service: meta.serviceName,
                }
            );
            inserted += chunk.length;
        } catch (err: any) {
            logger.error(
                {
                    err: err.message,
                    providerKey: meta.providerKey,
                    provider: meta.providerLabel,
                    country: meta.countryName,
                    service: meta.serviceName,
                },
                'Raw bulk upsert failed for chunk'
            );
        }
    }

    return inserted;
}

async function deactivateStalePricesForService(
    serviceId: string,
    providerKey: string,
    activePriceIds: Set<string>
) {
    const providerPrefix = `${providerKey}:`;
    const activeIds = [...activePriceIds];

    if (!activeIds.length) {
        await withDeadlockRetry(
            () => prisma.price.updateMany({
                where: {
                    serviceId,
                    isActive: true,
                    priceId: { startsWith: providerPrefix },
                },
                data: { isActive: false },
            }),
            'deactivate_stale_prices',
            { serviceId, providerKey, mode: 'all' }
        );
        return;
    }

    await withDeadlockRetry(
        () => prisma.price.updateMany({
            where: {
                serviceId,
                isActive: true,
                priceId: { startsWith: providerPrefix, notIn: activeIds },
            },
            data: { isActive: false },
        }),
        'deactivate_stale_prices',
        { serviceId, providerKey, mode: 'diff', activeCount: activeIds.length }
    );
}

function buildStoredServiceCode(providerKey: 'server1' | 'herosms', serviceCode: string) {
    return `${providerKey}__${serviceCode}`;
}

function describeServiceProvider(serviceCode: string) {
    const [providerKey] = String(serviceCode || '').split('__');
    const provider = getProviderDescriptor(providerKey);
    return {
        providerKey: provider.key,
        providerLabel: provider.displayName,
        serverLabel: provider.serverLabel,
    };
}

function sqlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
