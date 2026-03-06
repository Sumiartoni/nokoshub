import { prisma } from '../../database/prisma.client';
import { rumahOTPProvider } from '../providers/rumahotp.provider';
import { userService } from '../users/user.service';
import { serviceService } from '../services/service.service';
import { otpQueue } from '../../queue/queue';
import logger from '../../utils/logger';
import { formatRupiah } from '../../utils/helpers';

export type OrderStatus = 'PENDING' | 'ACTIVE' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export const orderService = {
    /**
     * Create a new order:
     * 1. Validate user balance
     * 2. Call provider API
     * 3. Deduct balance
     * 4. Save order to DB
     * 5. Enqueue OTP polling job
     */
    async createOrder(userId: string, priceId: string) {
        const price = await serviceService.getPriceById(priceId);
        if (!price) throw new Error('Price not found');
        if (!price.isActive) throw new Error('This price is no longer available');

        const balance = await userService.getBalance(userId);
        if (balance < price.sellPrice) {
            throw new Error(
                `Insufficient balance. Need ${formatRupiah(price.sellPrice)}, have ${formatRupiah(balance)}`
            );
        }

        // Call provider to get a number
        const result = await rumahOTPProvider.orderNumber(price.priceId);
        if (!result.success || !result.number || !result.providerOrderId) {
            throw new Error(result.message || 'Failed to get number from provider');
        }

        // Deduct user balance
        await userService.deductBalance(
            userId,
            price.sellPrice,
            `Order ${price.service.name} ${price.country.name}`,
            undefined
        );

        // Create order record
        const order = await prisma.order.create({
            data: {
                userId,
                priceId,
                providerOrderId: result.providerOrderId,
                phoneNumber: result.number,
                status: 'ACTIVE',
            },
            include: {
                price: {
                    include: { service: true, country: true },
                },
            },
        });

        // Update the deduct transaction reference
        await prisma.transaction.updateMany({
            where: { userId, type: 'DEDUCT', reference: null },
            data: { reference: order.id },
        });

        logger.info({ orderId: order.id, phoneNumber: result.number }, 'Order created');

        // Enqueue OTP polling job
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) {
            await otpQueue.add(
                'poll-otp',
                {
                    orderId: order.id,
                    providerOrderId: result.providerOrderId,
                    telegramId: user.telegramId,
                },
                {
                    attempts: 1,
                    removeOnComplete: true,
                    removeOnFail: false,
                }
            );
        }

        return order;
    },

    /** Get orders for a user */
    async getOrders(userId: string, limit = 10) {
        return prisma.order.findMany({
            where: { userId },
            include: {
                price: {
                    include: { service: true, country: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    },

    /** Get single order by id */
    async getOrderById(orderId: string) {
        return prisma.order.findUnique({
            where: { id: orderId },
            include: {
                price: {
                    include: { service: true, country: true },
                },
                user: true,
            },
        });
    },

    /** Cancel an ACTIVE order and refund user */
    async cancelOrder(orderId: string, userId: string) {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) throw new Error('Order not found');
        if (order.userId !== userId) throw new Error('Unauthorized');
        if (order.status !== 'ACTIVE') throw new Error('Only ACTIVE orders can be cancelled');

        // Cancel with provider
        if (order.providerOrderId) {
            await rumahOTPProvider.cancelOrder(order.providerOrderId);
        }

        // Update order status
        await prisma.order.update({
            where: { id: orderId },
            data: { status: 'CANCELLED' },
        });

        // Get price for refund
        const price = await serviceService.getPriceById(order.priceId);
        if (price) {
            await userService.addBalance(
                userId,
                price.sellPrice,
                'REFUND',
                `Refund order cancelled`,
                orderId
            );
        }

        logger.info({ orderId }, 'Order cancelled and refunded');
        return { cancelled: true };
    },

    /** Get all orders (admin) */
    async getAllOrders(limit = 50, status?: string) {
        return prisma.order.findMany({
            where: status ? { status } : {},
            include: {
                user: { select: { telegramId: true, username: true } },
                price: { include: { service: true, country: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    },
};
