import { Worker, Job } from 'bullmq';
import { prisma } from '../database/prisma.client';
import { heroSMSProvider } from '../modules/providers/herosms.provider';
import { orderService } from '../modules/orders/order.service';
import { config } from '../app/config';
import logger from '../utils/logger';
import { sleep } from '../utils/helpers';
import axios from 'axios';

interface OtpJobData {
    orderId: string;
    providerOrderId: string;
    telegramId: string;
}

// BullMQ bundles its own ioredis — pass URL string to avoid type conflicts
const workerConnection = { url: config.REDIS_URL, maxRetriesPerRequest: null as any };

const worker = new Worker<OtpJobData>(
    'otp-polling',
    async (job: Job<OtpJobData>) => {
        const { orderId, providerOrderId, telegramId } = job.data;
        const startTime = Date.now();
        const maxDuration = config.OTP_POLL_MAX_MS; // 120s
        const interval = config.OTP_POLL_INTERVAL_MS; // 5s

        logger.info({ orderId, providerOrderId }, 'OTP polling started');

        while (Date.now() - startTime < maxDuration) {
            // Stop if another process has already finalized this order.
            const order = await prisma.order.findUnique({ where: { id: orderId } });
            if (!order || order.status !== 'ACTIVE') {
                logger.info({ orderId, status: order?.status }, 'Order no longer active, stopping poll');
                return;
            }

            const statusResult = await heroSMSProvider.checkStatus(providerOrderId);

            if (statusResult.success && statusResult.sms_code) {
                const updateResult = await prisma.order.updateMany({
                    where: { id: orderId, status: 'ACTIVE' },
                    data: {
                        otpCode: statusResult.sms_code,
                        status: 'SUCCESS',
                    },
                });

                if (updateResult.count === 0) {
                    logger.info({ orderId }, 'OTP received after order was finalized, skipping success update');
                    return;
                }

                logger.info({ orderId, otpCode: statusResult.sms_code }, 'OTP received');

                // Notify user via backend API
                await notifyOtpReceived(telegramId, orderId, statusResult.sms_code);
                await heroSMSProvider.finishActivation(providerOrderId);
                return;
            }

            // If status is cancelled/expired by provider
            if (statusResult.status === 'cancelled' || statusResult.status === 'expiring') {
                const result = await orderService.cancelAndRefundActiveOrder(orderId, {
                    cancelProvider: statusResult.status !== 'cancelled',
                    failReason: `Provider status: ${statusResult.status}`,
                    refundDescription: `Refund order provider ${statusResult.status}`,
                });

                logger.warn(
                    { orderId, status: statusResult.status, refunded: result.refunded },
                    'Order expired/cancelled by provider'
                );
                await notifyOtpTimeout(telegramId, orderId);
                return;
            }

            await sleep(interval);
        }

        const result = await orderService.cancelAndRefundActiveOrder(orderId, {
            cancelProvider: true,
            failReason: 'OTP not received within 120 seconds',
            refundDescription: 'Refund OTP timeout',
        });

        logger.warn({ orderId, refunded: result.refunded }, 'OTP polling timed out');
        await notifyOtpTimeout(telegramId, orderId);
    },
    {
        connection: workerConnection,
        concurrency: 20,
    }
);

async function notifyOtpReceived(telegramId: string, orderId: string, otpCode: string) {
    if (!/^\d+$/.test(String(telegramId || '').trim())) {
        return;
    }
    try {
        await axios.post(`${config.API_BASE_URL}/api/internal/notify`, {
            telegramId,
            type: 'OTP_RECEIVED',
            orderId,
            otpCode,
        }, {
            headers: { 'x-internal-secret': config.INTERNAL_API_SECRET },
        });
    } catch (err) {
        logger.error({ err, telegramId, orderId }, 'Failed to notify OTP received');
    }
}

async function notifyOtpTimeout(telegramId: string, orderId: string) {
    if (!/^\d+$/.test(String(telegramId || '').trim())) {
        return;
    }
    try {
        await axios.post(`${config.API_BASE_URL}/api/internal/notify`, {
            telegramId,
            type: 'OTP_TIMEOUT',
            orderId,
        }, {
            headers: { 'x-internal-secret': config.INTERNAL_API_SECRET },
        });
    } catch (err) {
        logger.error({ err, telegramId, orderId }, 'Failed to notify OTP timeout');
    }
}

worker.on('completed', (job: Job) => {
    logger.info({ jobId: job.id }, 'OTP job completed');
});

worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err }, 'OTP job failed');
});

export default worker;
