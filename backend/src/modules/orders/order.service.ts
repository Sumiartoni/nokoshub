import { prisma } from '../../database/prisma.client';
import { heroSMSProvider, parseHeroSMSPriceId } from '../providers/herosms.provider';
import { userService } from '../users/user.service';
import { serviceService } from '../services/service.service';
import { otpQueue } from '../../queue/queue';
import logger from '../../utils/logger';
import { formatRupiah } from '../../utils/helpers';

export type OrderStatus = 'PENDING' | 'ACTIVE' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

interface CancelAndRefundOptions {
    userId?: string;
    cancelProvider: boolean;
    failReason: string;
    refundDescription: string;
}

interface CancelAndRefundResult {
    cancelled: boolean;
    refunded: boolean;
    status: string;
    refundAmount: number;
}

export const orderService = {
    /**
     * Create a new order through HeroSMS:
     * 1. Parse provider metadata from priceId
     * 2. Call provider to order the number
     * 3. Deduct balance & save to DB
     * 4. Enqueue OTP polling
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

        const providerPrice = parseHeroSMSPriceId(price.priceId);
        if (!providerPrice) {
            throw new Error('Invalid HeroSMS price configuration. Please sync provider data again.');
        }

        // Call provider to order the number
        const result = await heroSMSProvider.orderNumber({
            serviceCode: providerPrice.serviceCode,
            countryCode: providerPrice.countryCode,
            providerId: providerPrice.providerId,
            maxPrice: price.providerPrice,
        });
        if (!result.success || !result.phone_number || !result.order_id) {
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
                providerOrderId: result.order_id,
                phoneNumber: result.phone_number,
                status: 'ACTIVE',
            },
            include: {
                price: {
                    include: { service: true, country: true },
                },
            },
        });

        // Update transaction reference
        await prisma.transaction.updateMany({
            where: { userId, type: 'DEDUCT', reference: null },
            data: { reference: order.id },
        });

        logger.info({ orderId: order.id, phoneNumber: result.phone_number }, 'Order created');

        // Enqueue OTP polling job
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) {
            await otpQueue.add(
                'poll-otp',
                {
                    orderId: order.id,
                    providerOrderId: result.order_id,
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
        const result = await orderService.cancelAndRefundActiveOrder(orderId, {
            userId,
            cancelProvider: true,
            failReason: 'Cancelled by user',
            refundDescription: 'Refund order cancelled',
        });

        if (!result.cancelled) {
            throw new Error(`Only ACTIVE orders can be cancelled. Current status: ${result.status}`);
        }

        return result;
    },

    /**
     * Cancel an active order and refund exactly once.
     * The conditional ACTIVE -> CANCELLED update is the idempotency guard,
     * so manual cancel and timeout worker cannot double-credit the user.
     */
    async cancelAndRefundActiveOrder(
        orderId: string,
        options: CancelAndRefundOptions
    ): Promise<CancelAndRefundResult> {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                userId: true,
                status: true,
                providerOrderId: true,
            },
        });

        if (!order) throw new Error('Order not found');
        if (options.userId && order.userId !== options.userId) throw new Error('Unauthorized');

        if (order.status !== 'ACTIVE') {
            return {
                cancelled: false,
                refunded: false,
                status: order.status,
                refundAmount: 0,
            };
        }

        if (options.cancelProvider && order.providerOrderId) {
            await heroSMSProvider.cancelActivation(order.providerOrderId);
        }

        const result = await prisma.$transaction(async (tx) => {
            const updateResult = await tx.order.updateMany({
                where: {
                    id: orderId,
                    status: 'ACTIVE',
                    ...(options.userId ? { userId: options.userId } : {}),
                },
                data: {
                    status: 'CANCELLED',
                    failReason: options.failReason,
                },
            });

            if (updateResult.count === 0) {
                const currentOrder = await tx.order.findUnique({
                    where: { id: orderId },
                    select: { status: true },
                });

                return {
                    cancelled: false,
                    refunded: false,
                    status: currentOrder?.status ?? 'UNKNOWN',
                    refundAmount: 0,
                };
            }

            const cancelledOrder = await tx.order.findUnique({
                where: { id: orderId },
                include: { price: true },
            });

            if (!cancelledOrder) {
                throw new Error('Order not found after cancellation');
            }

            const existingRefund = await tx.transaction.findFirst({
                where: {
                    userId: cancelledOrder.userId,
                    type: 'REFUND',
                    reference: orderId,
                },
                select: { id: true },
            });

            if (existingRefund) {
                return {
                    cancelled: true,
                    refunded: false,
                    status: 'CANCELLED',
                    refundAmount: 0,
                };
            }

            await tx.user.update({
                where: { id: cancelledOrder.userId },
                data: { balance: { increment: cancelledOrder.price.sellPrice } },
            });

            await tx.transaction.create({
                data: {
                    userId: cancelledOrder.userId,
                    type: 'REFUND',
                    amount: cancelledOrder.price.sellPrice,
                    description: options.refundDescription,
                    reference: orderId,
                },
            });

            return {
                cancelled: true,
                refunded: true,
                status: 'CANCELLED',
                refundAmount: cancelledOrder.price.sellPrice,
            };
        });

        logger.info(
            {
                orderId,
                refunded: result.refunded,
                refundAmount: result.refundAmount,
                reason: options.failReason,
            },
            'Order cancelled and refund processed'
        );

        return result;
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
