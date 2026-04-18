import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { serviceService } from '../../modules/services/service.service';
import { userService } from '../../modules/users/user.service';
import { orderService } from '../../modules/orders/order.service';
import { paymentService } from '../../modules/payments/payment.service';
import { paginationSchema } from '../../utils/helpers';
import { config } from '../../app/config';
import logger from '../../utils/logger';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const pricesQuerySchema = z.object({
    serviceId: z.string().min(1),
    countryId: z.string().min(1),
});

const createOrderSchema = z.object({
    priceId: z.string().min(1),
    telegramId: z.string().min(1), // passed by bot
});

const depositSchema = z.object({
    amount: z.number().int().min(10000).max(10000000),
    telegramId: z.string().min(1),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export const apiRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /api/health
    fastify.get('/health', async (req, reply) => {
        return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // GET /api/services
    fastify.get('/services', async (req, reply) => {
        const services = await serviceService.getServices();
        return { success: true, data: services };
    });

    // GET /api/countries?serviceId=
    fastify.get('/countries', async (req, reply) => {
        const query = req.query as { serviceId?: string };
        let countries;
        if (query.serviceId) {
            countries = await serviceService.getCountriesByService(query.serviceId);
        } else {
            countries = await serviceService.getCountries();
        }
        return { success: true, data: countries };
    });

    // GET /api/prices?serviceId=&countryId=
    fastify.get('/prices', async (req, reply) => {
        const parsed = pricesQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }
        const prices = await serviceService.getPrices(parsed.data.serviceId, parsed.data.countryId);
        // Never expose priceId to clients - only id and sellPrice
        const sanitized = prices.map((p) => ({
            id: p.id,
            sellPrice: p.sellPrice,
            isActive: p.isActive,
        }));
        return { success: true, data: sanitized };
    });

    // POST /api/order
    fastify.post('/order', async (req, reply) => {
        const parsed = createOrderSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }
        try {
            const user = await userService.findOrCreate(parsed.data.telegramId);
            const order = await orderService.createOrder(user.id, parsed.data.priceId);
            return {
                success: true,
                data: {
                    orderId: order.id,
                    phoneNumber: order.phoneNumber,
                    status: order.status,
                },
            };
        } catch (err) {
            logger.error({ err }, 'Create order failed');
            return reply.status(400).send({ success: false, error: (err as Error).message });
        }
    });

    // GET /api/orders?telegramId=
    fastify.get('/orders', async (req, reply) => {
        const query = req.query as { telegramId?: string };
        if (!query.telegramId) {
            return reply.status(400).send({ success: false, error: 'telegramId required' });
        }
        const user = await userService.getByTelegramId(query.telegramId);
        if (!user) return { success: true, data: [] };
        const orders = await orderService.getOrders(user.id);
        return { success: true, data: orders };
    });

    // GET /api/user/balance?telegramId=
    fastify.get('/user/balance', async (req, reply) => {
        const query = req.query as { telegramId?: string };
        if (!query.telegramId) {
            return reply.status(400).send({ success: false, error: 'telegramId required' });
        }
        const user = await userService.findOrCreate(query.telegramId);
        return { success: true, data: { balance: user.balance } };
    });

    // POST /api/deposit
    fastify.post('/deposit', async (req, reply) => {
        const parsed = depositSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }
        try {
            const user = await userService.findOrCreate(parsed.data.telegramId);
            const invoice = await paymentService.createInvoice(user.id, parsed.data.amount);
            return {
                success: true,
                data: {
                    invoiceId: invoice.id,
                    amount: invoice.amount,
                    qrisPayload: invoice.qrisPayload,
                    expiredAt: invoice.expiredAt,
                },
            };
        } catch (err) {
            return reply.status(400).send({ success: false, error: (err as Error).message });
        }
    });

    // GET /api/invoices?telegramId=
    fastify.get('/invoices', async (req, reply) => {
        const query = req.query as { telegramId?: string };
        if (!query.telegramId) {
            return reply.status(400).send({ success: false, error: 'telegramId required' });
        }
        const user = await userService.getByTelegramId(query.telegramId);
        if (!user) return { success: true, data: [] };
        const invoices = await paymentService.getInvoices(user.id);
        return { success: true, data: invoices };
    });

    // POST /api/order/cancel
    fastify.post('/order/cancel', async (req, reply) => {
        const body = req.body as { orderId?: string; telegramId?: string };
        if (!body.orderId || !body.telegramId) {
            return reply.status(400).send({ success: false, error: 'orderId and telegramId required' });
        }
        try {
            const user = await userService.findOrCreate(body.telegramId);
            const result = await orderService.cancelOrder(body.orderId, user.id);
            return { success: true, data: result };
        } catch (err) {
            return reply.status(400).send({ success: false, error: (err as Error).message });
        }
    });
};
