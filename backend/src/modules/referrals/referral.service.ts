import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.client';
import logger from '../../utils/logger';

const REFERRAL_SETTINGS_KEY = 'referral_program_settings';

export interface ReferralSettings {
    enabled: boolean;
    rewardAmount: number;
}

const DEFAULT_REFERRAL_SETTINGS: ReferralSettings = {
    enabled: false,
    rewardAmount: 0,
};

export const referralService = {
    async getSettings(): Promise<ReferralSettings> {
        const setting = await prisma.appSetting.findUnique({
            where: { key: REFERRAL_SETTINGS_KEY },
        });

        if (!setting?.value) {
            return { ...DEFAULT_REFERRAL_SETTINGS };
        }

        try {
            return normalizeReferralSettings(JSON.parse(setting.value) as Partial<ReferralSettings>);
        } catch {
            return { ...DEFAULT_REFERRAL_SETTINGS };
        }
    },

    async saveSettings(input: Partial<ReferralSettings>): Promise<ReferralSettings> {
        const normalized = normalizeReferralSettings(input);
        await prisma.appSetting.upsert({
            where: { key: REFERRAL_SETTINGS_KEY },
            update: { value: JSON.stringify(normalized) },
            create: { key: REFERRAL_SETTINGS_KEY, value: JSON.stringify(normalized) },
        });
        return normalized;
    },

    normalizeReferralCode(value?: string | null) {
        return String(value || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
    },

    async resolveReferrerByCode(code?: string | null) {
        const normalized = this.normalizeReferralCode(code);
        if (!normalized) return null;

        const referrer = await prisma.webUser.findUnique({
            where: { referralCode: normalized },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                referralCode: true,
                telegramId: true,
            },
        });

        return referrer;
    },

    async generateReferralCode(client: Prisma.TransactionClient | typeof prisma = prisma) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
            const candidate = crypto.randomBytes(4).toString('hex').toUpperCase();
            const exists = await client.webUser.findUnique({
                where: { referralCode: candidate },
                select: { id: true },
            });
            if (!exists) return candidate;
        }

        throw new Error('Gagal membuat kode referral unik. Coba lagi.');
    },

    async getSummary(webUserId: string) {
        const [settings, rows] = await Promise.all([
            this.getSettings(),
            prisma.webUser.findMany({
                where: { referredById: webUserId },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    createdAt: true,
                    referredDepositQualifiedAt: true,
                    referralRewardGrantedAt: true,
                    referralRewardAmount: true,
                },
                orderBy: { createdAt: 'desc' },
            }),
        ]);

        const totalInvited = rows.length;
        const qualifiedInvites = rows.filter((row) => Boolean(row.referredDepositQualifiedAt)).length;
        const rewardedInvites = rows.filter((row) => Boolean(row.referralRewardGrantedAt) && row.referralRewardAmount > 0).length;
        const totalRewardEarned = rows
            .filter((row) => Boolean(row.referralRewardGrantedAt))
            .reduce((sum, row) => sum + row.referralRewardAmount, 0);
        const pendingRewardAmount = rows
            .filter((row) => row.referredDepositQualifiedAt && !row.referralRewardGrantedAt)
            .reduce((sum, row) => sum + row.referralRewardAmount, 0);

        return {
            settings,
            stats: {
                totalInvited,
                qualifiedInvites,
                rewardedInvites,
                totalRewardEarned,
                pendingRewardAmount,
            },
            invites: rows.map((row) => ({
                id: row.id,
                email: row.email,
                firstName: row.firstName,
                lastName: row.lastName,
                createdAt: row.createdAt,
                qualifiedAt: row.referredDepositQualifiedAt,
                rewardedAt: row.referralRewardGrantedAt,
                rewardAmount: row.referralRewardAmount,
            })),
        };
    },

    async processQualifiedDeposit(userId: string, reference: string) {
        const settings = await this.getSettings();

        return prisma.$transaction(async (tx) => {
            const paidInvoicesCount = await tx.invoice.count({
                where: {
                    userId,
                    status: 'PAID',
                },
            });

            if (paidInvoicesCount > 1) {
                return { status: 'ignored_not_first_deposit' as const };
            }

            const telegramUser = await tx.user.findUnique({
                where: { id: userId },
                select: { telegramId: true },
            });
            if (!telegramUser?.telegramId) {
                return { status: 'ignored' as const };
            }

            const invited = await tx.webUser.findUnique({
                where: { telegramId: telegramUser.telegramId },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    referredById: true,
                    referredDepositQualifiedAt: true,
                },
            });

            if (!invited?.referredById || invited.referredDepositQualifiedAt) {
                return { status: 'ignored' as const };
            }

            const rewardAmount = settings.enabled ? Math.max(0, settings.rewardAmount) : 0;
            const qualifiedAt = new Date();
            const referrer = await tx.webUser.findUnique({
                where: { id: invited.referredById },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    telegramId: true,
                },
            });

            if (!rewardAmount) {
                await tx.webUser.update({
                    where: { id: invited.id },
                    data: {
                        referredDepositQualifiedAt: qualifiedAt,
                        referralRewardAmount: 0,
                    },
                });

                logger.info({ invitedWebUserId: invited.id, reference }, 'Referral qualified without reward because program is disabled');
                return { status: 'qualified_without_reward' as const };
            }

            if (!referrer?.telegramId) {
                await tx.webUser.update({
                    where: { id: invited.id },
                    data: {
                        referredDepositQualifiedAt: qualifiedAt,
                        referralRewardAmount: rewardAmount,
                    },
                });

                logger.info({ invitedWebUserId: invited.id, referrerWebUserId: invited.referredById, rewardAmount, reference }, 'Referral reward pending until referrer links Telegram');
                return { status: 'pending_referrer_link' as const, rewardAmount };
            }

            const rewardUser = await tx.user.upsert({
                where: { telegramId: referrer.telegramId },
                update: {},
                create: {
                    telegramId: referrer.telegramId,
                    firstName: referrer.firstName,
                    lastName: referrer.lastName,
                    balance: 0,
                },
            });

            await tx.user.update({
                where: { id: rewardUser.id },
                data: {
                    balance: { increment: rewardAmount },
                },
            });

            await tx.transaction.create({
                data: {
                    userId: rewardUser.id,
                    type: 'REFERRAL',
                    amount: rewardAmount,
                    description: `Bonus referral dari ${invited.email}`,
                    reference,
                },
            });

            await tx.webUser.update({
                where: { id: invited.id },
                data: {
                    referredDepositQualifiedAt: qualifiedAt,
                    referralRewardGrantedAt: qualifiedAt,
                    referralRewardAmount: rewardAmount,
                },
            });

            logger.info(
                {
                    invitedWebUserId: invited.id,
                    referrerWebUserId: referrer.id,
                    rewardUserId: rewardUser.id,
                    rewardAmount,
                    reference,
                },
                'Referral reward granted'
            );

            return { status: 'granted' as const, rewardAmount };
        });
    },

    async releasePendingRewardsForReferrer(webUserId: string) {
        return prisma.$transaction(async (tx) => {
            const referrer = await tx.webUser.findUnique({
                where: { id: webUserId },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    telegramId: true,
                },
            });

            if (!referrer?.telegramId) {
                return { processed: 0, amount: 0 };
            }

            const pendingRows = await tx.webUser.findMany({
                where: {
                    referredById: webUserId,
                    referredDepositQualifiedAt: { not: null },
                    referralRewardGrantedAt: null,
                    referralRewardAmount: { gt: 0 },
                },
                select: {
                    id: true,
                    email: true,
                    referralRewardAmount: true,
                },
            });

            if (!pendingRows.length) {
                return { processed: 0, amount: 0 };
            }

            const rewardUser = await tx.user.upsert({
                where: { telegramId: referrer.telegramId },
                update: {},
                create: {
                    telegramId: referrer.telegramId,
                    firstName: referrer.firstName,
                    lastName: referrer.lastName,
                    balance: 0,
                },
            });

            const totalAmount = pendingRows.reduce((sum, row) => sum + row.referralRewardAmount, 0);
            const grantedAt = new Date();

            await tx.user.update({
                where: { id: rewardUser.id },
                data: {
                    balance: { increment: totalAmount },
                },
            });

            await tx.transaction.createMany({
                data: pendingRows.map((row) => ({
                    userId: rewardUser.id,
                    type: 'REFERRAL',
                    amount: row.referralRewardAmount,
                    description: `Bonus referral dari ${row.email}`,
                    reference: `referral:${row.id}`,
                    createdAt: grantedAt,
                })),
            });

            await tx.webUser.updateMany({
                where: {
                    id: { in: pendingRows.map((row) => row.id) },
                    referralRewardGrantedAt: null,
                },
                data: {
                    referralRewardGrantedAt: grantedAt,
                },
            });

            logger.info(
                {
                    referrerWebUserId: webUserId,
                    rewardUserId: rewardUser.id,
                    processed: pendingRows.length,
                    totalAmount,
                },
                'Released pending referral rewards'
            );

            return {
                processed: pendingRows.length,
                amount: totalAmount,
            };
        });
    },
};

function normalizeReferralSettings(input: Partial<ReferralSettings>): ReferralSettings {
    const rewardAmount = Number(input.rewardAmount ?? DEFAULT_REFERRAL_SETTINGS.rewardAmount);

    return {
        enabled: Boolean(input.enabled),
        rewardAmount: Number.isFinite(rewardAmount) && rewardAmount > 0 ? Math.round(rewardAmount) : 0,
    };
}
