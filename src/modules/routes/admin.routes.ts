import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { serviceService } from '../../modules/services/service.service';
import { orderService } from '../../modules/orders/order.service';
import { paymentService } from '../../modules/payments/payment.service';
import { config } from '../../app/config';
import logger from '../../utils/logger';
import { prisma } from '../../database/prisma.client';

const adminKeySchema = z.object({
    'x-admin-key': z.string(),
});

function requireAdmin(req: any, reply: any): boolean {
    const key = req.headers['x-admin-key'];
    if (key !== config.ADMIN_API_KEY) {
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
        const invoices = await paymentService.getAllInvoices();
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

    // POST /api/admin/sync - manual sync from provider
    fastify.post('/sync', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            logger.info('Admin triggered manual provider sync');
            const result = await serviceService.syncFromProvider();
            return { success: true, data: result };
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
        const { rumahOTPProvider } = await import('../../modules/providers/rumahotp.provider');
        const balance = await rumahOTPProvider.getBalance();
        return { success: true, data: { providerBalance: balance } };
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
