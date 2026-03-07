import { prisma } from '../../database/prisma.client';
import { rumahOTPProvider } from '../providers/rumahotp.provider';
import { calculateSellPrice } from '../../utils/helpers';
import { config } from '../../app/config';
import logger from '../../utils/logger';

export const serviceService = {
    /**
     * Sync services and countries from RumahOTP V2 API.
     * 1. Fetch all services → upsert into DB
     * 2. For each service, fetch countries → upsert countries + prices
     */
    async syncFromProvider(): Promise<{ services: number; prices: number }> {
        logger.info('Starting provider sync...');

        const services = await rumahOTPProvider.getServices();
        if (!services.length) {
            logger.warn('No services returned from provider');
            return { services: 0, prices: 0 };
        }

        let servicesCount = 0;
        let pricesCount = 0;

        for (const svc of services) {
            if (!svc.service_code || !svc.service_name) continue;

            // Upsert service
            const serviceCode = String(svc.service_code);
            const service = await prisma.service.upsert({
                where: { serviceCode },
                update: { name: svc.service_name },
                create: { name: svc.service_name, serviceCode },
            });
            servicesCount++;

            // Fetch countries for this service
            const countries = await rumahOTPProvider.getCountries(svc.service_code);

            for (const ctr of countries) {
                if (!ctr.name || !ctr.number_id || !Array.isArray(ctr.pricelist)) continue;

                const countryCode = String(ctr.number_id);
                const country = await prisma.country.upsert({
                    where: { countryCode },
                    update: { name: ctr.name },
                    create: { name: ctr.name, countryCode },
                });

                // Filter valid prices and map them for raw bulk insert
                const validPrices = ctr.pricelist.filter(p => p.provider_id && p.price);
                if (validPrices.length === 0) continue;

                // We must do a raw SQL bulk upsert because Prisma has no `upsertMany`
                // Split into chunks of 500 to avoid Postgres payload/parameter limits
                const CHUNK_SIZE = 500;
                for (let i = 0; i < validPrices.length; i += CHUNK_SIZE) {
                    const chunk = validPrices.slice(i, i + CHUNK_SIZE);
                    const values = chunk.map(price => {
                        const priceId = `${svc.service_code}_${ctr.number_id}_${price.provider_id}`;
                        const sellPrice = calculateSellPrice(price.price, config.SELL_PRICE_MULTIPLIER);
                        return `(gen_random_uuid(), '${service.id}', '${country.id}', '${priceId}', ${price.price}, ${sellPrice}, current_timestamp(3))`;
                    }).join(', ');

                    const query = `
                        INSERT INTO "Price" ("id", "serviceId", "countryId", "priceId", "providerPrice", "sellPrice", "updatedAt")
                        VALUES ${values}
                        ON CONFLICT ("priceId") DO UPDATE SET
                        "providerPrice" = EXCLUDED."providerPrice",
                        "sellPrice" = EXCLUDED."sellPrice",
                        "updatedAt" = EXCLUDED."updatedAt";
                    `;

                    try {
                        await prisma.$executeRawUnsafe(query);
                        pricesCount += chunk.length;
                    } catch (err: any) {
                        logger.error({ err: err.message, country: ctr.name, service: svc.service_name }, 'Raw bulk upsert failed for chunk');
                    }
                }
            }
        }

        logger.info({ servicesCount, pricesCount }, 'Provider sync completed');
        return { services: servicesCount, prices: pricesCount };
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

    /** List all active countries */
    async getCountries() {
        return prisma.country.findMany({
            where: { isActive: true },
            orderBy: { id: 'asc' },
        });
    },

    /** Get prices for a service + country combination */
    async getPrices(serviceId: string, countryId: string) {
        return prisma.price.findMany({
            where: { serviceId, countryId, isActive: true },
            orderBy: { sellPrice: 'asc' },
        });
    },

    /** Get a single price by its internal id */
    async getPriceById(id: string) {
        return prisma.price.findUnique({
            where: { id },
            include: { service: true, country: true },
        });
    },
};
