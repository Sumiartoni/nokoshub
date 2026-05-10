import axios from 'axios';
import { config } from '../../app/config';
import { prisma } from '../../database/prisma.client';
import logger from '../../utils/logger';
import { buildOutboundAxiosConfig } from '../../utils/outbound-http';

const SELL_PRICE_MULTIPLIER_KEY = 'sell_price_multiplier';
const PRICING_PROTECTION_PERCENT_KEY = 'pricing_protection_percent';

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
const RETRYABLE_NETWORK_CODES = new Set(['EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND']);

export const pricingService = {
    async getSellPriceMultiplier(): Promise<number> {
        const setting = await withRetry(
            () => prisma.appSetting.findUnique({
                where: { key: SELL_PRICE_MULTIPLIER_KEY },
            }),
            'pricingService.getSellPriceMultiplier'
        );

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

    async getPricingProtectionPercent(): Promise<number> {
        const setting = await withRetry(
            () => prisma.appSetting.findUnique({
                where: { key: PRICING_PROTECTION_PERCENT_KEY },
            }),
            'pricingService.getPricingProtectionPercent'
        );

        const value = Number(setting?.value ?? 0);
        return Number.isFinite(value) && value >= 0 ? value : 0;
    },

    async setPricingProtectionPercent(percent: number): Promise<number> {
        if (!Number.isFinite(percent) || percent < 0) {
            throw new Error('Proteksi pricing harus 0 atau lebih');
        }

        const normalized = Number(percent.toFixed(4));
        await prisma.appSetting.upsert({
            where: { key: PRICING_PROTECTION_PERCENT_KEY },
            update: { value: String(normalized) },
            create: { key: PRICING_PROTECTION_PERCENT_KEY, value: String(normalized) },
        });

        return normalized;
    },

    async getUsdIdrRate(forceRefresh = false): Promise<UsdIdrRateInfo> {
        const now = Date.now();
        if (!forceRefresh && rateCache && rateCache.expiresAt > now) {
            return rateCache.info;
        }

        const fallbackRate = positiveNumber(config.HERO_SMS_PRICE_TO_IDR_RATE, 17000);
        const bufferPercent = 0;
        let info: UsdIdrRateInfo;

        if (!config.USD_IDR_RATE_AUTO_ENABLED) {
            info = buildRateInfo(fallbackRate, bufferPercent, false, 'env:HERO_SMS_PRICE_TO_IDR_RATE', fallbackRate);
        } else {
            try {
                const response = await withRetry(
                    () => axios.get(
                        config.USD_IDR_RATE_API_URL,
                        buildOutboundAxiosConfig({
                            timeout: 10000,
                            headers: { Accept: 'application/json' },
                        })
                    ),
                    'pricingService.getUsdIdrRate'
                );
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
        const [sellPriceMultiplier, pricingProtectionPercent, usdIdrRate] = await Promise.all([
            this.getSellPriceMultiplier(),
            this.getPricingProtectionPercent(),
            this.getUsdIdrRate(forceRefresh),
        ]);

        return { sellPriceMultiplier, pricingProtectionPercent, usdIdrRate };
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
        effectiveRate: baseRate,
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

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await fn();
        } catch (err: any) {
            lastError = err;
            if (!isRetryableNetworkError(err) || attempt === maxAttempts) {
                throw err;
            }

            const retryMs = attempt * 1500;
            logger.warn({ label, attempt, retryMs, code: err?.code, message: err?.message }, 'Retrying after transient network error');
            await sleep(retryMs);
        }
    }

    throw lastError;
}

function isRetryableNetworkError(err: any): boolean {
    const code = String(err?.code || err?.cause?.code || err?.errno || '').toUpperCase();
    if (RETRYABLE_NETWORK_CODES.has(code)) return true;

    const message = String(err?.message || '').toUpperCase();
    return message.includes('EAI_AGAIN') || message.includes('ETIMEDOUT') || message.includes('ECONNRESET');
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
