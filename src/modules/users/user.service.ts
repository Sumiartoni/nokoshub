import { prisma } from '../../database/prisma.client';
import logger from '../../utils/logger';

export const userService = {
    /** Find user by telegramId, create if not exists */
    async findOrCreate(
        telegramId: string,
        opts?: { username?: string; firstName?: string; lastName?: string }
    ) {
        return prisma.user.upsert({
            where: { telegramId },
            update: {
                username: opts?.username,
                firstName: opts?.firstName,
                lastName: opts?.lastName,
            },
            create: {
                telegramId,
                username: opts?.username,
                firstName: opts?.firstName,
                lastName: opts?.lastName,
                balance: 0,
            },
        });
    },

    /** Get user by internal id */
    async getById(id: string) {
        return prisma.user.findUnique({ where: { id } });
    },

    /** Get user by telegramId */
    async getByTelegramId(telegramId: string) {
        return prisma.user.findUnique({ where: { telegramId } });
    },

    /** Get user balance (in IDR) */
    async getBalance(userId: string): Promise<number> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { balance: true },
        });
        return user?.balance ?? 0;
    },

    /** Deduct balance from user. Throws if insufficient. */
    async deductBalance(
        userId: string,
        amount: number,
        description: string,
        reference?: string
    ): Promise<void> {
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) throw new Error('User not found');
        if (user.balance < amount)
            throw new Error(`Insufficient balance. Available: ${user.balance}, required: ${amount}`);

        await prisma.$transaction([
            prisma.user.update({
                where: { id: userId },
                data: { balance: { decrement: amount } },
            }),
            prisma.transaction.create({
                data: {
                    userId,
                    type: 'DEDUCT',
                    amount: -amount,
                    description,
                    reference,
                },
            }),
        ]);

        logger.info({ userId, amount, description }, 'Balance deducted');
    },

    /** Add balance to user (deposit or refund) */
    async addBalance(
        userId: string,
        amount: number,
        type: 'DEPOSIT' | 'REFUND',
        description: string,
        reference?: string
    ): Promise<void> {
        await prisma.$transaction([
            prisma.user.update({
                where: { id: userId },
                data: { balance: { increment: amount } },
            }),
            prisma.transaction.create({
                data: {
                    userId,
                    type,
                    amount,
                    description,
                    reference,
                },
            }),
        ]);

        logger.info({ userId, amount, type, description }, 'Balance added');
    },

    /** Get transaction history for a user */
    async getTransactions(userId: string, limit = 10) {
        return prisma.transaction.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    },
};
