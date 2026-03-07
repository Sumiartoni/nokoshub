import { Worker, Job } from 'bullmq';
import { prisma } from '../database/prisma.client';
import { rumahOTPProvider } from '../modules/providers/rumahotp.provider';
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
            // Check if order was already cancelled
            const order = await prisma.order.findUnique({ where: { id: orderId } });
            if (!order || order.status === 'CANCELLED') {
                logger.info({ orderId }, 'Order cancelled, stopping poll');
                return;
            }

            const statusResult = await rumahOTPProvider.checkStatus(providerOrderId);

            if (statusResult.success && statusResult.sms_code) {
                // OTP found! Update order
                await prisma.order.update({
                    where: { id: orderId },
                    data: {
                        otpCode: statusResult.sms_code,
                        status: 'SUCCESS',
                    },
                });

                logger.info({ orderId, otpCode: statusResult.sms_code }, 'OTP received');

                // Notify user via backend API
                await notifyOtpReceived(telegramId, orderId, statusResult.sms_code);
                return;
            }

            // If status is cancelled/expired by provider
            if (statusResult.status === 'cancelled' || statusResult.status === 'expiring') {
                await prisma.order.update({
                    where: { id: orderId },
                    data: { status: 'FAILED', failReason: `Provider status: ${statusResult.status}` },
                });
                logger.warn({ orderId, status: statusResult.status }, 'Order expired/cancelled by provider');
                await notifyOtpTimeout(telegramId, orderId);
                return;
            }

            await sleep(interval);
        }

        // Timeout — mark as FAILED
        await prisma.order.update({
            where: { id: orderId },
            data: { status: 'FAILED', failReason: 'OTP not received within 120 seconds' },
        });

        logger.warn({ orderId }, 'OTP polling timed out');
        await notifyOtpTimeout(telegramId, orderId);
    },
    {
        connection: workerConnection,
        concurrency: 20,
    }
);

async function notifyOtpReceived(telegramId: string, orderId: string, otpCode: string) {
    try {
        await axios.post(`${config.API_BASE_URL}/api/internal/notify`, {
            telegramId,
            type: 'OTP_RECEIVED',
            orderId,
            otpCode,
        });
    } catch (err) {
        logger.error({ err, telegramId, orderId }, 'Failed to notify OTP received');
    }
}

async function notifyOtpTimeout(telegramId: string, orderId: string) {
    try {
        await axios.post(`${config.API_BASE_URL}/api/internal/notify`, {
            telegramId,
            type: 'OTP_TIMEOUT',
            orderId,
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
