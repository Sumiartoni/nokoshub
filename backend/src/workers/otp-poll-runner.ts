import axios from 'axios';
import { prisma } from '../database/prisma.client';
import { getOtpProvider } from '../modules/providers/provider-runtime';
import { config } from '../app/config';
import logger from '../utils/logger';
import { sleep } from '../utils/helpers';
import type { OtpProviderKey } from '../modules/providers/provider-registry';

export interface OtpJobData {
    providerKey: OtpProviderKey;
    orderId: string;
    providerOrderId: string;
    telegramId: string;
}

export async function runOtpPollingJob(job: OtpJobData) {
    const { providerKey, orderId, providerOrderId, telegramId } = job;
    const provider = getOtpProvider(providerKey);
    const startTime = Date.now();
    const maxDuration = config.OTP_POLL_MAX_MS;
    const interval = config.OTP_POLL_INTERVAL_MS;

    logger.info({ orderId, providerKey, providerOrderId }, 'OTP polling started');

    while (Date.now() - startTime < maxDuration) {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order || order.status !== 'ACTIVE') {
            logger.info({ orderId, status: order?.status }, 'Order no longer active, stopping poll');
            return;
        }

        const statusResult = await provider.checkStatus(providerOrderId);

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
            await notifyOtpReceived(telegramId, orderId, statusResult.sms_code);
            await provider.finishActivation(providerOrderId);
            return;
        }

        if (statusResult.status === 'cancelled' || statusResult.status === 'expired') {
            const { orderService } = await import('../modules/orders/order.service');
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

        if (statusResult.status === 'expiring') {
            logger.info({ orderId, providerOrderId, status: statusResult.status }, 'Provider reported expiring; continue polling');
        }

        await sleep(interval);
    }

    const { orderService } = await import('../modules/orders/order.service');
    const result = await orderService.cancelAndRefundActiveOrder(orderId, {
        cancelProvider: true,
        failReason: 'OTP not received within 20 minutes',
        refundDescription: 'Refund OTP timeout',
    });

    logger.warn({ orderId, refunded: result.refunded }, 'OTP polling timed out');
    await notifyOtpTimeout(telegramId, orderId);
}

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
