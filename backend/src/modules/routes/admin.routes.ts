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
import { z } from 'zod';

const pricingSettingsSchema = z.object({
    sellPriceMultiplier: z.number().min(1).max(20),
});

const smtpSettingsSchema = z.object({
    host: z.string().min(1, 'Host SMTP wajib diisi'),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().min(1, 'Username SMTP wajib diisi'),
    password: z.string().min(1, 'Password SMTP wajib diisi'),
    fromName: z.string().min(1, 'Nama pengirim wajib diisi').max(100),
    fromEmail: z.string().email('Email pengirim tidak valid'),
});

const smtpTestSchema = z.object({
    to: z.string().email('Email tujuan test tidak valid'),
});

function requireAdmin(req: any, reply: any): boolean {
    const key = req.headers['x-admin-key'] || (req.query && req.query.key);
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

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /api/admin/users - merged web and Telegram users for backoffice
    fastify.get('/users', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const query = req.query as { limit?: string };
        const rawLimit = Number.parseInt(query.limit ?? '500', 10);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 500;

        const [telegramUsers, webUsers, txGroups, lastTxGroups] = await Promise.all([
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
            prisma.transaction.groupBy({
                by: ['userId', 'type'],
                _count: { _all: true },
                _sum: { amount: true },
            }),
            prisma.transaction.groupBy({
                by: ['userId'],
                _max: { createdAt: true },
            }),
        ]);

        const txSummary = new Map<string, {
            txCount: number;
            totalDeposit: number;
            totalRefund: number;
            totalDeduct: number;
            lastActivity: Date | null;
        }>();

        for (const group of txGroups) {
            const summary = txSummary.get(group.userId) ?? {
                txCount: 0,
                totalDeposit: 0,
                totalRefund: 0,
                totalDeduct: 0,
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
                lastActivity: null,
            };
            summary.lastActivity = group._max.createdAt;
            txSummary.set(group.userId, summary);
        }

        const usersByTelegramId = new Map(telegramUsers.map((user) => [user.telegramId, user]));
        const rows = new Map<string, any>();

        for (const user of telegramUsers) {
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
                lastActivity: summary?.lastActivity ?? user.updatedAt,
                createdAt: user.createdAt,
                webCreatedAt: null,
                telegramCreatedAt: user.createdAt,
            });
        }

        for (const webUser of webUsers) {
            const linkedTelegramUser = webUser.telegramId ? usersByTelegramId.get(webUser.telegramId) : null;
            if (!linkedTelegramUser) {
                rows.set(`web:${webUser.id}`, {
                    id: webUser.id,
                    telegramUserId: null,
                    webUserId: webUser.id,
                    accountType: 'WEB_ONLY',
                    email: webUser.email,
                    telegramId: webUser.telegramId,
                    username: null,
                    firstName: webUser.firstName,
                    lastName: webUser.lastName,
                    balance: 0,
                    isActive: true,
                    orderCount: 0,
                    invoiceCount: 0,
                    txCount: 0,
                    totalDeposit: 0,
                    totalRefund: 0,
                    totalDeduct: 0,
                    lastActivity: webUser.updatedAt,
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
        const query = req.query as { status?: string; limit?: string };
        const orders = await orderService.getAllOrders(
            query.limit ? parseInt(query.limit) : 50,
            query.status
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
        return { success: true, data: transactions };
    });

    // GET /api/admin/invoices
    fastify.get('/invoices', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const query = req.query as { limit?: string };
        const rawLimit = Number.parseInt(query.limit ?? '50', 10);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
        const invoices = await paymentService.getAllInvoices(limit);
        return { success: true, data: invoices };
    });

    // PATCH /api/admin/service - toggle service active state
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
        const { heroSMSProvider } = await import('../../modules/providers/herosms.provider');
        const providerBalanceUsd = await heroSMSProvider.getBalance();
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
            settings.usdIdrRate.effectiveRate
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
            return reply.status(400).send({ success: false, error: 'Multiplier harus di antara 1 sampai 20' });
        }

        const sellPriceMultiplier = await pricingService.setSellPriceMultiplier(parsed.data.sellPriceMultiplier);
        const usdIdrRate = await pricingService.getUsdIdrRate(true);
        await serviceService.recalculateSellPrices(sellPriceMultiplier, usdIdrRate.effectiveRate);

        return {
            success: true,
            message: 'Margin berhasil disimpan dan harga sudah dihitung ulang',
            data: { sellPriceMultiplier, usdIdrRate },
        };
    });

    // GET /api/admin/settings/smtp - current SMTP settings for OTP email
    fastify.get('/settings/smtp', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const settings = await smtpSettingsService.getSettings();
        return { success: true, data: settings };
    });

    // PATCH /api/admin/settings/smtp - save SMTP settings
    fastify.patch('/settings/smtp', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;

        const parsed = smtpSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        const settings = await smtpSettingsService.saveSettings(parsed.data);
        return {
            success: true,
            message: 'SMTP berhasil disimpan',
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

    // PATCH /api/admin/user-balance - manually adjust user balance
    fastify.patch('/user-balance', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const body = req.body as { telegramId?: string; amount?: number; type?: string; description?: string };
        if (!body.telegramId || !body.amount || !body.type) {
            return reply.status(400).send({ success: false, error: 'telegramId, amount, type required' });
        }
        const { userService } = await import('../../modules/users/user.service');
        const user = await userService.findOrCreate(body.telegramId);
        await userService.addBalance(
            user.id,
            body.amount,
            body.type as 'DEPOSIT' | 'REFUND',
            body.description ?? 'Admin adjustment'
        );
        return { success: true, message: 'Balance updated' };
    });
};
