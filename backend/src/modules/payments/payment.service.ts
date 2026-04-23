import crypto from 'crypto';
import { prisma } from '../../database/prisma.client';
import { userService } from '../users/user.service';
import { config } from '../../app/config';
import logger from '../../utils/logger';
import { referralService } from '../referrals/referral.service';
import { pakasirService } from './pakasir.service';

type LegacyWebhookBody = {
    invoiceId?: string;
    amount?: number;
    signature?: string;
    secret?: string;
    [key: string]: unknown;
};

type PakasirWebhookBody = {
    amount?: number;
    order_id?: string;
    project?: string;
    status?: string;
    payment_method?: string;
    completed_at?: string;
    [key: string]: unknown;
};

export const paymentService = {
    async createInvoice(userId: string, requestedAmount: number) {
        if (requestedAmount < 10000) throw new Error('Minimum deposit is Rp10.000');
        await paymentService.expireOverdueInvoices();
        pakasirService.assertConfigured();

        const invoice = await prisma.invoice.create({
            data: {
                userId,
                amount: requestedAmount,
                baseAmount: requestedAmount,
                gatewayFee: 0,
                provider: 'PAKASIR',
                paymentMethod: config.PAKASIR_PAYMENT_METHOD || 'qris',
                gatewayOrderId: null,
                paymentUrl: null,
                gatewayPayload: null,
                qrisPayload: '',
                status: 'PENDING',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            },
        });

        try {
            const payment = await pakasirService.createTransaction({
                orderId: invoice.id,
                amount: requestedAmount,
            });

            const updated = await prisma.invoice.update({
                where: { id: invoice.id },
                data: {
                    amount: payment.totalPayment,
                    baseAmount: payment.amount,
                    gatewayFee: payment.fee,
                    provider: 'PAKASIR',
                    paymentMethod: payment.paymentMethod,
                    gatewayOrderId: payment.orderId || invoice.id,
                    paymentUrl: pakasirService.buildHostedPaymentUrl(payment.orderId || invoice.id, payment.amount),
                    gatewayPayload: JSON.stringify(payment),
                    qrisPayload: payment.paymentNumber,
                    expiredAt: safeDate(payment.expiredAt) ?? invoice.expiredAt,
                },
            });

            logger.info(
                {
                    invoiceId: updated.id,
                    userId,
                    creditAmount: updated.baseAmount,
                    totalPayment: updated.amount,
                    gatewayFee: updated.gatewayFee,
                    provider: updated.provider,
                },
                'Pakasir invoice created'
            );

            return updated;
        } catch (err) {
            await prisma.invoice.delete({ where: { id: invoice.id } }).catch(() => null);
            logger.error({ err, invoiceId: invoice.id, userId }, 'Failed to create Pakasir invoice');
            throw err;
        }
    },

    async handleWebhook(
        body: LegacyWebhookBody | PakasirWebhookBody,
        rawBody: string,
        input: { webhookToken?: string } = {}
    ): Promise<{ success: boolean; message: string }> {
        await paymentService.expireOverdueInvoices();

        if (isPakasirWebhook(body)) {
            return handlePakasirWebhook(body, input.webhookToken);
        }

        return handleLegacyWebhook(body as LegacyWebhookBody, rawBody);
    },

    async getInvoices(userId: string, limit = 10) {
        await paymentService.expireOverdueInvoices();

        return prisma.invoice.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    },

    async getInvoiceForUser(invoiceId: string, userId: string) {
        await paymentService.expireOverdueInvoices();

        return prisma.invoice.findFirst({
            where: { id: invoiceId, userId },
        });
    },

    async getAllInvoices(limit = 50) {
        await paymentService.expireOverdueInvoices();

        return prisma.invoice.findMany({
            include: { user: { select: { telegramId: true, username: true } } },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    },

    async reconcilePendingInvoices(limit = 25) {
        await paymentService.expireOverdueInvoices();

        const pendingInvoices = await prisma.invoice.findMany({
            where: {
                status: 'PENDING',
                provider: 'PAKASIR',
            },
            orderBy: { createdAt: 'asc' },
            take: Math.min(Math.max(limit, 1), 100),
        });

        const summary = {
            inspected: pendingInvoices.length,
            completed: 0,
            expired: 0,
            cancelled: 0,
            failed: 0,
        };

        for (const invoice of pendingInvoices) {
            try {
                const detail = await pakasirService.getTransactionDetail({
                    orderId: invoice.gatewayOrderId || invoice.id,
                    amount: invoice.baseAmount || invoice.amount,
                });

                if (detail.status === 'completed') {
                    await confirmInvoicePaid(invoice.id, {
                        paidAt: safeDate(detail.completedAt) ?? new Date(),
                        gatewayCompletedAt: safeDate(detail.completedAt),
                        paymentMethod: detail.paymentMethod || invoice.paymentMethod || 'qris',
                        gatewayPayload: detail,
                    });
                    summary.completed += 1;
                    continue;
                }

                if (invoice.expiredAt && invoice.expiredAt.getTime() <= Date.now()) {
                    try {
                        await pakasirService.cancelTransaction({
                            orderId: invoice.gatewayOrderId || invoice.id,
                            amount: invoice.baseAmount || invoice.amount,
                        });
                        summary.cancelled += 1;
                    } catch (err) {
                        logger.warn({ err, invoiceId: invoice.id }, 'Failed to cancel expired Pakasir invoice during reconcile');
                    }

                    await markInvoiceExpired(invoice.id);
                    summary.expired += 1;
                }
            } catch (err) {
                summary.failed += 1;
                logger.warn({ err, invoiceId: invoice.id }, 'Failed to reconcile Pakasir invoice');
            }
        }

        return summary;
    },

    async expireOverdueInvoices(now = new Date()) {
        const result = await prisma.invoice.updateMany({
            where: {
                status: 'PENDING',
                expiredAt: { lte: now },
            },
            data: { status: 'EXPIRED' },
        });

        if (result.count > 0) {
            logger.info({ count: result.count }, 'Expired overdue invoices');
        }

        return result.count;
    },
};

async function handlePakasirWebhook(
    body: PakasirWebhookBody,
    webhookToken?: string
): Promise<{ success: boolean; message: string }> {
    if (config.PAKASIR_WEBHOOK_TOKEN && webhookToken !== config.PAKASIR_WEBHOOK_TOKEN) {
        logger.warn({ orderId: body.order_id }, 'Rejected Pakasir webhook because webhook token did not match');
        return { success: false, message: 'Invalid webhook token' };
    }

    const orderId = String(body.order_id || '').trim();
    const status = String(body.status || '').trim().toLowerCase();
    const baseAmount = Number(body.amount || 0);

    if (!orderId) {
        return { success: false, message: 'Missing order_id' };
    }

    if (status !== 'completed') {
        logger.info({ orderId, status }, 'Ignoring non-completed Pakasir webhook');
        return { success: true, message: `Ignored webhook status ${status || 'unknown'}` };
    }

    const invoice = await prisma.invoice.findFirst({
        where: {
            OR: [
                { gatewayOrderId: orderId },
                { id: orderId },
            ],
        },
    });

    if (!invoice) {
        return { success: false, message: 'Invoice not found' };
    }

    if (invoice.status === 'PAID') {
        return { success: true, message: 'Already paid' };
    }

    if (invoice.status === 'EXPIRED') {
        return { success: false, message: 'Invoice expired' };
    }

    const detail = await pakasirService.getTransactionDetail({
        orderId,
        amount: baseAmount || invoice.baseAmount || invoice.amount,
    });

    if (detail.status !== 'completed') {
        return { success: false, message: 'Transaction not completed' };
    }

    if (detail.project !== config.PAKASIR_PROJECT_SLUG) {
        return { success: false, message: 'Project mismatch' };
    }

    if (detail.orderId !== (invoice.gatewayOrderId || invoice.id)) {
        return { success: false, message: 'Order mismatch' };
    }

    if (detail.amount !== invoice.baseAmount) {
        logger.warn(
            {
                invoiceId: invoice.id,
                expected: invoice.baseAmount,
                received: detail.amount,
            },
            'Pakasir detail amount mismatch'
        );
        return { success: false, message: 'Amount mismatch' };
    }

    const confirmed = await confirmInvoicePaid(invoice.id, {
        paidAt: safeDate(body.completed_at) ?? safeDate(detail.completedAt) ?? new Date(),
        gatewayCompletedAt: safeDate(detail.completedAt),
        paymentMethod: detail.paymentMethod || String(body.payment_method || invoice.paymentMethod || 'qris'),
        gatewayPayload: {
            webhook: body,
            detail,
        },
    });

    return {
        success: true,
        message: confirmed ? 'Payment confirmed' : 'Already paid',
    };
}

async function handleLegacyWebhook(
    body: LegacyWebhookBody,
    rawBody: string
): Promise<{ success: boolean; message: string }> {
    let isAuthenticated = false;

    if (config.PAYMENT_WEBHOOK_SECRET) {
        if (body.secret && body.secret === config.PAYMENT_WEBHOOK_SECRET) {
            isAuthenticated = true;
        } else if (body.signature) {
            const expectedSig = crypto
                .createHmac('sha256', config.PAYMENT_WEBHOOK_SECRET)
                .update(rawBody)
                .digest('hex');
            if (body.signature === expectedSig) isAuthenticated = true;
        }
    }

    if (!isAuthenticated) {
        logger.warn('Legacy payment webhook authentication failed');
        return { success: false, message: 'Invalid signature or secret' };
    }

    const invoiceId = String(body.invoiceId || '').trim();
    const amount = body.amount ? Number(body.amount) : undefined;

    if (!invoiceId && !amount) {
        return { success: false, message: 'Missing invoiceId or amount' };
    }

    let invoice = null;
    if (invoiceId) {
        invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    } else if (amount) {
        invoice = await prisma.invoice.findFirst({
            where: { amount: amount, status: 'PENDING' },
        });
    }

    if (!invoice) return { success: false, message: 'Invoice not found' };
    if (invoice.status === 'PAID') return { success: true, message: 'Already paid' };
    if (invoice.status === 'EXPIRED') return { success: false, message: 'Invoice expired' };

    if (amount && invoice.amount !== amount) {
        return { success: false, message: 'Amount mismatch' };
    }

    const confirmed = await confirmInvoicePaid(invoice.id, {
        paidAt: new Date(),
        paymentMethod: invoice.paymentMethod || 'qris',
        gatewayPayload: {
            legacyWebhook: body,
        },
    });

    return {
        success: true,
        message: confirmed ? 'Payment confirmed' : 'Already paid',
    };
}

async function confirmInvoicePaid(
    invoiceId: string,
    input: {
        paidAt: Date;
        gatewayCompletedAt?: Date | null;
        paymentMethod?: string;
        gatewayPayload?: unknown;
    }
) {
    return prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
            where: { id: invoiceId },
        });

        if (!invoice) {
            throw new Error('Invoice not found');
        }

        if (invoice.status === 'PAID') {
            return false;
        }

        if (invoice.status === 'EXPIRED') {
            throw new Error('Invoice expired');
        }

        const updated = await tx.invoice.updateMany({
            where: {
                id: invoiceId,
                status: 'PENDING',
            },
            data: {
                status: 'PAID',
                paidAt: input.paidAt,
                gatewayCompletedAt: input.gatewayCompletedAt ?? input.paidAt,
                paymentMethod: input.paymentMethod || invoice.paymentMethod,
                gatewayPayload: input.gatewayPayload ? JSON.stringify(input.gatewayPayload) : invoice.gatewayPayload,
            },
        });

        if (!updated.count) {
            return false;
        }

        const amountToCredit = invoice.baseAmount > 0 ? invoice.baseAmount : invoice.amount;

        await userService.addBalance(
            invoice.userId,
            amountToCredit,
            'DEPOSIT',
            `Deposit via ${invoice.provider === 'PAKASIR' ? 'Pakasir' : 'QRIS'}`,
            invoice.id
        );

        await referralService.processQualifiedDeposit(invoice.userId, invoice.id);

        logger.info(
            {
                invoiceId: invoice.id,
                userId: invoice.userId,
                credited: amountToCredit,
                totalPayment: invoice.amount,
                provider: invoice.provider,
            },
            'Deposit confirmed'
        );

        return true;
    });
}

async function markInvoiceExpired(invoiceId: string) {
    await prisma.invoice.updateMany({
        where: {
            id: invoiceId,
            status: 'PENDING',
        },
        data: { status: 'EXPIRED' },
    });
}

function isPakasirWebhook(body: LegacyWebhookBody | PakasirWebhookBody): body is PakasirWebhookBody {
    return Boolean((body as PakasirWebhookBody).order_id || (body as PakasirWebhookBody).project);
}

function safeDate(value?: string | Date | null) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}
