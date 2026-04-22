import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
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

const depositProofSchema = z.object({
    invoiceId: z.string().min(1),
    telegramId: z.string().min(1),
    fileName: z.string().min(1).max(160),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    dataBase64: z.string().min(100).max(7_000_000),
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

const authGoogleSchema = z.object({
    credential: z.string().min(100),
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
    fastify.post('/auth/register', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
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
    fastify.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
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

    // GET /api/auth/google/config
    fastify.get('/auth/google/config', async () => {
        return {
            success: true,
            data: {
                enabled: Boolean(config.GOOGLE_CLIENT_ID),
                clientId: config.GOOGLE_CLIENT_ID || null,
            },
        };
    });

    // POST /api/auth/google
    fastify.post('/auth/google', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
        const parsed = authGoogleSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        try {
            const result = await authService.loginWithGoogle(parsed.data.credential);
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
    fastify.post('/auth/telegram-link/code', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
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
    fastify.post('/auth/telegram-link/confirm', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
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
    fastify.post('/user/session', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
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
            countries = await serviceService.getCountriesWithPriceByService(query.serviceId);
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
    fastify.post('/order', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
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
    fastify.post('/deposit', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
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

    // GET /api/deposit/:invoiceId/qris.png?telegramId=
    fastify.get('/deposit/:invoiceId/qris.png', async (req, reply) => {
        const params = req.params as { invoiceId?: string };
        const query = req.query as { telegramId?: string };
        if (!params.invoiceId || !query.telegramId) {
            return reply.status(400).send({ success: false, error: 'invoiceId and telegramId required' });
        }

        const user = await userService.getByTelegramId(query.telegramId);
        if (!user) return reply.status(404).send({ success: false, error: 'User not found' });

        const invoice = await prisma.invoice.findFirst({
            where: { id: params.invoiceId, userId: user.id },
            select: { qrisPayload: true },
        });
        if (!invoice?.qrisPayload) return reply.status(404).send({ success: false, error: 'Invoice not found' });

        const png = await QRCode.toBuffer(invoice.qrisPayload, {
            type: 'png',
            width: 900,
            margin: 4,
            errorCorrectionLevel: 'H',
            color: { dark: '#000000', light: '#FFFFFF' },
        });

        reply.header('Cache-Control', 'no-store');
        reply.type('image/png').send(png);
    });

    // POST /api/deposit/proof
    fastify.post('/deposit/proof', {
        bodyLimit: 8 * 1024 * 1024,
        config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    }, async (req, reply) => {
        const parsed = depositProofSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.flatten().fieldErrors });
        }

        try {
            const webUser = await authService.requireUser(req.headers.authorization);
            if (webUser.telegramId !== parsed.data.telegramId) {
                return reply.status(403).send({ success: false, error: 'Akun Telegram belum tertaut ke akun web ini' });
            }
            const result = await handleWebDepositProof(parsed.data);
            return { success: true, data: result };
        } catch (err) {
            const message = (err as Error).message;
            return reply.status(message === 'Unauthorized' ? 401 : 400).send({ success: false, error: message });
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

async function handleWebDepositProof(input: z.infer<typeof depositProofSchema>) {
    await paymentService.expireOverdueInvoices();

    const adminIds = parseTelegramAdminIds(config.TELEGRAM_ADMIN_IDS);
    if (!adminIds.length) throw new Error('Admin Telegram belum dikonfigurasi');

    const user = await userService.getByTelegramId(input.telegramId);
    if (!user) throw new Error('User Telegram tidak ditemukan');

    const invoice = await prisma.invoice.findFirst({
        where: { id: input.invoiceId, userId: user.id },
        select: {
            id: true,
            amount: true,
            baseAmount: true,
            status: true,
            expiredAt: true,
            createdAt: true,
            user: { select: { telegramId: true, username: true, firstName: true, lastName: true } },
        },
    });

    if (!invoice) throw new Error('Invoice tidak ditemukan');
    if (invoice.status === 'PAID') throw new Error('Invoice sudah dibayar');
    if (invoice.status === 'EXPIRED') throw new Error('Invoice sudah expired');
    if (invoice.expiredAt && invoice.expiredAt.getTime() <= Date.now()) {
        await paymentService.expireOverdueInvoices();
        throw new Error('Invoice sudah expired');
    }

    const cleanBase64 = input.dataBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length < 100) throw new Error('File bukti tidak valid');
    if (buffer.length > 5 * 1024 * 1024) throw new Error('Ukuran bukti maksimal 5MB');

    const caption = [
        'Deposit baru dari web menunggu konfirmasi manual',
        '',
        `Invoice ID: ${invoice.id}`,
        `Telegram ID user: ${invoice.user.telegramId}`,
        `Username: ${invoice.user.username ? `@${invoice.user.username}` : '-'}`,
        `Jumlah saldo: ${formatRupiahPlain(invoice.baseAmount || invoice.amount)}`,
        `Nominal QRIS: ${formatRupiahPlain(invoice.amount)}`,
        `Kadaluarsa: ${invoice.expiredAt ? invoice.expiredAt.toLocaleString('id-ID') : '-'}`,
        '',
        'Bukti transfer terlampir. Cek mutasi/payment dulu. Jika uang sudah masuk sesuai nominal QRIS, tekan Konfirmasi.',
    ].join('\n');

    const replyMarkup = {
        inline_keyboard: [
            [{ text: '✅ Konfirmasi saldo masuk', callback_data: `pay_ok:${invoice.id}:${invoice.user.telegramId}` }],
            [{ text: '❌ Belum masuk', callback_data: `pay_no:${invoice.id}:${invoice.user.telegramId}` }],
        ],
    };

    let sentCount = 0;
    for (const adminId of adminIds) {
        const ok = await sendTelegramPhoto(adminId, buffer, input.mimeType, input.fileName, caption, replyMarkup);
        if (ok) sentCount += 1;
    }

    if (!sentCount) throw new Error('Bukti belum berhasil dikirim ke Telegram admin');

    logger.info({ invoiceId: invoice.id, sentCount }, 'Web deposit proof sent to Telegram admins');
    return { sentCount };
}

async function sendTelegramPhoto(
    chatId: string,
    buffer: Buffer,
    mimeType: string,
    fileName: string,
    caption: string,
    replyMarkup: object
) {
    const Fetch = (globalThis as any).fetch;
    const FormDataCtor = (globalThis as any).FormData;
    const BlobCtor = (globalThis as any).Blob;

    if (!Fetch || !FormDataCtor || !BlobCtor) {
        throw new Error('Runtime tidak mendukung upload file Telegram');
    }

    const form = new FormDataCtor();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('reply_markup', JSON.stringify(replyMarkup));
    form.append('photo', new BlobCtor([buffer], { type: mimeType }), sanitizeFileName(fileName));

    try {
        const res = await Fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
            method: 'POST',
            body: form,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || body?.ok === false) {
            logger.warn({ chatId, status: res.status, body }, 'Failed to send web deposit proof to Telegram');
            return false;
        }
        return true;
    } catch (err) {
        logger.warn({ err, chatId }, 'Telegram proof upload request failed');
        return false;
    }
}

function parseTelegramAdminIds(value: string): string[] {
    return value
        .split(/[,\s]+/)
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id));
}

function sanitizeFileName(value: string) {
    return value.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'bukti-transfer.jpg';
}

function formatRupiahPlain(value: number) {
    return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}
