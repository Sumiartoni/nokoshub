import { prisma } from '../../database/prisma.client';
import type { ProviderCountry, ProviderPrice, ProviderService } from '../providers/herosms.provider';
import { buildProviderPriceId, getConfiguredOtpProviders } from '../providers/provider-runtime';
import { getProviderDescriptor, parseProviderKeyFromPriceId } from '../providers/provider-registry';
import { calculateSellPrice } from '../../utils/helpers';
import logger from '../../utils/logger';
import { pricingService } from '../pricing/pricing.service';

type SyncResult = { services: number; prices: number; skipped?: boolean };

let providerSyncRunning = false;

export const serviceService = {
    /**
     * Sync services, countries, and prices from every configured OTP provider.
     */
    async syncFromProvider(): Promise<SyncResult> {
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
            const sellPriceMultiplier = await pricingService.getSellPriceMultiplier();
            const [existingServices, existingCountries] = await Promise.all([
                prisma.service.findMany({
                    select: { id: true, name: true, serviceCode: true, isActive: true },
                }),
                prisma.country.findMany({
                    select: { id: true, name: true, countryCode: true, isActive: true },
                }),
            ]);

            const servicesByCode = new Map(existingServices.map((service) => [service.serviceCode, service]));
            const servicesByName = new Map(existingServices.map((service) => [normalizeServiceName(service.name), service]));
            const countriesByCode = new Map(existingCountries.map((country) => [country.countryCode, country]));

            for (const { providerKey, provider, descriptor } of providers) {
                const services = await provider.getServices();
                if (!services.length) {
                    logger.warn({ providerKey }, 'No services returned from provider');
                    continue;
                }

                for (const svc of services) {
                    if (!svc.service_code || !svc.service_name) continue;

                    const service = await ensureServiceRecord(
                        providerKey,
                        svc,
                        servicesByCode,
                        servicesByName
                    );
                    servicesCount++;

                    const countries = await provider.getCountries(svc.service_code);

                    for (const ctr of countries) {
                        if (!ctr.name || !ctr.number_id || !Array.isArray(ctr.pricelist)) continue;

                        const country = await ensureCountryRecord(ctr, countriesByCode);
                        const validPrices = ctr.pricelist
                            .map((price) =>
                                normalizePriceForSync(
                                    providerKey,
                                    price,
                                    sellPriceMultiplier,
                                    String(svc.service_code),
                                    String(ctr.number_id)
                                )
                            )
                            .filter((price): price is NormalizedPriceForSync => Boolean(price));

                        if (validPrices.length === 0) continue;

                        const inserted = await bulkUpsertPrices(service.id, country.id, validPrices, {
                            providerKey,
                            countryName: ctr.name,
                            serviceName: svc.service_name,
                            providerLabel: descriptor.displayName,
                        });
                        pricesCount += inserted;
                    }
                }
            }

            logger.info({ servicesCount, pricesCount }, 'Provider sync completed');
            return { services: servicesCount, prices: pricesCount };
        } finally {
            providerSyncRunning = false;
        }
    },

    /** List all active services */
    async getServices() {
        return prisma.service.findMany({
            where: { isActive: true },
            orderBy: { id: 'asc' },
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

    async recalculateSellPrices(multiplier: number, usdIdrRate?: number) {
        if (usdIdrRate && Number.isFinite(usdIdrRate) && usdIdrRate > 0) {
            await prisma.$executeRaw`
                UPDATE "Price"
                SET "providerPrice" = CASE
                        WHEN "providerPriceUsd" IS NOT NULL THEN CEIL("providerPriceUsd" * ${usdIdrRate}::numeric)::integer
                        ELSE "providerPrice"
                    END,
                    "sellPrice" = CASE
                        WHEN "providerPriceUsd" IS NOT NULL THEN CEIL(CEIL("providerPriceUsd" * ${usdIdrRate}::numeric) * ${multiplier}::numeric)::integer
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
    serviceCode: string,
    countryCode: string
): NormalizedPriceForSync | null {
    if (!price.provider_id) return null;

    const providerPrice = Math.ceil(Number(price.price));
    if (!Number.isFinite(providerPrice) || providerPrice <= 0) return null;

    const sellPrice = calculateSellPrice(providerPrice, multiplier);
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
    servicesByCode: Map<string, { id: string; name: string; serviceCode: string; isActive: boolean }>,
    servicesByName: Map<string, { id: string; name: string; serviceCode: string; isActive: boolean }>
) {
    const providerServiceCode = String(svc.service_code);
    const normalizedName = normalizeServiceName(svc.service_name);
    const compositeServiceCode = buildStoredServiceCode(providerKey, providerServiceCode);

    const existing =
        (providerKey === 'herosms' ? servicesByCode.get(providerServiceCode) : null) ??
        servicesByCode.get(compositeServiceCode) ??
        servicesByName.get(normalizedName);

    if (existing) {
        const updated = await prisma.service.update({
            where: { id: existing.id },
            data: { name: svc.service_name, isActive: true },
        });
        servicesByCode.set(updated.serviceCode, updated);
        servicesByName.set(normalizedName, updated);
        return updated;
    }

    const created = await prisma.service.create({
        data: {
            name: svc.service_name,
            serviceCode: providerKey === 'herosms' ? providerServiceCode : compositeServiceCode,
            isActive: true,
        },
    });
    servicesByCode.set(created.serviceCode, created);
    servicesByName.set(normalizedName, created);
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
            "providerPrice" = EXCLUDED."providerPrice",
            "providerPriceUsd" = EXCLUDED."providerPriceUsd",
            "sellPrice" = EXCLUDED."sellPrice",
            "isActive" = true,
            "updatedAt" = EXCLUDED."updatedAt";
        `;

        try {
            await prisma.$executeRawUnsafe(query);
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

function buildStoredServiceCode(providerKey: 'server1' | 'herosms', serviceCode: string) {
    if (providerKey === 'herosms') return serviceCode;
    return `${providerKey}__${serviceCode}`;
}

function normalizeServiceName(name: string) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(otp|sms|verification|receive|number|virtual)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sqlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
