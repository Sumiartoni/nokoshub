import axios from 'axios';
import { config } from '../../app/config';
import { prisma } from '../../database/prisma.client';
import logger from '../../utils/logger';

const SELL_PRICE_MULTIPLIER_KEY = 'sell_price_multiplier';

export interface UsdIdrRateInfo {
    baseRate: number;
    effectiveRate: number;
    bufferPercent: number;
    autoEnabled: boolean;
    source: string;
    fetchedAt: string;
    fallbackRate: number;
    error?: string;
}

let rateCache: { expiresAt: number; info: UsdIdrRateInfo } | null = null;

export const pricingService = {
    async getSellPriceMultiplier(): Promise<number> {
        const setting = await prisma.appSetting.findUnique({
            where: { key: SELL_PRICE_MULTIPLIER_KEY },
        });

        const value = Number(setting?.value ?? config.SELL_PRICE_MULTIPLIER);
        return Number.isFinite(value) && value > 0 ? value : config.SELL_PRICE_MULTIPLIER;
    },

    async setSellPriceMultiplier(multiplier: number): Promise<number> {
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
            throw new Error('Multiplier harus lebih besar dari 0');
        }

        const normalized = Number(multiplier.toFixed(4));
        await prisma.appSetting.upsert({
            where: { key: SELL_PRICE_MULTIPLIER_KEY },
            update: { value: String(normalized) },
            create: { key: SELL_PRICE_MULTIPLIER_KEY, value: String(normalized) },
        });

        return normalized;
    },

    async getUsdIdrRate(forceRefresh = false): Promise<UsdIdrRateInfo> {
        const now = Date.now();
        if (!forceRefresh && rateCache && rateCache.expiresAt > now) {
            return rateCache.info;
        }

        const fallbackRate = positiveNumber(config.HERO_SMS_PRICE_TO_IDR_RATE, 17000);
        const bufferPercent = Math.max(0, positiveNumber(config.USD_IDR_RATE_BUFFER_PERCENT, 3));
        let info: UsdIdrRateInfo;

        if (!config.USD_IDR_RATE_AUTO_ENABLED) {
            info = buildRateInfo(fallbackRate, bufferPercent, false, 'env:HERO_SMS_PRICE_TO_IDR_RATE', fallbackRate);
        } else {
            try {
                const response = await axios.get(config.USD_IDR_RATE_API_URL, {
                    timeout: 10000,
                    headers: { Accept: 'application/json' },
                });
                const rate = extractUsdIdrRate(response.data);
                if (!rate) throw new Error('USD/IDR rate not found in response');

                info = buildRateInfo(rate, bufferPercent, true, config.USD_IDR_RATE_API_URL, fallbackRate);
            } catch (err: any) {
                logger.warn(
                    { err: { message: err.message, status: err.response?.status, data: err.response?.data } },
                    'USD/IDR auto rate fetch failed, using fallback rate'
                );
                info = buildRateInfo(fallbackRate, bufferPercent, true, 'fallback:HERO_SMS_PRICE_TO_IDR_RATE', fallbackRate, err.message);
            }
        }

        rateCache = {
            info,
            expiresAt: now + Math.max(1, config.USD_IDR_RATE_REFRESH_MINUTES) * 60 * 1000,
        };

        return info;
    },

    async getPricingSnapshot(forceRefresh = false) {
        const [sellPriceMultiplier, usdIdrRate] = await Promise.all([
            this.getSellPriceMultiplier(),
            this.getUsdIdrRate(forceRefresh),
        ]);

        return { sellPriceMultiplier, usdIdrRate };
    },
};

function buildRateInfo(
    baseRate: number,
    bufferPercent: number,
    autoEnabled: boolean,
    source: string,
    fallbackRate: number,
    error?: string
): UsdIdrRateInfo {
    return {
        baseRate,
        effectiveRate: Math.ceil(baseRate * (1 + bufferPercent / 100)),
        bufferPercent,
        autoEnabled,
        source,
        fetchedAt: new Date().toISOString(),
        fallbackRate,
        ...(error ? { error } : {}),
    };
}

function positiveNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function extractUsdIdrRate(data: any): number | null {
    const raw =
        data?.rate ??
        data?.rates?.IDR ??
        data?.conversion_rates?.IDR ??
        data?.quotes?.USDIDR ??
        data?.data?.IDR;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
