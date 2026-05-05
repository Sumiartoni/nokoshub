import { prisma } from '../../database/prisma.client';
import { config } from '../../app/config';
import { redisConnection } from '../../queue/queue';
import { paymentService } from '../payments/payment.service';
import { serviceService } from '../services/service.service';
import { smtpSettingsService } from '../settings/smtp-settings.service';
import { bayarGgService } from '../payments/bayargg.service';

const MAINTENANCE_SETTINGS_KEY = 'maintenance_settings';

export interface MaintenanceSettings {
    enabled: boolean;
    title: string;
    message: string;
    expectedEndAt: string;
    blockOrders: boolean;
    blockDeposits: boolean;
    blockRegistrations: boolean;
}

const DEFAULT_MAINTENANCE_SETTINGS: MaintenanceSettings = {
    enabled: false,
    title: 'Maintenance Sistem',
    message: 'Saat ini sedang dilakukan peningkatan sistem agar layanan tetap stabil.',
    expectedEndAt: '',
    blockOrders: true,
    blockDeposits: true,
    blockRegistrations: true,
};

export const maintenanceService = {
    async getSettings(): Promise<MaintenanceSettings> {
        const row = await prisma.appSetting.findUnique({
            where: { key: MAINTENANCE_SETTINGS_KEY },
        });

        if (!row?.value) {
            return { ...DEFAULT_MAINTENANCE_SETTINGS };
        }

        try {
            return normalizeMaintenanceSettings(JSON.parse(row.value));
        } catch {
            return { ...DEFAULT_MAINTENANCE_SETTINGS };
        }
    },

    async saveSettings(input: Partial<MaintenanceSettings>) {
        const settings = normalizeMaintenanceSettings(input);
        await prisma.appSetting.upsert({
            where: { key: MAINTENANCE_SETTINGS_KEY },
            update: { value: JSON.stringify(settings) },
            create: { key: MAINTENANCE_SETTINGS_KEY, value: JSON.stringify(settings) },
        });
        return settings;
    },

    async assertActionAllowed(scope: 'orders' | 'deposits' | 'registrations') {
        const settings = await this.getSettings();
        if (!settings.enabled) return;

        const isBlocked = (
            (scope === 'orders' && settings.blockOrders) ||
            (scope === 'deposits' && settings.blockDeposits) ||
            (scope === 'registrations' && settings.blockRegistrations)
        );

        if (!isBlocked) return;

        const endText = settings.expectedEndAt
            ? ` Perkiraan selesai: ${new Date(settings.expectedEndAt).toLocaleString('id-ID')}.`
            : '';

        throw new Error(`${settings.title}. ${settings.message}${endText}`.trim());
    },

    async getDashboard() {
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);

        const settings = await this.getSettings();
        const paymentConfig = bayarGgService.getConfigStatus();

        const [
            invoicePending,
            invoiceOverdue,
            invoicePaidToday,
            pendingRegistrationsExpired,
            pendingRegistrationsTotal,
            linkCodesActive,
            linkCodesExpired,
            pendingReferralRewards,
            serviceCount,
            activeServiceCount,
            activePriceCount,
            telegramUserCount,
            webUserCount,
            countryCount,
            smtpSettings,
        ] = await Promise.all([
            prisma.invoice.count({ where: { status: 'PENDING' } }),
            prisma.invoice.count({ where: { status: 'PENDING', expiredAt: { lte: now } } }),
            prisma.invoice.count({ where: { status: 'PAID', paidAt: { gte: startOfDay } } }),
            prisma.pendingWebRegistration.count({ where: { otpExpiresAt: { lt: now } } }),
            prisma.pendingWebRegistration.count(),
            prisma.webTelegramLinkCode.count({
                where: {
                    consumedAt: null,
                    expiresAt: { gt: now },
                },
            }),
            prisma.webTelegramLinkCode.count({
                where: {
                    OR: [
                        { consumedAt: { not: null } },
                        { expiresAt: { lte: now } },
                    ],
                },
            }),
            prisma.webUser.count({
                where: {
                    referredDepositQualifiedAt: { not: null },
                    referralRewardGrantedAt: null,
                    referralRewardAmount: { gt: 0 },
                },
            }),
            prisma.service.count(),
            prisma.service.count({ where: { isActive: true } }),
            prisma.price.count({ where: { isActive: true } }),
            prisma.user.count(),
            prisma.webUser.count(),
            prisma.country.count({ where: { isActive: true } }),
            smtpSettingsService.getSettings().catch(() => null),
        ]);

        const database = await checkDatabase();
        const provider = await checkProvider();
        const staleBayarGg = await prisma.invoice.count({
            where: {
                provider: 'BAYAR_GG',
                status: 'PENDING',
                createdAt: {
                    lte: new Date(Date.now() - 15 * 60 * 1000),
                },
            },
        });

        const alerts = [
            invoiceOverdue > 0 ? `${invoiceOverdue} invoice deposit sudah melewati waktu bayar dan perlu dibersihkan.` : '',
            pendingRegistrationsExpired > 0 ? `${pendingRegistrationsExpired} permintaan OTP register sudah kadaluarsa dan bisa dihapus.` : '',
            linkCodesExpired > 0 ? `${linkCodesExpired} kode tautan Telegram lama bisa dibersihkan.` : '',
            staleBayarGg > 0 ? `${staleBayarGg} invoice BAYAR GG pending lebih dari 15 menit dan sebaiknya direkonsiliasi.` : '',
            !paymentConfig.configured ? 'Konfigurasi BAYAR GG belum lengkap di .env VPS.' : '',
            !paymentConfig.publicApiBaseUrl ? 'PUBLIC_API_BASE_URL belum diisi. Webhook otomatis BAYAR GG tidak akan aktif.' : '',
            !paymentConfig.webhookSecretEnabled ? 'BAYAR_GG_WEBHOOK_SECRET belum diisi. Verifikasi webhook belum aman.' : '',
            smtpSettings && !smtpSettings.fromEmail ? 'Email pengirim OTP belum terisi.' : '',
            !config.GOOGLE_CLIENT_ID ? 'Google login belum dikonfigurasi di environment.' : '',
            !config.TURNSTILE_SITE_KEY || !config.TURNSTILE_SECRET_KEY ? 'Cloudflare Turnstile belum aktif penuh.' : '',
        ].filter(Boolean);

        return {
            settings,
            summary: {
                invoicePending,
                invoiceOverdue,
                invoicePaidToday,
                staleBayarGg,
                pendingRegistrationsExpired,
                pendingRegistrationsTotal,
                linkCodesActive,
                linkCodesExpired,
                pendingReferralRewards,
                serviceCount,
                activeServiceCount,
                activePriceCount,
                telegramUserCount,
                webUserCount,
                countryCount,
            },
            checks: {
                database,
                redis: {
                    ok: ['ready', 'connect'].includes(redisConnection.status),
                    status: redisConnection.status,
                },
                provider,
                paymentGateway: {
                    ...paymentConfig,
                },
                email: {
                    transport: smtpSettings?.transport || '',
                    fromEmail: smtpSettings?.fromEmail || '',
                    configured: Boolean(smtpSettings?.fromEmail) && (
                        smtpSettings?.transport === 'brevo_api'
                            ? Boolean(smtpSettings.apiKey)
                            : Boolean(smtpSettings?.host && smtpSettings?.username && smtpSettings?.password)
                    ),
                    envOverride: smtpSettingsService.hasEnvOverride(),
                },
                auth: {
                    googleEnabled: Boolean(config.GOOGLE_CLIENT_ID),
                    turnstileEnabled: Boolean(config.TURNSTILE_SITE_KEY && config.TURNSTILE_SECRET_KEY),
                },
            },
            alerts,
        };
    },

    async cleanupExpiredPendingRegistrations() {
        const result = await prisma.pendingWebRegistration.deleteMany({
            where: {
                otpExpiresAt: { lt: new Date() },
            },
        });
        return { deleted: result.count };
    },

    async cleanupTelegramLinkCodes() {
        const result = await prisma.webTelegramLinkCode.deleteMany({
            where: {
                OR: [
                    { consumedAt: { not: null } },
                    { expiresAt: { lt: new Date() } },
                ],
            },
        });
        return { deleted: result.count };
    },

    async expireOverdueInvoices() {
        const expired = await paymentService.expireOverdueInvoices();
        return { expired };
    },

    async reconcilePendingPayments(limit = 25) {
        return paymentService.reconcilePendingInvoices(limit);
    },

    async repairDuplicateDeposits() {
        return paymentService.repairDuplicateDepositCredits();
    },

    async runFullRoutine() {
        const [
            expiredInvoices,
            reconciledPayments,
            cleanedRegistrations,
            cleanedLinks,
            repairedDuplicates,
        ] = await Promise.all([
            this.expireOverdueInvoices(),
            this.reconcilePendingPayments(50),
            this.cleanupExpiredPendingRegistrations(),
            this.cleanupTelegramLinkCodes(),
            this.repairDuplicateDeposits(),
        ]);

        serviceService.syncFromProvider().catch(() => null);

        return {
            expiredInvoices,
            reconciledPayments,
            cleanedRegistrations,
            cleanedLinks,
            repairedDuplicates,
            providerSyncStarted: true,
        };
    },
};

async function checkDatabase() {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return { ok: true };
    } catch (err) {
        return { ok: false, message: (err as Error).message };
    }
}

async function checkProvider() {
    try {
        const [{ getConfiguredProviderBalances }, { pricingService }] = await Promise.all([
            import('../providers/provider-runtime'),
            import('../pricing/pricing.service'),
        ]);
        const [balances, rate] = await Promise.all([
            getConfiguredProviderBalances(),
            pricingService.getUsdIdrRate(),
        ]);
        const balanceUsd = balances.reduce((sum, item) => sum + item.balanceUsd, 0);

        return {
            ok: true,
            balanceUsd,
            balances,
            effectiveRate: rate.effectiveRate,
            source: rate.source,
        };
    } catch (err) {
        return {
            ok: false,
            message: (err as Error).message,
        };
    }
}

function normalizeMaintenanceSettings(input: Partial<MaintenanceSettings> = {}): MaintenanceSettings {
    return {
        enabled: Boolean(input.enabled),
        title: String(input.title ?? DEFAULT_MAINTENANCE_SETTINGS.title).trim() || DEFAULT_MAINTENANCE_SETTINGS.title,
        message: String(input.message ?? DEFAULT_MAINTENANCE_SETTINGS.message).trim() || DEFAULT_MAINTENANCE_SETTINGS.message,
        expectedEndAt: normalizeDateTimeValue(input.expectedEndAt),
        blockOrders: input.blockOrders ?? DEFAULT_MAINTENANCE_SETTINGS.blockOrders,
        blockDeposits: input.blockDeposits ?? DEFAULT_MAINTENANCE_SETTINGS.blockDeposits,
        blockRegistrations: input.blockRegistrations ?? DEFAULT_MAINTENANCE_SETTINGS.blockRegistrations,
    };
}

function normalizeDateTimeValue(value?: string) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toISOString();
}
