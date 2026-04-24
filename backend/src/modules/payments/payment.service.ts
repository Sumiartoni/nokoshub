import crypto from 'crypto';
import { prisma } from '../../database/prisma.client';
import { userService } from '../users/user.service';
import { config } from '../../app/config';
import logger from '../../utils/logger';
import { referralService } from '../referrals/referral.service';
import { bayarGgService, type BayarGgWebhookPayload } from './bayargg.service';
import { paymentSettingsService } from '../settings/payment-settings.service';

type LegacyWebhookBody = {
    invoiceId?: string;
    amount?: number;
    signature?: string;
    secret?: string;
    [key: string]: unknown;
};

type PaymentWebhookBody = LegacyWebhookBody | BayarGgWebhookPayload;

export const paymentService = {
    async createInvoice(userId: string, requestedAmount: number) {
        const paymentSettings = await paymentSettingsService.getSettings();
        if (requestedAmount < paymentSettings.minimumDeposit) {
            throw new Error(`Minimum deposit is Rp${paymentSettings.minimumDeposit.toLocaleString('id-ID')}`);
        }
        await paymentService.expireOverdueInvoices();
        bayarGgService.assertConfigured();

        const invoice = await prisma.invoice.create({
            data: {
                userId,
                amount: requestedAmount,
                baseAmount: requestedAmount,
                gatewayFee: 0,
                provider: 'BAYAR_GG',
                paymentMethod: config.BAYAR_GG_PAYMENT_METHOD || 'qris',
                gatewayOrderId: null,
                paymentUrl: null,
                gatewayPayload: null,
                qrisPayload: '',
                status: 'PENDING',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            },
        });

        try {
            const payment = await bayarGgService.createPayment({
                amount: requestedAmount,
                description: `Deposit NokosHUB ${invoice.id}`,
            });

            const updated = await prisma.invoice.update({
                where: { id: invoice.id },
                data: {
                    amount: payment.finalAmount,
                    baseAmount: payment.amount,
                    gatewayFee: payment.uniqueCode,
                    provider: 'BAYAR_GG',
                    paymentMethod: payment.paymentMethod,
                    gatewayOrderId: payment.invoiceId || invoice.id,
                    paymentUrl: payment.paymentUrl || null,
                    gatewayPayload: JSON.stringify({
                        ...asObject(payment.raw),
                        qrisImageUrl: payment.qrisImageUrl || null,
                    }),
                    qrisPayload: payment.qrisPayload || '',
                    expiredAt: safeDate(payment.expiresAt) ?? invoice.expiredAt,
                },
            });

            logger.info(
                {
                    invoiceId: updated.id,
                    gatewayInvoiceId: updated.gatewayOrderId,
                    userId,
                    creditAmount: updated.baseAmount,
                    totalPayment: updated.amount,
                    gatewayFee: updated.gatewayFee,
                    provider: updated.provider,
                },
                'BAYAR GG invoice created'
            );

            return updated;
        } catch (err) {
            await prisma.invoice.delete({ where: { id: invoice.id } }).catch(() => null);
            logger.error({ err, invoiceId: invoice.id, userId }, 'Failed to create BAYAR GG invoice');
            throw err;
        }
    },

    async handleWebhook(
        body: PaymentWebhookBody,
        rawBody: string,
        input: { headers?: Record<string, any>; webhookToken?: string } = {}
    ): Promise<{ success: boolean; message: string }> {
        await paymentService.expireOverdueInvoices();

        if (isBayarGgWebhook(body)) {
            return handleBayarGgWebhook(body, input.headers || {});
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

    async syncInvoiceForUser(invoiceId: string, userId: string) {
        await paymentService.expireOverdueInvoices();

        const invoice = await prisma.invoice.findFirst({
            where: { id: invoiceId, userId },
        });
        if (!invoice) return null;

        if (invoice.provider !== 'BAYAR_GG' || invoice.status !== 'PENDING') {
            return invoice;
        }

        try {
            const detail = await bayarGgService.checkPayment(invoice.gatewayOrderId || invoice.id);

            if (detail.status === 'paid') {
                await confirmInvoicePaid(invoice.id, {
                    paidAt: safeDate(detail.paidAt) ?? new Date(),
                    gatewayCompletedAt: safeDate(detail.paidAt),
                    paymentMethod: detail.paymentMethod || invoice.paymentMethod || 'qris',
                    gatewayPayload: detail.raw,
                });
            } else if (detail.status === 'expired' || detail.status === 'cancelled') {
                await markInvoiceExpired(invoice.id);
            } else if (invoice.expiredAt && invoice.expiredAt.getTime() <= Date.now()) {
                await markInvoiceExpired(invoice.id);
            }
        } catch (err) {
            logger.warn({ err, invoiceId: invoice.id }, 'Failed to sync BAYAR GG invoice on status check');
        }

        return prisma.invoice.findFirst({
            where: { id: invoiceId, userId },
        });
    },

    async syncPendingInvoicesForUser(userId: string, limit = 10) {
        await paymentService.expireOverdueInvoices();

        const pendingInvoices = await prisma.invoice.findMany({
            where: {
                userId,
                provider: 'BAYAR_GG',
                status: 'PENDING',
            },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Math.max(limit, 1), 20),
        });

        for (const invoice of pendingInvoices) {
            try {
                const detail = await bayarGgService.checkPayment(invoice.gatewayOrderId || invoice.id);

                if (detail.status === 'paid') {
                    await confirmInvoicePaid(invoice.id, {
                        paidAt: safeDate(detail.paidAt) ?? new Date(),
                        gatewayCompletedAt: safeDate(detail.paidAt),
                        paymentMethod: detail.paymentMethod || invoice.paymentMethod || 'qris',
                        gatewayPayload: detail.raw,
                    });
                    continue;
                }

                if (detail.status === 'expired' || detail.status === 'cancelled') {
                    await markInvoiceExpired(invoice.id);
                    continue;
                }

                if (invoice.expiredAt && invoice.expiredAt.getTime() <= Date.now()) {
                    await markInvoiceExpired(invoice.id);
                }
            } catch (err) {
                logger.warn({ err, invoiceId: invoice.id, userId }, 'Failed to sync pending BAYAR GG invoice for user');
            }
        }
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
                provider: 'BAYAR_GG',
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
                const detail = await bayarGgService.checkPayment(invoice.gatewayOrderId || invoice.id);

                if (detail.status === 'paid') {
                    await confirmInvoicePaid(invoice.id, {
                        paidAt: safeDate(detail.paidAt) ?? new Date(),
                        gatewayCompletedAt: safeDate(detail.paidAt),
                        paymentMethod: detail.paymentMethod || invoice.paymentMethod || 'qris',
                        gatewayPayload: detail.raw,
                    });
                    summary.completed += 1;
                    continue;
                }

                if (detail.status === 'expired' || detail.status === 'cancelled') {
                    await markInvoiceExpired(invoice.id);
                    if (detail.status === 'cancelled') summary.cancelled += 1;
                    else summary.expired += 1;
                    continue;
                }

                if (invoice.expiredAt && invoice.expiredAt.getTime() <= Date.now()) {
                    await markInvoiceExpired(invoice.id);
                    summary.expired += 1;
                }
            } catch (err) {
                summary.failed += 1;
                logger.warn({ err, invoiceId: invoice.id }, 'Failed to reconcile BAYAR GG invoice');
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

async function handleBayarGgWebhook(
    body: BayarGgWebhookPayload,
    headers: Record<string, any>
): Promise<{ success: boolean; message: string }> {
    if (!bayarGgService.verifyWebhookSignature(body, headers)) {
        logger.warn(
            {
                invoiceId: body.invoice_id,
                hasHeaderSignature: Boolean(headers['x-webhook-signature']),
                hasHeaderTimestamp: Boolean(headers['x-webhook-timestamp']),
                hasBodySignature: Boolean(body.signature),
                hasBodyTimestamp: Boolean(body.timestamp),
                status: body.status,
                finalAmount: body.final_amount,
            },
            'Rejected BAYAR GG webhook because signature did not match'
        );
        return { success: false, message: 'Invalid webhook signature' };
    }

    const externalInvoiceId = String(body.invoice_id || '').trim();
    const status = String(body.status || '').trim().toLowerCase();
    const finalAmount = Number(body.final_amount || 0);

    if (!externalInvoiceId) {
        return { success: false, message: 'Missing invoice_id' };
    }

    if (status !== 'paid') {
        logger.info({ externalInvoiceId, status }, 'Ignoring non-paid BAYAR GG webhook');
        return { success: true, message: `Ignored webhook status ${status || 'unknown'}` };
    }

    const invoice = await prisma.invoice.findFirst({
        where: {
            OR: [
                { gatewayOrderId: externalInvoiceId },
                { id: externalInvoiceId },
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

    if (finalAmount && invoice.amount !== Math.trunc(finalAmount)) {
        logger.warn(
            {
                invoiceId: invoice.id,
                expected: invoice.amount,
                received: Math.trunc(finalAmount),
            },
            'BAYAR GG final amount mismatch'
        );
        return { success: false, message: 'Amount mismatch' };
    }

    const confirmed = await confirmInvoicePaid(invoice.id, {
        paidAt: safeDate(body.paid_at) ?? new Date(),
        gatewayCompletedAt: safeDate(body.paid_at),
        paymentMethod: invoice.paymentMethod || config.BAYAR_GG_PAYMENT_METHOD || 'qris',
        gatewayPayload: {
            webhook: body,
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
            where: { amount, status: 'PENDING' },
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
            `Deposit via ${invoice.provider === 'BAYAR_GG' ? 'BAYAR GG' : 'QRIS'}`,
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

function isBayarGgWebhook(body: PaymentWebhookBody): body is BayarGgWebhookPayload {
    return Boolean((body as BayarGgWebhookPayload).invoice_id || (body as BayarGgWebhookPayload).event);
}

function safeDate(value?: string | Date | null) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function asObject(value: unknown) {
    return value && typeof value === 'object' ? value : {};
}
