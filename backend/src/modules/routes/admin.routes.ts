import { FastifyPluginAsync } from 'fastify';
import { serviceService } from '../../modules/services/service.service';
import { orderService } from '../../modules/orders/order.service';
import { paymentService } from '../../modules/payments/payment.service';
import { config } from '../../app/config';
import logger from '../../utils/logger';
import { prisma } from '../../database/prisma.client';
import { hasBackofficeSession } from '../../utils/backoffice-auth';
import { pricingService } from '../pricing/pricing.service';
import { z } from 'zod';

const pricingSettingsSchema = z.object({
    sellPriceMultiplier: z.number().min(1).max(20),
});

function requireAdmin(req: any, reply: any): boolean {
    const key = req.headers['x-admin-key'] || (req.query && req.query.key);
    if (key !== config.ADMIN_API_KEY && !hasBackofficeSession(req)) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
        return false;
    }
    return true;
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
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
    fastify.all('/sync', async (req, reply) => {
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
