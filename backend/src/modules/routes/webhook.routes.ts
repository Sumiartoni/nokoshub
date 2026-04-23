import { FastifyPluginAsync } from 'fastify';
import { paymentService } from '../../modules/payments/payment.service';
import { config } from '../../app/config';
import logger from '../../utils/logger';

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /api/payment/webhook
    fastify.post('/webhook', {
        config: { rawBody: true }, // capture raw body for HMAC
    }, async (req, reply) => {
        try {
            const body = req.body as {
                invoiceId?: string;
                amount?: number;
                signature?: string;
                [key: string]: unknown;
            };
            const query = req.query as { token?: string };

            // raw body for signature verification
            const rawBody = JSON.stringify(req.body);

            const result = await paymentService.handleWebhook(body, rawBody, {
                headers: req.headers as Record<string, any>,
                webhookToken: query.token,
            });

            if (!result.success) {
                return reply.status(400).send({ success: false, message: result.message });
            }

            return { success: true, message: result.message };
        } catch (err) {
            logger.error({ err }, 'Webhook handler error');
            return reply.status(500).send({ success: false, error: 'Internal server error' });
        }
    });
};

// ─── Internal Notify Endpoint ─────────────────────────────────────────────────
// Used by otp.worker.ts to send OTP codes back to the Telegram bot process

let _notifyHandler: ((data: any) => void) | null = null;

export function setNotifyHandler(fn: (data: any) => void) {
    _notifyHandler = fn;
}

export const internalRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /api/internal/notify
    fastify.post('/notify', async (req, reply) => {
        const secret = req.headers['x-internal-secret'];
        if (secret !== config.INTERNAL_API_SECRET) {
            return reply.status(404).send({ success: false, error: 'Not found' });
        }

        const data = req.body as {
            telegramId: string;
            type: 'OTP_RECEIVED' | 'OTP_TIMEOUT';
            orderId: string;
            otpCode?: string;
        };

        if (_notifyHandler) {
            _notifyHandler(data);
        }

        return { success: true };
    });
};
