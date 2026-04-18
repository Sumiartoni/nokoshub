import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { serviceService } from '../../modules/services/service.service';
import { userService } from '../../modules/users/user.service';
import { orderService } from '../../modules/orders/order.service';
import { paymentService } from '../../modules/payments/payment.service';
import { paginationSchema } from '../../utils/helpers';
import { config } from '../../app/config';
import logger from '../../utils/logger';
import { prisma } from '../../database/prisma.client';
import { authService } from '../auth/auth.service';

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

const userSessionSchema = z.object({
    telegramId: z.string().min(1),
    username: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
});

const telegramQuerySchema = z.object({
    telegramId: z.string().min(1),
    limit: z.string().optional(),
});

const authRegisterSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
});

const authLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

const confirmTelegramLinkSchema = z.object({
    code: z.string().min(4),
    telegramId: z.string().min(1),
    username: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export const apiRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /api/health
    fastify.get('/health', async (req, reply) => {
        return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // POST /api/auth/register
    fastify.post('/auth/register', async (req, reply) => {
        const parsed = authRegisterSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        try {
            const result = await authService.register(parsed.data);
            return { success: true, data: result };
        } catch (err) {
            return reply.status(400).send({ success: false, error: (err as Error).message });
        }
    });

    // POST /api/auth/login
    fastify.post('/auth/login', async (req, reply) => {
        const parsed = authLoginSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        try {
            const result = await authService.login(parsed.data);
            return { success: true, data: result };
        } catch (err) {
            return reply.status(401).send({ success: false, error: (err as Error).message });
        }
    });

    // GET /api/auth/me
    fastify.get('/auth/me', async (req, reply) => {
        try {
            const user = await authService.requireUser(req.headers.authorization);
            return { success: true, data: { user } };
        } catch {
            return reply.status(401).send({ success: false, error: 'Unauthorized' });
        }
    });

    // POST /api/auth/telegram-link/code
    fastify.post('/auth/telegram-link/code', async (req, reply) => {
        try {
            const webUser = await authService.requireUser(req.headers.authorization);
            const result = await authService.createTelegramLinkCode(webUser.id);
            return { success: true, data: result };
        } catch (err) {
            const message = (err as Error).message;
            return reply.status(message === 'Unauthorized' ? 401 : 400).send({ success: false, error: message });
        }
    });

    // POST /api/auth/telegram-link/confirm
    fastify.post('/auth/telegram-link/confirm', async (req, reply) => {
        const parsed = confirmTelegramLinkSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        try {
            const user = await authService.confirmTelegramLink(parsed.data);
            return { success: true, data: { user } };
        } catch (err) {
            return reply.status(400).send({ success: false, error: (err as Error).message });
        }
    });

    // GET /api/services
    fastify.get('/services', async (req, reply) => {
        const services = await serviceService.getServices();
        const serviceIds = services.map((service) => service.id);
        const priceStats = serviceIds.length
            ? await prisma.price.groupBy({
                by: ['serviceId'],
                where: { serviceId: { in: serviceIds }, isActive: true },
                _min: { sellPrice: true },
                _count: { _all: true },
            })
            : [];
        const statsByService = new Map(priceStats.map((stat) => [stat.serviceId, stat]));

        return {
            success: true,
            data: services.map((service) => {
                const stat = statsByService.get(service.id);
                return {
                    ...service,
                    minSellPrice: stat?._min.sellPrice ?? null,
                    priceCount: stat?._count._all ?? 0,
                };
            }),
        };
    });

    // POST /api/user/session
    fastify.post('/user/session', async (req, reply) => {
        const parsed = userSessionSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        const user = await userService.findOrCreate(parsed.data.telegramId, {
            username: parsed.data.username,
            firstName: parsed.data.firstName,
            lastName: parsed.data.lastName,
        });

        return {
            success: true,
            data: {
                id: user.id,
                telegramId: user.telegramId,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                balance: user.balance,
                isActive: user.isActive,
                createdAt: user.createdAt,
            },
        };
    });

    // GET /api/user/profile?telegramId= or Authorization: Bearer <token>
    fastify.get('/user/profile', async (req, reply) => {
        const query = req.query as { telegramId?: string };
        let telegramId = query.telegramId;
        let webUser = null;

        if (!telegramId && req.headers.authorization) {
            try {
                webUser = await authService.getUserFromAuthHeader(req.headers.authorization);
            } catch {
                return reply.status(401).send({ success: false, error: 'Unauthorized' });
            }
            telegramId = webUser?.telegramId ?? undefined;
        }

        if (!telegramId) {
            return {
                success: true,
                data: {
                    webUser,
                    user: null,
                    telegramLinked: false,
                    summary: {
                        ordersCount: 0,
                        successOrders: 0,
                        successRate: 0,
                        activeOrders: 0,
                        depositTotal: 0,
                        spentTotal: 0,
                        refundTotal: 0,
                        invoicesCount: 0,
                    },
                    recentOrders: [],
                    recentTransactions: [],
                    recentInvoices: [],
                },
            };
        }

        const user = await userService.findOrCreate(telegramId);
        const [orders, transactions, invoices] = await Promise.all([
            orderService.getOrders(user.id, 100),
            userService.getTransactions(user.id, 100),
            paymentService.getInvoices(user.id, 50),
        ]);

        const successOrders = orders.filter((order) => order.status === 'SUCCESS').length;
        const depositTotal = transactions
            .filter((tx) => tx.type === 'DEPOSIT')
            .reduce((sum, tx) => sum + tx.amount, 0);
        const spentTotal = Math.abs(transactions
            .filter((tx) => tx.type === 'DEDUCT')
            .reduce((sum, tx) => sum + tx.amount, 0));
        const refundTotal = transactions
            .filter((tx) => tx.type === 'REFUND')
            .reduce((sum, tx) => sum + tx.amount, 0);

        return {
            success: true,
            data: {
                user: {
                    id: user.id,
                    telegramId: user.telegramId,
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    balance: user.balance,
                    isActive: user.isActive,
                    createdAt: user.createdAt,
                },
                webUser,
                telegramLinked: true,
                summary: {
                    ordersCount: orders.length,
                    successOrders,
                    successRate: orders.length ? Math.round((successOrders / orders.length) * 1000) / 10 : 0,
                    activeOrders: orders.filter((order) => order.status === 'ACTIVE').length,
                    depositTotal,
                    spentTotal,
                    refundTotal,
                    invoicesCount: invoices.length,
                },
                recentOrders: orders.slice(0, 5),
                recentTransactions: transactions.slice(0, 10),
                recentInvoices: invoices.slice(0, 5),
            },
        };
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

    // GET /api/transactions?telegramId=
    fastify.get('/transactions', async (req, reply) => {
        const parsed = telegramQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        const user = await userService.getByTelegramId(parsed.data.telegramId);
        if (!user) return { success: true, data: [] };

        const rawLimit = Number(parsed.data.limit ?? 25);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 25;
        const transactions = await userService.getTransactions(user.id, limit);
        return { success: true, data: transactions };
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
