import crypto from 'crypto';
import { prisma } from '../../database/prisma.client';
import { userService } from '../users/user.service';
import { generateDynamicQRIS } from './qris.service';
import { config } from '../../app/config';
import logger from '../../utils/logger';

export const paymentService = {
    /**
     * Create a new deposit invoice with a dynamic QRIS payload
     */
    async createInvoice(userId: string, amount: number) {
        if (amount < 10000) throw new Error('Minimum deposit is Rp10.000');
        // Give the user a unique final amount (append random 1-999)
        let finalAmount = amount;
        let isUnique = false;

        for (let i = 0; i < 20; i++) {
            const uniqueCode = Math.floor(Math.random() * 999) + 1;
            finalAmount = amount + uniqueCode;

            const existing = await prisma.invoice.findFirst({
                where: { amount: finalAmount, status: 'PENDING' }
            });
            if (!existing) {
                isUnique = true;
                break;
            }
        }

        if (!isUnique) throw new Error('Sistem sedang sibuk, silakan coba lagi nanti');

        // Create new invoice record first to get the ID
        const invoice = await prisma.invoice.create({
            data: {
                userId,
                amount: finalAmount, // Save unique amount
                baseAmount: amount,  // Save the original requested amount
                status: 'PENDING',
                qrisPayload: '', // will update below
                expiredAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
            },
        });

        // Generate dynamic QRIS with invoice ID as reference
        const qrisPayload = generateDynamicQRIS(
            config.QRIS_STATIC_STRING,
            finalAmount,
            invoice.id.substring(0, 25)
        );

        // Update invoice with QRIS payload
        const updatedInvoice = await prisma.invoice.update({
            where: { id: invoice.id },
            data: { qrisPayload },
        });

        logger.info({ invoiceId: invoice.id, userId, amount }, 'Invoice created');
        return updatedInvoice;
    },

    /**
     * Handle incoming payment webhook from notifier system
     * Verifies signature → marks invoice paid → credits user balance
     */
    async handleWebhook(
        body: {
            invoiceId?: string;
            amount?: number;
            signature?: string;
            secret?: string;
            [key: string]: unknown;
        },
        rawBody: string
    ): Promise<{ success: boolean; message: string }> {
        // 1. Verify Authentication: either via HMAC signature on rawBody, or direct secret pass (for simple forwarders)
        let isAuthenticated = false;

        if (body.secret && body.secret === config.PAYMENT_WEBHOOK_SECRET) {
            isAuthenticated = true;
        } else if (body.signature) {
            const expectedSig = crypto
                .createHmac('sha256', config.PAYMENT_WEBHOOK_SECRET)
                .update(rawBody)
                .digest('hex');
            if (body.signature === expectedSig) isAuthenticated = true;
        }

        if (!isAuthenticated) {
            logger.warn('Webhook authentication failed');
            return { success: false, message: 'Invalid signature or secret' };
        }

        const { invoiceId, amount } = body;

        if (!invoiceId && !amount) {
            return { success: false, message: 'Missing invoiceId or amount' };
        }

        // 2. Find invoice
        let invoice;
        if (invoiceId) {
            invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
        } else if (amount) {
            // Find by exact unique amount among pending invoices
            invoice = await prisma.invoice.findFirst({
                where: { amount: Number(amount), status: 'PENDING' }
            });
        }

        if (!invoice) return { success: false, message: 'Invoice not found' };
        if (invoice.status === 'PAID') return { success: true, message: 'Already paid' };
        if (invoice.status === 'EXPIRED') return { success: false, message: 'Invoice expired' };

        // 3. Verify amount (if invoiceId was provided but amount didn't match, or just double check)
        const checkAmount = amount ? Number(amount) : undefined;
        if (checkAmount && invoice.amount !== checkAmount) {
            logger.warn({ invoiceId: invoice.id, expected: invoice.amount, received: checkAmount }, 'Amount mismatch');
            return { success: false, message: 'Amount mismatch' };
        }

        // 4. Mark invoice as paid & credit balance
        await prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: 'PAID', paidAt: new Date() },
        });

        // Credit the base amount, not the finalAmount (which includes the unique code)
        const amountToCredit = invoice.baseAmount > 0 ? invoice.baseAmount : invoice.amount;

        await userService.addBalance(
            invoice.userId,
            amountToCredit,
            'DEPOSIT',
            `Deposit via QRIS`,
            invoice.id
        );

        logger.info({ invoiceId: invoice.id, userId: invoice.userId, credited: amountToCredit, paid: invoice.amount }, 'Deposit confirmed');
        return { success: true, message: 'Payment confirmed' };
    },

    /** Get invoices for a user */
    async getInvoices(userId: string, limit = 10) {
        return prisma.invoice.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    },

    /** Get all invoices (admin) */
    async getAllInvoices(limit = 50) {
        return prisma.invoice.findMany({
            include: { user: { select: { telegramId: true, username: true } } },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    },
};
