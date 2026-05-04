import { prisma } from '../../database/prisma.client';
import { buildHeroSMSPriceId, heroSMSProvider } from '../providers/herosms.provider';
import { getProviderDescriptor, parseProviderKeyFromPriceId } from '../providers/provider-registry';
import { calculateSellPrice } from '../../utils/helpers';
import logger from '../../utils/logger';
import { pricingService } from '../pricing/pricing.service';

type SyncResult = { services: number; prices: number; skipped?: boolean };

let providerSyncRunning = false;

export const serviceService = {
    /**
     * Sync services, countries, and prices from HeroSMS.
     * 1. Fetch all services → upsert into DB
     * 2. For each service, fetch countries → upsert countries + prices
     */
    async syncFromProvider(): Promise<SyncResult> {
        if (providerSyncRunning) {
            logger.info('Provider sync already running, skipping duplicate request');
            return { services: 0, prices: 0, skipped: true };
        }

        providerSyncRunning = true;
        logger.info('Starting provider sync...');

        try {
            const services = await heroSMSProvider.getServices();
            if (!services.length) {
                logger.warn('No services returned from provider');
                return { services: 0, prices: 0 };
            }

            let servicesCount = 0;
            let pricesCount = 0;
            const sellPriceMultiplier = await pricingService.getSellPriceMultiplier();
            for (const svc of services) {
                if (!svc.service_code || !svc.service_name) continue;

                // Upsert service
                const serviceCode = String(svc.service_code);
                const service = await prisma.service.upsert({
                    where: { serviceCode },
                    update: { name: svc.service_name, isActive: true },
                    create: { name: svc.service_name, serviceCode, isActive: true },
                });
                servicesCount++;

                // Fetch countries for this service
                const countries = await heroSMSProvider.getCountries(svc.service_code);

                for (const ctr of countries) {
                    if (!ctr.name || !ctr.number_id || !Array.isArray(ctr.pricelist)) continue;

                    const countryCode = String(ctr.number_id);
                    const country = await prisma.country.upsert({
                        where: { countryCode },
                        update: { name: ctr.name, isActive: true },
                        create: { name: ctr.name, countryCode, isActive: true },
                    });

                    const validPrices = ctr.pricelist
                        .map((price) => normalizePriceForSync(
                            price,
                            sellPriceMultiplier,
                            serviceCode,
                            countryCode
                        ))
                        .filter((price): price is NormalizedPriceForSync => Boolean(price));

                    if (validPrices.length === 0) continue;

                    // We must do a raw SQL bulk upsert because Prisma has no `upsertMany`
                    // Split into chunks of 500 to avoid Postgres payload/parameter limits
                    const CHUNK_SIZE = 500;
                    for (let i = 0; i < validPrices.length; i += CHUNK_SIZE) {
                        const chunk = validPrices.slice(i, i + CHUNK_SIZE);
                        const values = chunk.map(price => `(
                            gen_random_uuid()::text,
                            ${sqlString(service.id)},
                            ${sqlString(country.id)},
                            ${sqlString(price.priceId)},
                            ${price.providerPrice}::integer,
                            ${price.providerPriceUsd ?? 'NULL'}::numeric,
                            ${price.sellPrice}::integer,
                            true,
                            current_timestamp(3)
                        )`).join(', ');

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
                            pricesCount += chunk.length;
                        } catch (err: any) {
                            logger.error(
                                { err: err.message, country: ctr.name, service: svc.service_name },
                                'Raw bulk upsert failed for chunk'
                            );
                        }
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
    price: { provider_id?: string; price?: number; provider_price_usd?: number | null },
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
        priceId: buildHeroSMSPriceId(serviceCode, countryCode, String(price.provider_id)),
        providerPrice,
        providerPriceUsd,
        sellPrice,
    };
}

function sqlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
