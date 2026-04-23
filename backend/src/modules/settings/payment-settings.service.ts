import { prisma } from '../../database/prisma.client';

const PAYMENT_SETTINGS_KEY = 'payment_settings';
const DEFAULT_MINIMUM_DEPOSIT = 10000;
const MAXIMUM_DEPOSIT = 10000000;

export interface PaymentSettings {
    minimumDeposit: number;
    maximumDeposit: number;
}

export const paymentSettingsService = {
    async getSettings(): Promise<PaymentSettings> {
        const row = await prisma.appSetting.findUnique({
            where: { key: PAYMENT_SETTINGS_KEY },
        });

        if (!row?.value) {
            return defaultPaymentSettings();
        }

        try {
            const parsed = JSON.parse(row.value) as Partial<PaymentSettings>;
            return normalizePaymentSettings(parsed);
        } catch {
            return defaultPaymentSettings();
        }
    },

    async saveSettings(input: Partial<PaymentSettings>): Promise<PaymentSettings> {
        const normalized = normalizePaymentSettings(input);
        await prisma.appSetting.upsert({
            where: { key: PAYMENT_SETTINGS_KEY },
            update: { value: JSON.stringify(normalized) },
            create: { key: PAYMENT_SETTINGS_KEY, value: JSON.stringify(normalized) },
        });

        return normalized;
    },
};

function defaultPaymentSettings(): PaymentSettings {
    return {
        minimumDeposit: DEFAULT_MINIMUM_DEPOSIT,
        maximumDeposit: MAXIMUM_DEPOSIT,
    };
}

function normalizePaymentSettings(input: Partial<PaymentSettings>): PaymentSettings {
    const parsedMinimum = Number(input.minimumDeposit ?? DEFAULT_MINIMUM_DEPOSIT);
    const minimumDeposit = Number.isFinite(parsedMinimum)
        ? Math.min(Math.max(Math.trunc(parsedMinimum), 1000), MAXIMUM_DEPOSIT)
        : DEFAULT_MINIMUM_DEPOSIT;

    return {
        minimumDeposit,
        maximumDeposit: MAXIMUM_DEPOSIT,
    };
}
