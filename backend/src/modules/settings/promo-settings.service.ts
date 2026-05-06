import { prisma } from '../../database/prisma.client';

const PROMO_SETTINGS_KEY = 'promo_settings';
const CACHE_TTL_MS = 30 * 1000;
const DEFAULT_TOPUP_URL = 'https://nokoshub.store/user/#topup';

export interface PromoSettings {
    enabled: boolean;
    title: string;
    description: string;
    minimumDeposit: number;
    bonusAmount: number;
    topupUrl: string;
    claimInstructions: string;
}

const DEFAULT_PROMO_SETTINGS: PromoSettings = {
    enabled: false,
    title: 'Promo Deposit NokosHUB',
    description: 'Deposit minimal Rp20.000 dan dapatkan bonus saldo Rp2.000.',
    minimumDeposit: 20000,
    bonusAmount: 2000,
    topupUrl: DEFAULT_TOPUP_URL,
    claimInstructions: 'Ketik /klaim, upload bukti transfer, lalu kirim email yang terdaftar untuk direview admin.',
};

let runtimeCache:
    | {
        value: PromoSettings;
        expiresAt: number;
    }
    | null = null;

export const promoSettingsService = {
    async getSettings(): Promise<PromoSettings> {
        const row = await prisma.appSetting.findUnique({
            where: { key: PROMO_SETTINGS_KEY },
        });

        if (!row?.value) {
            return normalizePromoSettings({});
        }

        try {
            const parsed = JSON.parse(row.value) as Partial<PromoSettings>;
            return normalizePromoSettings(parsed);
        } catch {
            return normalizePromoSettings({});
        }
    },

    async saveSettings(input: Partial<PromoSettings>): Promise<PromoSettings> {
        const current = await this.getSettings();
        const normalized = normalizePromoSettings({
            ...current,
            ...input,
        });

        await prisma.appSetting.upsert({
            where: { key: PROMO_SETTINGS_KEY },
            update: { value: JSON.stringify(normalized) },
            create: { key: PROMO_SETTINGS_KEY, value: JSON.stringify(normalized) },
        });

        runtimeCache = null;
        return normalized;
    },

    async getRuntimeSettings(): Promise<PromoSettings> {
        if (runtimeCache && runtimeCache.expiresAt > Date.now()) {
            return runtimeCache.value;
        }

        const value = await this.getSettings();
        runtimeCache = {
            value,
            expiresAt: Date.now() + CACHE_TTL_MS,
        };
        return value;
    },
};

function normalizePromoSettings(input: Partial<PromoSettings>): PromoSettings {
    const minimumDeposit = normalizeMoney(input.minimumDeposit, DEFAULT_PROMO_SETTINGS.minimumDeposit);
    const bonusAmount = normalizeMoney(input.bonusAmount, DEFAULT_PROMO_SETTINGS.bonusAmount);

    return {
        enabled: Boolean(input.enabled),
        title: String(input.title ?? DEFAULT_PROMO_SETTINGS.title).trim() || DEFAULT_PROMO_SETTINGS.title,
        description: String(input.description ?? DEFAULT_PROMO_SETTINGS.description).trim() || DEFAULT_PROMO_SETTINGS.description,
        minimumDeposit,
        bonusAmount,
        topupUrl: String(input.topupUrl ?? DEFAULT_PROMO_SETTINGS.topupUrl).trim() || DEFAULT_PROMO_SETTINGS.topupUrl,
        claimInstructions: String(input.claimInstructions ?? DEFAULT_PROMO_SETTINGS.claimInstructions).trim()
            || DEFAULT_PROMO_SETTINGS.claimInstructions,
    };
}

function normalizeMoney(value: unknown, fallback: number) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.max(0, Math.trunc(numberValue));
}
