import { FastifyPluginAsync } from 'fastify';
import { serviceService } from '../../modules/services/service.service';
import { orderService } from '../../modules/orders/order.service';
import { paymentService } from '../../modules/payments/payment.service';
import { config } from '../../app/config';
import logger from '../../utils/logger';
import { prisma } from '../../database/prisma.client';
import { hasBackofficeSession } from '../../utils/backoffice-auth';
import { pricingService } from '../pricing/pricing.service';
import { smtpSettingsService } from '../settings/smtp-settings.service';
import { emailService } from '../email/email.service';
import { referralService } from '../referrals/referral.service';
import { maintenanceService } from '../maintenance/maintenance.service';
import { bayarGgService } from '../payments/bayargg.service';
import { paymentSettingsService } from '../settings/payment-settings.service';
import { csBotSettingsService } from '../settings/cs-bot-settings.service';
import { promoSettingsService } from '../settings/promo-settings.service';
import { announcementSettingsService } from '../settings/announcement-settings.service';
import { seoPagesService } from '../settings/seo-pages.service';
import { getConfiguredProviderBalances } from '../providers/provider-runtime';
import { getProviderDescriptor } from '../providers/provider-registry';
import { userService } from '../users/user.service';
import { newsletterService } from '../newsletter/newsletter.service';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const pricingSettingsSchema = z.object({
    sellPriceMultiplier: z.number().min(1).max(20),
    pricingProtectionPercent: z.number().min(0).max(100),
});

const referralSettingsSchema = z.object({
    enabled: z.boolean(),
    rewardAmount: z.number().int().min(0).max(100000000),
});

const paymentSettingsSchema = z.object({
    minimumDeposit: z.number().int().min(1000).max(10000000),
});

const promoSettingsSchema = z.object({
    enabled: z.boolean(),
    title: z.string().min(3, 'Judul promo minimal 3 karakter').max(120),
    description: z.string().min(8, 'Deskripsi promo minimal 8 karakter').max(500),
    minimumDeposit: z.number().int().min(1000).max(10000000),
    bonusAmount: z.number().int().min(0).max(10000000),
    topupUrl: z.string().min(1, 'URL top up wajib diisi').url('URL top up harus valid'),
    claimInstructions: z.string().min(8, 'Instruksi klaim minimal 8 karakter').max(500),
});

const announcementSettingsSchema = z.object({
    enabled: z.boolean(),
    title: z.string().min(3, 'Judul pengumuman minimal 3 karakter').max(120),
    message: z.string().min(8, 'Isi pengumuman minimal 8 karakter').max(2000),
});

const seoPageSchema = z.object({
    id: z.string().optional(),
    slug: z.string().min(2).max(120),
    title: z.string().min(10).max(180),
    metaDescription: z.string().min(30).max(320),
    heroBadge: z.string().min(2).max(80),
    heroTitle: z.string().min(10).max(180),
    intro: z.string().min(30).max(1200),
    content: z.string().min(40).max(20000),
    primaryCtaLabel: z.string().min(2).max(60),
    primaryCtaHref: z.string().min(1).max(200),
    secondaryCtaLabel: z.string().min(2).max(60),
    secondaryCtaHref: z.string().min(1).max(200),
    isPublished: z.boolean(),
});

const smtpSettingsSchema = z.object({
    transport: z.enum(['smtp', 'brevo_api', 'resend_api']).default('smtp'),
    host: z.string().optional().default(''),
    port: z.number().int().min(1).max(65535).default(587),
    secure: z.boolean().default(false),
    username: z.string().optional().default(''),
    password: z.string().optional().default(''),
    apiKey: z.string().optional().default(''),
    resendApiKey: z.string().optional().default(''),
    fromName: z.string().min(1, 'Nama pengirim wajib diisi').max(100),
    fromEmail: z.string().email('Email pengirim tidak valid'),
}).superRefine((value, ctx) => {
    if (value.transport === 'brevo_api') {
        if (!value.apiKey?.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['apiKey'],
                message: 'Brevo API key wajib diisi',
            });
        }
        return;
    }

    if (value.transport === 'resend_api') {
        if (!value.resendApiKey?.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['resendApiKey'],
                message: 'Resend API key wajib diisi',
            });
        }
        return;
    }

    if (!value.host?.trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['host'],
            message: 'Host SMTP wajib diisi',
        });
    }

    if (!value.username?.trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['username'],
            message: 'Username SMTP wajib diisi',
        });
    }

    if (!value.password?.trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['password'],
            message: 'Password SMTP wajib diisi',
        });
    }
});

const smtpTestSchema = z.object({
    to: z.string().email('Email tujuan test tidak valid'),
});

const csBotSettingsSchema = z.object({
    apiKey: z.string().optional().default(''),
    model: z.string().min(3, 'Model OpenRouter wajib diisi').max(120),
    siteUrl: z.string().optional().default(''),
    siteName: z.string().optional().default(''),
    knowledgePrompt: z.string().optional().default(''),
}).superRefine((value, ctx) => {
    if (value.siteUrl.trim()) {
        const result = z.string().url().safeParse(value.siteUrl.trim());
        if (!result.success) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['siteUrl'],
                message: 'Site URL harus berupa URL valid',
            });
        }
    }
});

const newsletterSendSchema = z.object({
    channel: z.enum(['email', 'telegram']),
    audience: z.enum(['single_email', 'all_web', 'single_telegram', 'all_bot']),
    recipient: z.string().optional().default(''),
    subject: z.string().optional().default(''),
    body: z.string().min(8, 'Isi pesan minimal 8 karakter').max(10000, 'Isi pesan terlalu panjang'),
    templateKey: z.string().optional().default(''),
}).superRefine((value, ctx) => {
    if (value.channel === 'email' && !value.subject.trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['subject'],
            message: 'Subject email wajib diisi',
        });
    }
    if (value.channel === 'email' && ['all_bot', 'single_telegram'].includes(value.audience)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['audience'],
            message: 'Channel email hanya bisa dikirim ke user web atau satu email tujuan',
        });
    }
    if (value.channel === 'telegram' && ['all_web', 'single_email'].includes(value.audience)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['audience'],
            message: 'Channel Telegram hanya bisa dikirim ke user bot atau satu Telegram ID tujuan',
        });
    }
    if (value.audience === 'single_email' && !value.recipient.trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['recipient'],
            message: 'Email tujuan wajib diisi',
        });
    }
    if (value.audience === 'single_telegram' && !value.recipient.trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['recipient'],
            message: 'Telegram ID tujuan wajib diisi',
        });
    }
});

const maintenanceSettingsSchema = z.object({
    enabled: z.boolean(),
    title: z.string().min(3).max(120),
    message: z.string().min(8).max(500),
    expectedEndAt: z.string().optional().default(''),
    blockOrders: z.boolean(),
    blockDeposits: z.boolean(),
    blockRegistrations: z.boolean(),
});

const maintenanceActionSchema = z.object({
    action: z.enum([
        'expire_invoices',
        'reconcile_payments',
        'repair_duplicate_deposits',
        'cleanup_pending_registrations',
        'cleanup_telegram_links',
        'run_full_routine',
        'sync_provider',
    ]),
    limit: z.number().int().min(1).max(100).optional(),
});

function parseAdminDateRange(input: { dateFrom?: string; dateTo?: string }) {
    const range: { start?: Date; end?: Date } = {};

    if (input.dateFrom) {
        const start = new Date(input.dateFrom);
        if (!Number.isFinite(start.getTime())) {
            throw new Error('dateFrom tidak valid');
        }
        range.start = start;
    }

    if (input.dateTo) {
        const end = new Date(input.dateTo);
        if (!Number.isFinite(end.getTime())) {
            throw new Error('dateTo tidak valid');
        }
        range.end = end;
    }

    if (range.start && range.end && range.start > range.end) {
        throw new Error('dateFrom tidak boleh lebih besar dari dateTo');
    }

    return range;
}

function buildSqlDateRange(columnName: string, range: { start?: Date; end?: Date }) {
    const column = Prisma.raw(columnName);
    const clauses: Prisma.Sql[] = [];

    if (range.start) {
        clauses.push(Prisma.sql`${column} >= ${range.start}`);
    }

    if (range.end) {
        clauses.push(Prisma.sql`${column} <= ${range.end}`);
    }

    if (!clauses.length) {
        return Prisma.empty;
    }

    return Prisma.sql` AND ${Prisma.join(clauses, ' AND ')}`;
}

function buildWibTimestampSql(columnName: string) {
    const column = Prisma.raw(columnName);
    return Prisma.sql`timezone('Asia/Jakarta', timezone('UTC', ${column}))`;
}

function getReportBucketLabelFormatSql(bucket: 'day' | 'week' | 'month') {
    if (bucket === 'month') return Prisma.raw("'YYYY-MM'");
    return Prisma.raw("'YYYY-MM-DD'");
}

function requireAdmin(req: any, reply: any): boolean {
    const key = req.headers['x-admin-key'];
    if (key !== config.ADMIN_API_KEY && !hasBackofficeSession(req)) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
        return false;
    }
    return true;
}

function maxDate(left?: Date | string | null, right?: Date | string | null) {
    if (!left) return right ?? null;
    if (!right) return left;
    return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function getReportBucket(bucket?: string) {
    if (bucket === 'week' || bucket === 'month') return bucket;
    return 'day';
}

function getReportBucketSql(bucket: 'day' | 'week' | 'month') {
    if (bucket === 'week') return Prisma.raw("'week'");
    if (bucket === 'month') return Prisma.raw("'month'");
    return Prisma.raw("'day'");
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /api/admin/overview - aggregate dashboard stats
    fastify.get('/overview', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const query = req.query as { dateFrom?: string; dateTo?: string };
        let dateRange: { start?: Date; end?: Date };
        try {
            dateRange = parseAdminDateRange(query);
        } catch (err) {
            return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Rentang tanggal tidak valid' });
        }

        const orderWhere = {
            ...(dateRange.start || dateRange.end
                ? {
                    createdAt: {
                        ...(dateRange.start ? { gte: dateRange.start } : {}),
                        ...(dateRange.end ? { lte: dateRange.end } : {}),
                    },
                }
                : {}),
        };
        const paidInvoiceWhere = {
            status: 'PAID' as const,
            ...(dateRange.start || dateRange.end
                ? {
                    paidAt: {
                        ...(dateRange.start ? { gte: dateRange.start } : {}),
                        ...(dateRange.end ? { lte: dateRange.end } : {}),
                    },
                }
                : {}),
        };
        const orderDateSql = buildSqlDateRange('o."createdAt"', dateRange);

        const [
            totalOrders,
            activeOrders,
            successOrders,
            totalServices,
            userBalanceAgg,
            providerSummary,
            paidInvoiceAgg,
            orderTotals,
        ] = await Promise.all([
            prisma.order.count({ where: orderWhere }),
            prisma.order.count({ where: { ...orderWhere, status: 'ACTIVE' } }),
            prisma.order.count({ where: { ...orderWhere, status: 'SUCCESS' } }),
            prisma.service.count({ where: { isActive: true } }),
            prisma.user.aggregate({ _sum: { balance: true } }),
            (async () => {
                try {
                    const [balances, rate] = await Promise.all([
                        getConfiguredProviderBalances(),
                        pricingService.getUsdIdrRate(),
                    ]);
                    const balanceUsd = balances.reduce((sum, item) => sum + item.balanceUsd, 0);
                    return { balanceUsd, balances, rate, ok: true };
                } catch (err) {
                    logger.warn({ err }, 'Failed to load provider balance for admin overview');
                    return { balanceUsd: 0, balances: [], rate: null, ok: false };
                }
            })(),
            prisma.invoice.aggregate({
                where: paidInvoiceWhere,
                _sum: { baseAmount: true, gatewayFee: true, amount: true },
            }),
            prisma.$queryRaw<Array<{ totalOrderRevenue: bigint | number | null; netProfit: bigint | number | null }>>(Prisma.sql`
                SELECT
                    COALESCE(SUM(p."sellPrice"), 0) AS "totalOrderRevenue",
                    COALESCE(SUM(p."sellPrice" - p."providerPrice"), 0) AS "netProfit"
                FROM "Order" o
                INNER JOIN "Price" p ON p.id = o."priceId"
                WHERE o.status = 'SUCCESS'
                ${orderDateSql}
            `),
        ]);

        const totalUserBalance = userBalanceAgg._sum.balance ?? 0;
        const providerRate = providerSummary.rate;
        const providerBalanceIdr = providerSummary.ok && providerRate
            ? Math.round(providerSummary.balanceUsd * providerRate.effectiveRate)
            : 0;
        const orderSummary = orderTotals[0] ?? { totalOrderRevenue: 0, netProfit: 0 };
        const totalOrderRevenue = Number(orderSummary.totalOrderRevenue ?? 0);
        const netProfit = Number(orderSummary.netProfit ?? 0);

        return {
            success: true,
            data: {
                totalOrders,
                activeOrders,
                successOrders,
                totalServices,
                totalOrderRevenue,
                totalUserBalance,
                totalPaidDeposits: paidInvoiceAgg._sum.baseAmount ?? 0,
                totalGatewayFees: paidInvoiceAgg._sum.gatewayFee ?? 0,
                totalGatewayPaid: paidInvoiceAgg._sum.amount ?? 0,
                netProfit,
                providerBalanceUsd: providerSummary.balanceUsd,
                providerBalanceIdr,
                providerBalances: providerSummary.balances,
                providerRate: providerRate?.effectiveRate ?? 0,
                providerRateBase: providerRate?.baseRate ?? 0,
                providerRateBufferPercent: providerRate?.bufferPercent ?? 0,
                reportDateFrom: dateRange.start?.toISOString() ?? null,
                reportDateTo: dateRange.end?.toISOString() ?? null,
            },
        };
    });

    // GET /api/admin/reports - dedicated reporting summary and breakdowns
    fastify.get('/reports', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const query = req.query as { dateFrom?: string; dateTo?: string; bucket?: string };
        let dateRange: { start?: Date; end?: Date };
        try {
            dateRange = parseAdminDateRange(query);
        } catch (err) {
            return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Rentang tanggal tidak valid' });
        }

        const reportBucket = getReportBucket(query.bucket);
        const reportBucketSql = getReportBucketSql(reportBucket);
        const orderDateSql = buildSqlDateRange('o."createdAt"', dateRange);
        const orderCreatedAtWibSql = buildWibTimestampSql('o."createdAt"');
        const reportBucketStartSql = Prisma.sql`date_trunc(${reportBucketSql}, ${orderCreatedAtWibSql})`;
        const reportBucketLabelFormatSql = getReportBucketLabelFormatSql(reportBucket);
        const paidInvoiceWhere = {
            status: 'PAID' as const,
            ...(dateRange.start || dateRange.end
                ? {
                    paidAt: {
                        ...(dateRange.start ? { gte: dateRange.start } : {}),
                        ...(dateRange.end ? { lte: dateRange.end } : {}),
                    },
                }
                : {}),
        };

        const [
            orderSummaryRows,
            providerBreakdownRows,
            periodBreakdownRows,
            paidInvoiceAgg,
            providerSummary,
        ] = await Promise.all([
            prisma.$queryRaw<Array<{
                successfulOrders: bigint | number | null;
                totalOrderRevenue: bigint | number | null;
                totalProviderHpp: bigint | number | null;
                grossMargin: bigint | number | null;
            }>>(Prisma.sql`
                SELECT
                    COUNT(*) AS "successfulOrders",
                    COALESCE(SUM(p."sellPrice"), 0) AS "totalOrderRevenue",
                    COALESCE(SUM(p."providerPrice"), 0) AS "totalProviderHpp",
                    COALESCE(SUM(p."sellPrice" - p."providerPrice"), 0) AS "grossMargin"
                FROM "Order" o
                INNER JOIN "Price" p ON p.id = o."priceId"
                WHERE o.status = 'SUCCESS'
                ${orderDateSql}
            `),
            prisma.$queryRaw<Array<{
                providerKey: string;
                successfulOrders: bigint | number | null;
                totalOrderRevenue: bigint | number | null;
                totalProviderHpp: bigint | number | null;
                grossMargin: bigint | number | null;
            }>>(Prisma.sql`
                SELECT
                    split_part(p."priceId", ':', 1) AS "providerKey",
                    COUNT(*) AS "successfulOrders",
                    COALESCE(SUM(p."sellPrice"), 0) AS "totalOrderRevenue",
                    COALESCE(SUM(p."providerPrice"), 0) AS "totalProviderHpp",
                    COALESCE(SUM(p."sellPrice" - p."providerPrice"), 0) AS "grossMargin"
                FROM "Order" o
                INNER JOIN "Price" p ON p.id = o."priceId"
                WHERE o.status = 'SUCCESS'
                ${orderDateSql}
                GROUP BY 1
                ORDER BY 1
            `),
            prisma.$queryRaw<Array<{
                bucketStart: Date | string;
                bucketKey: string;
                successfulOrders: bigint | number | null;
                totalOrderRevenue: bigint | number | null;
                totalProviderHpp: bigint | number | null;
                grossMargin: bigint | number | null;
            }>>(Prisma.sql`
                SELECT
                    ${reportBucketStartSql} AS "bucketStart",
                    to_char(${reportBucketStartSql}, ${reportBucketLabelFormatSql}) AS "bucketKey",
                    COUNT(*) AS "successfulOrders",
                    COALESCE(SUM(p."sellPrice"), 0) AS "totalOrderRevenue",
                    COALESCE(SUM(p."providerPrice"), 0) AS "totalProviderHpp",
                    COALESCE(SUM(p."sellPrice" - p."providerPrice"), 0) AS "grossMargin"
                FROM "Order" o
                INNER JOIN "Price" p ON p.id = o."priceId"
                WHERE o.status = 'SUCCESS'
                ${orderDateSql}
                GROUP BY 1
                ORDER BY 1 DESC
            `),
            prisma.invoice.aggregate({
                where: paidInvoiceWhere,
                _sum: { baseAmount: true, gatewayFee: true, amount: true },
                _count: { _all: true },
            }),
            (async () => {
                try {
                    const [balances, rate] = await Promise.all([
                        getConfiguredProviderBalances(),
                        pricingService.getUsdIdrRate(),
                    ]);
                    const balanceUsd = balances.reduce((sum, item) => sum + item.balanceUsd, 0);
                    return { balanceUsd, balances, rate, ok: true };
                } catch (err) {
                    logger.warn({ err }, 'Failed to load provider balance for reports page');
                    return { balanceUsd: 0, balances: [], rate: null, ok: false };
                }
            })(),
        ]);

        const orderSummary = orderSummaryRows[0] ?? {
            successfulOrders: 0,
            totalOrderRevenue: 0,
            totalProviderHpp: 0,
            grossMargin: 0,
        };

        const totalOrderRevenue = Number(orderSummary.totalOrderRevenue ?? 0);
        const totalProviderHpp = Number(orderSummary.totalProviderHpp ?? 0);
        const grossMargin = Number(orderSummary.grossMargin ?? 0);
        const successfulOrders = Number(orderSummary.successfulOrders ?? 0);
        const grossMarginPercent = totalOrderRevenue > 0
            ? Number(((grossMargin / totalOrderRevenue) * 100).toFixed(2))
            : 0;

        const providerRate = providerSummary.rate;
        const providerBalanceIdr = providerSummary.ok && providerRate
            ? Math.round(providerSummary.balanceUsd * providerRate.effectiveRate)
            : 0;

        const providerBreakdown = providerBreakdownRows.map((row) => {
            const descriptor = getProviderDescriptor(row.providerKey);
            return {
                providerKey: row.providerKey,
                providerLabel: descriptor.displayName,
                serverLabel: descriptor.serverLabel,
                successfulOrders: Number(row.successfulOrders ?? 0),
                totalOrderRevenue: Number(row.totalOrderRevenue ?? 0),
                totalProviderHpp: Number(row.totalProviderHpp ?? 0),
                grossMargin: Number(row.grossMargin ?? 0),
            };
        });

        const periodBreakdown = periodBreakdownRows.map((row) => ({
            bucketStart: row.bucketKey,
            successfulOrders: Number(row.successfulOrders ?? 0),
            totalOrderRevenue: Number(row.totalOrderRevenue ?? 0),
            totalProviderHpp: Number(row.totalProviderHpp ?? 0),
            grossMargin: Number(row.grossMargin ?? 0),
        }));

        return {
            success: true,
            data: {
                summary: {
                    successfulOrders,
                    totalOrderRevenue,
                    totalProviderHpp,
                    grossMargin,
                    grossMarginPercent,
                    totalPaidDeposits: paidInvoiceAgg._sum.baseAmount ?? 0,
                    totalGatewayFees: paidInvoiceAgg._sum.gatewayFee ?? 0,
                    totalGatewayPaid: paidInvoiceAgg._sum.amount ?? 0,
                    paidInvoiceCount: paidInvoiceAgg._count._all ?? 0,
                    providerBalanceUsd: providerSummary.balanceUsd,
                    providerBalanceIdr,
                    providerBalances: providerSummary.balances,
                    providerRate: providerRate?.effectiveRate ?? 0,
                    providerRateBase: providerRate?.baseRate ?? 0,
                    providerRateBufferPercent: providerRate?.bufferPercent ?? 0,
                    gatewayConfig: bayarGgService.getConfigStatus(),
                    paymentGatewayBalanceAvailable: false,
                    paymentGatewayBalance: null,
                    paymentGatewayBalanceNote: 'Saldo payment gateway belum tersedia dari API yang terintegrasi saat ini.',
                    reportDateFrom: dateRange.start?.toISOString() ?? null,
                    reportDateTo: dateRange.end?.toISOString() ?? null,
                    bucket: reportBucket,
                },
                providerBreakdown,
                periodBreakdown,
            },
        };
    });

    // GET /api/admin/users - merged web and Telegram users for backoffice
    fastify.get('/users', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const query = req.query as { limit?: string };
        const rawLimit = Number.parseInt(query.limit ?? '500', 10);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 500;

        const [telegramUsers, webUsers] = await Promise.all([
            prisma.user.findMany({
                select: {
                    id: true,
                    telegramId: true,
                    username: true,
                    firstName: true,
                    lastName: true,
                    balance: true,
                    isActive: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: {
                        select: {
                            orders: true,
                            transactions: true,
                            invoices: true,
                        },
                    },
                },
                orderBy: { updatedAt: 'desc' },
                take: limit,
            }),
            prisma.webUser.findMany({
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    telegramId: true,
                    createdAt: true,
                    updatedAt: true,
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
            }),
        ]);

        const webWalletUsers = new Map<string, typeof telegramUsers[number]>();
        const realTelegramUsers = telegramUsers.filter((user) => {
            if (!user.telegramId.startsWith('web_')) return true;
            const webUserId = user.telegramId.slice(4);
            if (webUserId) {
                webWalletUsers.set(webUserId, user);
            }
            return false;
        });
        const usersByTelegramId = new Map(realTelegramUsers.map((user) => [user.telegramId, user]));
        const relevantUserIds = [
            ...realTelegramUsers.map((user) => user.id),
            ...[...webWalletUsers.values()].map((user) => user.id),
        ];

        const [txGroups, lastTxGroups] = relevantUserIds.length
            ? await Promise.all([
                prisma.transaction.groupBy({
                    by: ['userId', 'type'],
                    where: { userId: { in: relevantUserIds } },
                    _count: { _all: true },
                    _sum: { amount: true },
                }),
                prisma.transaction.groupBy({
                    by: ['userId'],
                    where: { userId: { in: relevantUserIds } },
                    _max: { createdAt: true },
                }),
            ])
            : [[], []];

        const successfulOrderSummary = new Map<string, { totalPurchase: number; successOrderCount: number }>();
        if (relevantUserIds.length) {
            const successfulOrders = await prisma.order.findMany({
                where: {
                    userId: { in: relevantUserIds },
                    status: 'SUCCESS',
                },
                select: {
                    userId: true,
                    price: {
                        select: { sellPrice: true },
                    },
                },
            });

            for (const order of successfulOrders) {
                const summary = successfulOrderSummary.get(order.userId) ?? {
                    totalPurchase: 0,
                    successOrderCount: 0,
                };
                summary.totalPurchase += order.price.sellPrice;
                summary.successOrderCount += 1;
                successfulOrderSummary.set(order.userId, summary);
            }
        }

        const txSummary = new Map<string, {
            txCount: number;
            totalDeposit: number;
            totalRefund: number;
            totalDeduct: number;
            totalPurchase: number;
            successOrderCount: number;
            lastActivity: Date | null;
        }>();

        for (const group of txGroups) {
            const summary = txSummary.get(group.userId) ?? {
                txCount: 0,
                totalDeposit: 0,
                totalRefund: 0,
                totalDeduct: 0,
                totalPurchase: 0,
                successOrderCount: 0,
                lastActivity: null,
            };
            const amount = group._sum.amount ?? 0;
            summary.txCount += group._count._all;
            if (group.type === 'DEPOSIT') summary.totalDeposit += amount;
            else if (group.type === 'REFUND') summary.totalRefund += amount;
            else if (group.type === 'DEDUCT') summary.totalDeduct += Math.abs(amount);
            txSummary.set(group.userId, summary);
        }

        for (const group of lastTxGroups) {
            const summary = txSummary.get(group.userId) ?? {
                txCount: 0,
                totalDeposit: 0,
                totalRefund: 0,
                totalDeduct: 0,
                totalPurchase: 0,
                successOrderCount: 0,
                lastActivity: null,
            };
            summary.lastActivity = group._max.createdAt;
            txSummary.set(group.userId, summary);
        }

        for (const [userId, successSummary] of successfulOrderSummary.entries()) {
            const summary = txSummary.get(userId) ?? {
                txCount: 0,
                totalDeposit: 0,
                totalRefund: 0,
                totalDeduct: 0,
                totalPurchase: 0,
                successOrderCount: 0,
                lastActivity: null,
            };
            summary.totalPurchase = successSummary.totalPurchase;
            summary.successOrderCount = successSummary.successOrderCount;
            txSummary.set(userId, summary);
        }

        const rows = new Map<string, any>();

        for (const user of realTelegramUsers) {
            const summary = txSummary.get(user.id);
            rows.set(`telegram:${user.id}`, {
                id: user.id,
                telegramUserId: user.id,
                webUserId: null,
                accountType: 'TELEGRAM_ONLY',
                email: null,
                telegramId: user.telegramId,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                balance: user.balance,
                isActive: user.isActive,
                orderCount: user._count.orders,
                invoiceCount: user._count.invoices,
                txCount: summary?.txCount ?? user._count.transactions,
                totalDeposit: summary?.totalDeposit ?? 0,
                totalRefund: summary?.totalRefund ?? 0,
                totalDeduct: summary?.totalDeduct ?? 0,
                totalPurchase: summary?.totalPurchase ?? 0,
                successOrderCount: summary?.successOrderCount ?? 0,
                lastActivity: summary?.lastActivity ?? user.updatedAt,
                createdAt: user.createdAt,
                webCreatedAt: null,
                telegramCreatedAt: user.createdAt,
            });
        }

        for (const webUser of webUsers) {
            const linkedTelegramUser = webUser.telegramId ? usersByTelegramId.get(webUser.telegramId) : null;
            if (!linkedTelegramUser) {
                const webWallet = webWalletUsers.get(webUser.id);
                const summary = webWallet ? txSummary.get(webWallet.id) : null;
                rows.set(`web:${webUser.id}`, {
                    id: webUser.id,
                    telegramUserId: webWallet?.id ?? null,
                    webUserId: webUser.id,
                    accountType: 'WEB_ONLY',
                    email: webUser.email,
                    telegramId: null,
                    username: null,
                    firstName: webUser.firstName,
                    lastName: webUser.lastName,
                    balance: webWallet?.balance ?? 0,
                    isActive: webWallet?.isActive ?? true,
                    orderCount: webWallet?._count.orders ?? 0,
                    invoiceCount: webWallet?._count.invoices ?? 0,
                    txCount: summary?.txCount ?? webWallet?._count.transactions ?? 0,
                    totalDeposit: summary?.totalDeposit ?? 0,
                    totalRefund: summary?.totalRefund ?? 0,
                    totalDeduct: summary?.totalDeduct ?? 0,
                    totalPurchase: summary?.totalPurchase ?? 0,
                    successOrderCount: summary?.successOrderCount ?? 0,
                    lastActivity: maxDate(summary?.lastActivity ?? webWallet?.updatedAt ?? null, webUser.updatedAt),
                    createdAt: webUser.createdAt,
                    webCreatedAt: webUser.createdAt,
                    telegramCreatedAt: null,
                });
                continue;
            }

            const key = `telegram:${linkedTelegramUser.id}`;
            const existing = rows.get(key);
            rows.set(key, {
                ...existing,
                webUserId: webUser.id,
                accountType: 'WEB_LINKED',
                email: webUser.email,
                firstName: webUser.firstName ?? existing?.firstName,
                lastName: webUser.lastName ?? existing?.lastName,
                webCreatedAt: webUser.createdAt,
                lastActivity: maxDate(existing?.lastActivity, webUser.updatedAt),
            });
        }

        const data = [...rows.values()]
            .sort((a, b) => new Date(b.lastActivity ?? b.createdAt).getTime() - new Date(a.lastActivity ?? a.createdAt).getTime())
            .slice(0, limit);

        return { success: true, data };
    });

    // GET /api/admin/orders
    fastify.get('/orders', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const query = req.query as { status?: string; limit?: string; dateFrom?: string; dateTo?: string };
        let dateRange: { start?: Date; end?: Date };
        try {
            dateRange = parseAdminDateRange(query);
        } catch (err) {
            return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Rentang tanggal tidak valid' });
        }
        const orders = await orderService.getAllOrders(
            query.limit ? parseInt(query.limit) : 50,
            query.status,
            dateRange
        );
        return { success: true, data: orders };
    });

    // GET /api/admin/transactions
    fastify.get('/transactions', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const query = req.query as { limit?: string };
        const transactions = await prisma.transaction.findMany({
            include: { user: { select: { telegramId: true, username: true } } },
            orderBy: { createdAt: 'desc' },
            take: query.limit ? parseInt(query.limit) : 50,
        });

        const webWalletIds = transactions
            .map((tx) => tx.user?.telegramId || '')
            .filter((telegramId) => telegramId.startsWith('web_'))
            .map((telegramId) => telegramId.slice(4))
            .filter(Boolean);

        const webUsers = webWalletIds.length
            ? await prisma.webUser.findMany({
                where: { id: { in: [...new Set(webWalletIds)] } },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    telegramId: true,
                },
            })
            : [];

        const webUserMap = new Map(webUsers.map((user) => [user.id, user]));
        const data = transactions.map((tx) => {
            const telegramId = tx.user?.telegramId || '';
            const isWebWallet = telegramId.startsWith('web_');
            if (!isWebWallet) {
                return {
                    ...tx,
                    displayUser: tx.user?.username ? `@${tx.user.username}` : telegramId || '—',
                    displaySubtext: telegramId || 'User bot',
                    accountType: 'TELEGRAM_ONLY',
                };
            }

            const webUserId = telegramId.slice(4);
            const webUser = webUserMap.get(webUserId);
            const displayName = webUser?.email
                || [webUser?.firstName, webUser?.lastName].filter(Boolean).join(' ')
                || `Web user ${webUserId}`;

            return {
                ...tx,
                displayUser: displayName,
                displaySubtext: webUser?.telegramId
                    ? `Web + Telegram (${webUser.telegramId})`
                    : 'User web',
                accountType: webUser?.telegramId ? 'WEB_LINKED' : 'WEB_ONLY',
                webUserId,
            };
        });

        return { success: true, data };
    });

    // GET /api/admin/invoices
    fastify.get('/invoices', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const query = req.query as { limit?: string; dateFrom?: string; dateTo?: string };
        let dateRange: { start?: Date; end?: Date };
        try {
            dateRange = parseAdminDateRange(query);
        } catch (err) {
            return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Rentang tanggal tidak valid' });
        }
        const rawLimit = Number.parseInt(query.limit ?? '50', 10);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
        const invoices = await paymentService.getAllInvoices(limit, dateRange);
        return { success: true, data: invoices };
    });

    // GET /api/admin/maintenance
    fastify.get('/maintenance', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const data = await maintenanceService.getDashboard();
        return { success: true, data };
    });

    // PATCH /api/admin/maintenance/settings
    fastify.patch('/maintenance/settings', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = maintenanceSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        const settings = await maintenanceService.saveSettings(parsed.data);
        return {
            success: true,
            message: 'Pengaturan maintenance berhasil disimpan',
            data: settings,
        };
    });

    // POST /api/admin/maintenance/action
    fastify.post('/maintenance/action', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = maintenanceActionSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        try {
            let result: unknown;
            let message = 'Aksi maintenance berhasil dijalankan';

            if (parsed.data.action === 'expire_invoices') {
                result = await maintenanceService.expireOverdueInvoices();
                message = 'Invoice overdue berhasil diproses';
            } else if (parsed.data.action === 'reconcile_payments') {
                result = await maintenanceService.reconcilePendingPayments(parsed.data.limit ?? 25);
                message = 'Rekonsiliasi payment gateway selesai';
            } else if (parsed.data.action === 'repair_duplicate_deposits') {
                result = await maintenanceService.repairDuplicateDeposits();
                message = 'Deposit ganda berhasil diperiksa dan diperbaiki';
            } else if (parsed.data.action === 'cleanup_pending_registrations') {
                result = await maintenanceService.cleanupExpiredPendingRegistrations();
                message = 'Pending OTP register kadaluarsa berhasil dibersihkan';
            } else if (parsed.data.action === 'cleanup_telegram_links') {
                result = await maintenanceService.cleanupTelegramLinkCodes();
                message = 'Kode tautan Telegram kadaluarsa berhasil dibersihkan';
            } else if (parsed.data.action === 'run_full_routine') {
                result = await maintenanceService.runFullRoutine();
                message = 'Full maintenance routine berhasil dijalankan';
            } else {
                logger.info('Admin triggered manual provider sync from maintenance page');
                result = await serviceService.syncFromProvider();
                message = 'Sync provider selesai dijalankan';
            }

            return { success: true, message, data: result };
        } catch (err) {
            return reply.status(400).send({ success: false, error: (err as Error).message });
        }
    });

    // PATCH /api/admin/service - toggle service active state
    fastify.get('/services', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const services = await serviceService.getServicesWithStats(true);
        return { success: true, data: services };
    });

    fastify.patch('/service', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const body = req.body as { serviceCode?: string; isActive?: boolean };
        if (!body.serviceCode) {
            return reply.status(400).send({ success: false, error: 'serviceCode required' });
        }
        const service = await prisma.service.update({
            where: { serviceCode: body.serviceCode },
            data: { isActive: body.isActive ?? true },
        });
        return { success: true, data: service };
    });

    // ALL /api/admin/sync - manual sync from provider (accepts GET/POST)
    fastify.all('/sync', { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            logger.info('Admin triggered manual provider sync. Running in background...');
            // RUN IN BACKGROUND: Do not await, or Koyeb's 60s proxy will drop the connection 
            // since inserting 50,000 records takes roughly 2-3 minutes.
            serviceService.syncFromProvider()
                .then(res => logger.info(res, 'Manual background sync success'))
                .catch(err => logger.error({ err }, 'Manual background sync failed'));

            return { success: true, message: "Sync started in background! Check bot or server logs in 3 minutes." };
        } catch (err: any) {
            logger.error({ err }, 'Admin sync failed');
            return reply.status(500).send({
                success: false,
                error: err.message,
                details: err.response?.data || err.stack
            });
        }
    });

    // GET /api/admin/balance - check provider balance
    fastify.get('/balance', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const balances = await getConfiguredProviderBalances();
        const providerBalanceUsd = balances.reduce((sum, item) => sum + item.balanceUsd, 0);
        const rate = await pricingService.getUsdIdrRate();
        const providerBalanceIdr = Math.round(providerBalanceUsd * rate.effectiveRate);
        const providerBalanceIdrBase = Math.round(providerBalanceUsd * rate.baseRate);

        return {
            success: true,
            data: {
                providerBalance: providerBalanceUsd,
                providerBalanceUsd,
                providerBalanceIdr,
                providerBalanceIdrBase,
                providerBalances: balances,
                exchangeRate: rate.effectiveRate,
                exchangeRateBase: rate.baseRate,
                exchangeRateBufferPercent: rate.bufferPercent,
                exchangeRateAutoEnabled: rate.autoEnabled,
                exchangeRateSource: rate.source,
                exchangeRateFetchedAt: rate.fetchedAt,
                exchangeRateFallback: rate.fallbackRate,
                exchangeRateError: rate.error,
                sourceCurrency: 'USD',
                currency: 'IDR',
            },
        };
    });

    // GET /api/admin/settings/pricing - pricing, margin, and USD/IDR rate settings
    fastify.get('/settings/pricing', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const query = req.query as { refresh?: string };
        const settings = await pricingService.getPricingSnapshot(query.refresh === '1' || query.refresh === 'true');
        return { success: true, data: settings };
    });

    // POST /api/admin/settings/pricing/refresh-rate - refresh USD/IDR rate and reprice stored USD prices
    fastify.post('/settings/pricing/refresh-rate', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const settings = await pricingService.getPricingSnapshot(true);
        await serviceService.recalculateSellPrices(
            settings.sellPriceMultiplier,
            settings.usdIdrRate.effectiveRate,
            settings.pricingProtectionPercent
        );

        return {
            success: true,
            message: 'Kurs berhasil diperbarui dan harga tersimpan sudah dihitung ulang',
            data: settings,
        };
    });

    // PATCH /api/admin/settings/pricing - update sell price multiplier and reprice stored prices
    fastify.patch('/settings/pricing', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = pricingSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: 'Margin harus di antara 1 sampai 20 dan proteksi pricing harus di antara 0 sampai 100' });
        }

        const sellPriceMultiplier = await pricingService.setSellPriceMultiplier(parsed.data.sellPriceMultiplier);
        const pricingProtectionPercent = await pricingService.setPricingProtectionPercent(parsed.data.pricingProtectionPercent);
        const usdIdrRate = await pricingService.getUsdIdrRate(true);
        await serviceService.recalculateSellPrices(
            sellPriceMultiplier,
            usdIdrRate.effectiveRate,
            pricingProtectionPercent
        );

        return {
            success: true,
            message: 'Margin berhasil disimpan dan harga sudah dihitung ulang',
            data: { sellPriceMultiplier, pricingProtectionPercent, usdIdrRate },
        };
    });

    // GET /api/admin/settings/smtp - current email transport settings for OTP email
    fastify.get('/settings/smtp', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const settings = await smtpSettingsService.getSettings();
        return { success: true, data: settings };
    });

    // PATCH /api/admin/settings/smtp - save email transport settings
    fastify.patch('/settings/smtp', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = smtpSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        const settings = await smtpSettingsService.saveSettings(parsed.data);
        return {
            success: true,
            message: 'Konfigurasi email berhasil disimpan',
            data: settings,
        };
    });

    // POST /api/admin/settings/smtp/test - send test email
    fastify.post('/settings/smtp/test', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = smtpTestSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        try {
            await emailService.sendSmtpTestEmail(parsed.data.to);
            return {
                success: true,
                message: `Email test berhasil dikirim ke ${parsed.data.to}`,
            };
        } catch (err) {
            return reply.status(400).send({ success: false, error: (err as Error).message });
        }
    });

    // GET /api/admin/settings/cs-bot
    fastify.get('/settings/cs-bot', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const settings = await csBotSettingsService.getSettings();
        return {
            success: true,
            data: {
                ...settings,
                apiKey: settings.apiKey ? '********' : '',
            },
        };
    });

    // PATCH /api/admin/settings/cs-bot
    fastify.patch('/settings/cs-bot', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = csBotSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        const settings = await csBotSettingsService.saveSettings(parsed.data);
        return {
            success: true,
            message: 'Pengaturan AI Customer Service berhasil disimpan',
            data: {
                ...settings,
                apiKey: settings.apiKey ? '********' : '',
            },
        };
    });

    // GET /api/admin/settings/promo
    fastify.get('/settings/promo', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const settings = await promoSettingsService.getSettings();
        return {
            success: true,
            data: settings,
        };
    });

    // PATCH /api/admin/settings/promo
    fastify.patch('/settings/promo', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = promoSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        const settings = await promoSettingsService.saveSettings(parsed.data);
        return {
            success: true,
            message: 'Pengaturan promo berhasil disimpan',
            data: settings,
        };
    });

    // GET /api/admin/settings/announcement
    fastify.get('/settings/announcement', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const settings = await announcementSettingsService.getSettings();
        return {
            success: true,
            data: settings,
        };
    });

    // PATCH /api/admin/settings/announcement
    fastify.patch('/settings/announcement', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = announcementSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        const settings = await announcementSettingsService.saveSettings(parsed.data);
        return {
            success: true,
            message: 'Pengaturan pengumuman berhasil disimpan',
            data: settings,
        };
    });

    fastify.get('/seo-pages', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const pages = await seoPagesService.list();
        return { success: true, data: pages };
    });

    fastify.post('/seo-pages', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const parsed = seoPageSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        try {
            const page = await seoPagesService.save(parsed.data);
            return { success: true, message: 'Halaman SEO berhasil disimpan', data: page };
        } catch (err: any) {
            return reply.status(400).send({ success: false, error: err.message || 'Gagal menyimpan halaman SEO' });
        }
    });

    fastify.delete('/seo-pages/:id', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const params = req.params as { id?: string };
        if (!params.id) {
            return reply.status(400).send({ success: false, error: 'ID halaman wajib diisi' });
        }

        const removed = await seoPagesService.remove(params.id);
        if (!removed) {
            return reply.status(404).send({ success: false, error: 'Halaman tidak ditemukan' });
        }

        return { success: true, message: 'Halaman SEO berhasil dihapus' };
    });

    // GET /api/admin/newsletter/templates
    fastify.get('/newsletter/templates', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        return {
            success: true,
            data: newsletterService.getTemplates(),
        };
    });

    // POST /api/admin/newsletter/send
    fastify.post('/newsletter/send', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = newsletterSendSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        try {
            const result = await newsletterService.send(parsed.data);
            const base = parsed.data.channel === 'email' ? 'Email' : 'Pesan Telegram';
            return {
                success: true,
                message: `${base} selesai dikirim. Berhasil ${result.sent}/${result.total}${result.failed ? `, gagal ${result.failed}` : ''}.`,
                data: result,
            };
        } catch (err) {
            return reply.status(400).send({ success: false, error: (err as Error).message });
        }
    });

    // GET /api/admin/settings/referral
    fastify.get('/settings/referral', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const settings = await referralService.getSettings();
        return { success: true, data: settings };
    });

    // PATCH /api/admin/settings/referral
    fastify.patch('/settings/referral', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = referralSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        const settings = await referralService.saveSettings(parsed.data);
        return {
            success: true,
            message: 'Pengaturan referral berhasil disimpan',
            data: settings,
        };
    });

    // GET /api/admin/settings/payment
    fastify.get('/settings/payment', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const settings = await paymentSettingsService.getSettings();
        return { success: true, data: settings };
    });

    // PATCH /api/admin/settings/payment
    fastify.patch('/settings/payment', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = paymentSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        const settings = await paymentSettingsService.saveSettings(parsed.data);
        return {
            success: true,
            message: 'Pengaturan minimum deposit berhasil disimpan',
            data: settings,
        };
    });

    // PATCH /api/admin/user-balance - manually adjust user balance
    fastify.patch('/user-balance', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const body = req.body as {
            telegramId?: string;
            webUserId?: string;
            amount?: number;
            type?: string;
            description?: string;
        };

        if ((!body.telegramId && !body.webUserId) || !body.amount || !body.type) {
            return reply.status(400).send({ success: false, error: 'telegramId atau webUserId, amount, type required' });
        }
        if (!['DEPOSIT', 'REFUND', 'DEDUCT'].includes(body.type)) {
            return reply.status(400).send({ success: false, error: 'Tipe harus DEPOSIT, REFUND, atau DEDUCT' });
        }

        let user;
        let target = '';

        if (body.webUserId) {
            const webUser = await prisma.webUser.findUnique({
                where: { id: body.webUserId },
                select: { id: true, email: true, firstName: true, lastName: true },
            });
            if (!webUser) {
                return reply.status(404).send({ success: false, error: 'Web user tidak ditemukan' });
            }

            user = await userService.findOrCreateWebWallet(webUser.id, {
                firstName: webUser.firstName,
                lastName: webUser.lastName,
            });
            target = webUser.email || `web:${webUser.id}`;
        } else {
            user = await userService.findOrCreate(String(body.telegramId));
            target = String(body.telegramId);
        }

        const description = body.description?.trim() || 'Admin adjustment';
        const reference = `admin_adjust_${Date.now()}`;

        if (body.type === 'DEDUCT') {
            await userService.deductBalance(user.id, body.amount, description, reference);
        } else {
            await userService.addBalance(
                user.id,
                body.amount,
                body.type as 'DEPOSIT' | 'REFUND',
                description,
                reference
            );
        }

        return {
            success: true,
            message: `Saldo ${target} berhasil diperbarui`,
            data: {
                userId: user.id,
                target,
                type: body.type,
                amount: body.amount,
            },
        };
    });
};
