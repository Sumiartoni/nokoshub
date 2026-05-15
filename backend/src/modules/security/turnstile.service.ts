import { randomUUID } from 'crypto';
import { config } from '../../app/config';

const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileVerifyResponse {
    success?: boolean;
    hostname?: string;
    action?: string;
    'error-codes'?: string[];
}

export const turnstileService = {
    isEnabled() {
        return Boolean(config.TURNSTILE_SITE_KEY && config.TURNSTILE_SECRET_KEY);
    },

    getClientConfig() {
        return {
            enabled: this.isEnabled(),
            siteKey: this.isEnabled() ? config.TURNSTILE_SITE_KEY : null,
        };
    },

    async assertToken(
        token?: string | null,
        remoteIp?: string | null,
        options?: {
            expectedHostname?: string | null;
            expectedAction?: string | null;
        }
    ) {
        if (!this.isEnabled()) return;

        if (!token) {
            throw new Error('Verifikasi keamanan wajib diselesaikan terlebih dahulu');
        }

        const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                secret: config.TURNSTILE_SECRET_KEY,
                response: token,
                remoteip: remoteIp || '',
                idempotency_key: randomUUID(),
            }),
        });

        if (!response.ok) {
            throw new Error('Layanan verifikasi keamanan sedang bermasalah. Silakan coba lagi.');
        }

        const payload = await response.json() as TurnstileVerifyResponse;
        if (!payload.success) {
            const code = payload['error-codes']?.[0] || 'invalid-input-response';
            if (code === 'timeout-or-duplicate') {
                throw new Error('Captcha sudah kedaluwarsa. Silakan verifikasi ulang.');
            }
            throw new Error('Verifikasi keamanan gagal. Silakan coba lagi.');
        }

        const expectedHostname = String(options?.expectedHostname || '').trim().toLowerCase();
        if (expectedHostname && String(payload.hostname || '').trim().toLowerCase() !== expectedHostname) {
            throw new Error('Hostname verifikasi keamanan tidak cocok.');
        }

        const expectedAction = String(options?.expectedAction || '').trim();
        if (expectedAction && String(payload.action || '').trim() !== expectedAction) {
            throw new Error('Action verifikasi keamanan tidak cocok.');
        }
    },
};
