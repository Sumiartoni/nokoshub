import { prisma } from '../../database/prisma.client';
import { getOtpProvider, resolveProviderRuntimeFromPriceId } from '../providers/provider-runtime';
import { serviceService } from '../services/service.service';
import { otpQueue } from '../../queue/queue';
import logger from '../../utils/logger';
import { formatRupiah } from '../../utils/helpers';
import type { OtpProviderKey } from '../providers/provider-registry';
import { runOtpPollingJob, type OtpJobData } from '../../workers/otp-poll-runner';

export type OrderStatus = 'PENDING' | 'ACTIVE' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

const ORDER_CANCEL_DELAY_MS = 2 * 60 * 1000;

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
     * Create a new order through the provider encoded in the selected price.
     */
    async createOrder(userId: string, priceId: string) {
        const price = await serviceService.getPriceById(priceId);
        if (!price) throw new Error('Price not found');
        if (!price.isActive) throw new Error('This price is no longer available');

        const providerRuntime = resolveProviderRuntimeFromPriceId(price.priceId);
        if (!providerRuntime) {
            throw new Error('Invalid provider price configuration. Please sync provider data again.');
        }

        const reservedOrder = await reserveOrderBalance(
            userId,
            price.id,
            price.sellPrice,
            `Order ${price.service.name} ${price.country.name}`,
            async (currentBalance) => {
                throw new Error(
                    `Insufficient balance. Need ${formatRupiah(price.sellPrice)}, have ${formatRupiah(currentBalance)}`
                );
            }
        );

        let providerOrderId: string | null = null;

        try {
            const result = await providerRuntime.provider.orderNumber({
                serviceCode: providerRuntime.parsedPrice.serviceCode,
                countryCode: providerRuntime.parsedPrice.countryCode,
                providerId: providerRuntime.parsedPrice.providerId,
                maxPrice: price.providerPrice,
                providerPriceUsd: toOptionalNumber(price.providerPriceUsd),
            });
            if (!result.success || !result.phone_number || !result.order_id) {
                await failReservedOrder(reservedOrder.id, {
                    providerKey: providerRuntime.providerKey,
                    failReason: result.message || `Harga/provider ${providerRuntime.providerLabel} berubah. Sync provider lalu coba lagi.`,
                    refundDescription: 'Refund order failed before activation',
                });
                throw new Error(result.message || `Harga/provider ${providerRuntime.providerLabel} berubah. Sync provider lalu coba lagi.`);
            }

            providerOrderId = result.order_id;

            const activatedOrder = await activateReservedOrder(
                reservedOrder.id,
                result.order_id,
                result.phone_number
            );
            if (!activatedOrder) {
                await failReservedOrder(reservedOrder.id, {
                    providerKey: providerRuntime.providerKey,
                    cancelProvider: true,
                    providerOrderId,
                    failReason: 'Failed to activate local order state after provider success',
                    refundDescription: 'Refund order activation failure',
                });
                throw new Error('Failed to activate local order state after provider success');
            }

            await providerRuntime.provider.markActivationReady(result.order_id);

            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (user) {
                const pollingJob: OtpJobData = {
                    providerKey: providerRuntime.providerKey,
                    orderId: activatedOrder.id,
                    providerOrderId: result.order_id,
                    telegramId: user.telegramId,
                };

                try {
                    await otpQueue.add(
                        'poll-otp',
                        pollingJob,
                        {
                            attempts: 1,
                            removeOnComplete: true,
                            removeOnFail: false,
                        }
                    );
                } catch (queueErr) {
                    logger.warn(
                        { err: queueErr, orderId: activatedOrder.id, providerOrderId: result.order_id },
                        'Failed to enqueue OTP polling job, using local fallback runner'
                    );
                    void runOtpPollingJob(pollingJob).catch((fallbackErr) => {
                        logger.error(
                            { err: fallbackErr, orderId: activatedOrder.id, providerOrderId: result.order_id },
                            'Local OTP fallback runner failed'
                        );
                    });
                }
            }

            logger.info(
                { orderId: activatedOrder.id, phoneNumber: result.phone_number, providerOrderId: result.order_id },
                'Order created'
            );

            return activatedOrder;
        } catch (err) {
            if (providerOrderId) {
                await failReservedOrder(reservedOrder.id, {
                    providerKey: providerRuntime.providerKey,
                    cancelProvider: true,
                    providerOrderId,
                    failReason: (err as Error).message || 'Order creation failed after provider success',
                    refundDescription: 'Refund order processing failure',
                }).catch((refundErr) => {
                    logger.error(
                        { err: refundErr, orderId: reservedOrder.id, providerOrderId },
                        'Failed to compensate reserved order after provider success'
                    );
                });
            }
            throw err;
        }
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
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                userId: true,
                status: true,
                otpCode: true,
                createdAt: true,
            },
        });

        if (!order) throw new Error('Order not found');
        if (order.userId !== userId) throw new Error('Unauthorized');
        if (order.status !== 'ACTIVE') {
            throw new Error(`Only ACTIVE orders can be cancelled. Current status: ${order.status}`);
        }
        if (order.otpCode) {
            throw new Error('Order tidak bisa dibatalkan karena OTP sudah diterima');
        }

        const now = Date.now();
        const cancelAllowedAt = order.createdAt.getTime() + ORDER_CANCEL_DELAY_MS;
        if (now < cancelAllowedAt) {
            const remainingSeconds = Math.ceil((cancelAllowedAt - now) / 1000);
            throw new Error(`Order baru bisa dibatalkan setelah 2 menit. Tunggu ${remainingSeconds} detik lagi.`);
        }

        const result = await orderService.cancelAndRefundActiveOrder(orderId, {
            userId,
            cancelProvider: true,
            failReason: 'Cancelled by user',
            refundDescription: 'Refund order cancelled',
        });

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
                price: { select: { priceId: true } },
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
            const providerRuntime = resolveProviderRuntimeFromPriceId(order.price.priceId);
            if (providerRuntime) {
                await providerRuntime.provider.cancelActivation(order.providerOrderId);
            }
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

function toOptionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (typeof value === 'object' && value && typeof (value as { toString?: () => string }).toString === 'function') {
        const parsed = Number((value as { toString: () => string }).toString());
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

async function reserveOrderBalance(
    userId: string,
    priceId: string,
    amount: number,
    description: string,
    onInsufficientBalance: (currentBalance: number) => Promise<never>
) {
    return prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
            data: {
                userId,
                priceId,
                status: 'PENDING',
            },
            include: {
                price: {
                    include: { service: true, country: true },
                },
            },
        });

        const updateResult = await tx.user.updateMany({
            where: {
                id: userId,
                balance: { gte: amount },
            },
            data: {
                balance: { decrement: amount },
            },
        });

        if (updateResult.count === 0) {
            const currentUser = await tx.user.findUnique({
                where: { id: userId },
                select: { balance: true },
            });
            await tx.order.delete({ where: { id: order.id } }).catch(() => null);
            return onInsufficientBalance(currentUser?.balance ?? 0);
        }

        await tx.transaction.create({
            data: {
                userId,
                type: 'DEDUCT',
                amount: -amount,
                description,
                reference: order.id,
            },
        });

        return order;
    });
}

async function activateReservedOrder(orderId: string, providerOrderId: string, phoneNumber: string) {
    const updateResult = await prisma.order.updateMany({
        where: {
            id: orderId,
            status: 'PENDING',
        },
        data: {
            providerOrderId,
            phoneNumber,
            status: 'ACTIVE',
            failReason: null,
        },
    });

    if (updateResult.count === 0) {
        return null;
    }

    return prisma.order.findUnique({
        where: { id: orderId },
        include: {
            price: {
                include: { service: true, country: true },
            },
        },
    });
}

async function failReservedOrder(
    orderId: string,
    options: {
        providerKey: OtpProviderKey;
        cancelProvider?: boolean;
        providerOrderId?: string | null;
        failReason: string;
        refundDescription: string;
    }
) {
    if (options.cancelProvider && options.providerOrderId) {
        await cancelProviderActivation(options.providerKey, options.providerOrderId);
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { price: true },
    });

    if (!order) {
        throw new Error('Order not found');
    }

    if (!['PENDING', 'ACTIVE'].includes(order.status)) {
        return {
            status: order.status,
            refunded: false,
            refundAmount: 0,
        };
    }

    return prisma.$transaction(async (tx) => {
        const updateResult = await tx.order.updateMany({
            where: {
                id: orderId,
                status: { in: ['PENDING', 'ACTIVE'] },
            },
            data: {
                status: 'FAILED',
                failReason: options.failReason,
            },
        });

        if (updateResult.count === 0) {
            const currentOrder = await tx.order.findUnique({
                where: { id: orderId },
                select: { status: true },
            });
            return {
                status: currentOrder?.status ?? 'UNKNOWN',
                refunded: false,
                refundAmount: 0,
            };
        }

        const existingRefund = await tx.transaction.findFirst({
            where: {
                userId: order.userId,
                type: 'REFUND',
                reference: orderId,
            },
            select: { id: true },
        });

        if (!existingRefund) {
            await tx.user.update({
                where: { id: order.userId },
                data: { balance: { increment: order.price.sellPrice } },
            });

            await tx.transaction.create({
                data: {
                    userId: order.userId,
                    type: 'REFUND',
                    amount: order.price.sellPrice,
                    description: options.refundDescription,
                    reference: orderId,
                },
            });
        }

        logger.warn(
            {
                orderId,
                providerOrderId: options.providerOrderId,
                refunded: !existingRefund,
                failReason: options.failReason,
            },
            'Reserved order failed and refund processed'
        );

        return {
            status: 'FAILED',
            refunded: !existingRefund,
            refundAmount: existingRefund ? 0 : order.price.sellPrice,
        };
    });
}

async function cancelProviderActivation(providerKey: OtpProviderKey, providerOrderId: string) {
    const provider = getOtpProvider(providerKey);
    await provider.cancelActivation(providerOrderId);
}
