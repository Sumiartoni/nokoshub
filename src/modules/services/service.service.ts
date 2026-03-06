import { prisma } from '../../database/prisma.client';
import { rumahOTPProvider } from '../providers/rumahotp.provider';
import { calculateSellPrice } from '../../utils/helpers';
import { config } from '../../app/config';
import logger from '../../utils/logger';

export const serviceService = {
    /**
     * Sync all services, countries, and prices from RumahOTP into the database.
     * Runs on startup and can be triggered manually via admin API.
     */
    async syncFromProvider(): Promise<{ services: number; prices: number }> {
        logger.info('Starting provider sync...');
        const items = await rumahOTPProvider.getServices();

        let servicesCount = 0;
        let pricesCount = 0;

        for (const item of items) {
            // Skip items with missing required fields
            if (!item.service || !item.country || !item.price_id) {
                logger.warn({ item }, 'Skipping item with missing fields');
                continue;
            }

            // Upsert service
            const service = await prisma.service.upsert({
                where: { serviceCode: item.service },
                update: { name: item.service },
                create: { name: item.service, serviceCode: item.service },
            });
            servicesCount++;

            // Upsert country
            const country = await prisma.country.upsert({
                where: { countryCode: item.country },
                update: { name: item.country },
                create: { name: item.country, countryCode: item.country },
            });

            // Upsert price
            const sellPrice = calculateSellPrice(item.price, config.SELL_PRICE_MULTIPLIER);
            await prisma.price.upsert({
                where: { priceId: item.price_id },
                update: { providerPrice: item.price, sellPrice },
                create: {
                    serviceId: service.id,
                    countryId: country.id,
                    priceId: item.price_id,
                    providerPrice: item.price,
                    sellPrice,
                },
            });
            pricesCount++;
        }

        logger.info({ servicesCount, pricesCount }, 'Provider sync completed');
        return { services: servicesCount, prices: pricesCount };
    },

    /** List all active services */
    async getServices() {
        return prisma.service.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });
    },

    /** List countries that have prices for a given service */
    async getCountriesByService(serviceId: string) {
        const prices = await prisma.price.findMany({
            where: { serviceId, isActive: true },
            include: { country: true },
            distinct: ['countryId'],
        });
        return prices.map((p) => p.country).filter((c) => c.isActive);
    },

    /** List all active countries */
    async getCountries() {
        return prisma.country.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });
    },

    /** Get prices for a service + country combination, sorted ascending by sellPrice */
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
