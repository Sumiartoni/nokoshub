import crypto from 'crypto';
import axios from 'axios';
import { config } from '../../app/config';

const bayarGgClient = axios.create({
    baseURL: 'https://bayar.gg/api',
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json',
    },
});

export interface BayarGgPayment {
    invoiceId: string;
    amount: number;
    uniqueCode: number;
    finalAmount: number;
    paymentMethod: string;
    status: string;
    expiresAt: string;
    paymentUrl: string;
    qrisPayload: string;
    qrisImageUrl: string;
    raw: unknown;
}

export interface BayarGgPaymentDetail {
    invoiceId: string;
    status: string;
    amount: number;
    finalAmount: number;
    paymentMethod: string;
    paidAt: string | null;
    paidReferenceNumber: string | null;
    expiresAt: string | null;
    raw: unknown;
}

export interface BayarGgWebhookPayload {
    event?: string;
    invoice_id?: string;
    status?: string;
    amount?: number;
    final_amount?: number;
    unique_code?: number;
    paid_at?: string;
    paid_amount?: number;
    paid_reff_num?: string;
    customer_name?: string;
    customer_email?: string;
    customer_phone?: string;
    description?: string;
    redirect_url?: string;
    has_file?: boolean;
    has_content?: boolean;
    timestamp?: number | string;
    signature?: string;
    [key: string]: unknown;
}

export const bayarGgService = {
    isConfigured() {
        return Boolean(config.BAYAR_GG_API_KEY);
    },

    assertConfigured() {
        if (!this.isConfigured()) {
            throw new Error('BAYAR GG belum dikonfigurasi di environment VPS');
        }
    },

    getConfigStatus() {
        return {
            configured: this.isConfigured(),
            paymentMethod: normalizeMethod(config.BAYAR_GG_PAYMENT_METHOD),
            redirectUrl: config.BAYAR_GG_REDIRECT_URL || '',
            publicApiBaseUrl: config.PUBLIC_API_BASE_URL || '',
            webhookSecretEnabled: Boolean(config.BAYAR_GG_WEBHOOK_SECRET),
            webhookUrl: this.buildWebhookUrl(),
        };
    },

    buildWebhookUrl() {
        const publicBase = String(config.PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '');
        if (!publicBase) return '';

        const apiBase = publicBase.endsWith('/api') ? publicBase : `${publicBase}/api`;
        return `${apiBase}/payment/webhook`;
    },

    async createPayment(input: {
        amount: number;
        description: string;
        customerName?: string;
        customerEmail?: string;
        customerPhone?: string;
    }): Promise<BayarGgPayment> {
        this.assertConfigured();

        const useQrisConverter = config.QRIS_DYNAMIC_ENABLED;
        const body: Record<string, unknown> = {
            amount: input.amount,
            description: input.description,
            payment_method: normalizeMethod(config.BAYAR_GG_PAYMENT_METHOD),
        };

        if (useQrisConverter) {
            body.use_qris_converter = true;
            if (config.QRIS_STATIC_STRING) {
                body.qris_string = config.QRIS_STATIC_STRING;
            }
        }

        const callbackUrl = this.buildWebhookUrl();
        if (callbackUrl) body.callback_url = callbackUrl;
        if (config.BAYAR_GG_REDIRECT_URL) body.redirect_url = config.BAYAR_GG_REDIRECT_URL;
        if (input.customerName) body.customer_name = input.customerName;
        if (input.customerEmail) body.customer_email = input.customerEmail;
        if (input.customerPhone) body.customer_phone = input.customerPhone;

        const response = await bayarGgClient.post('/create-payment.php', body, {
            headers: {
                'X-API-Key': config.BAYAR_GG_API_KEY,
            },
        });

        return normalizeCreatePaymentResponse(response.data);
    },

    async checkPayment(invoiceId: string): Promise<BayarGgPaymentDetail> {
        this.assertConfigured();

        const response = await bayarGgClient.get('/check-payment.php', {
            headers: {
                'X-API-Key': config.BAYAR_GG_API_KEY,
            },
            params: {
                invoice: invoiceId,
            },
        });

        return normalizeCheckPaymentResponse(response.data);
    },

    verifyWebhookSignature(payload: BayarGgWebhookPayload, headers: Record<string, any>) {
        if (!config.BAYAR_GG_WEBHOOK_SECRET) {
            return false;
        }

        const signature = String(headers['x-webhook-signature'] || payload.signature || '').trim();
        const timestamp = String(headers['x-webhook-timestamp'] || payload.timestamp || '').trim();
        const invoiceId = String(payload.invoice_id || '').trim();
        const status = String(payload.status || '').trim().toLowerCase();
        const finalAmount = Number(payload.final_amount || 0);

        if (!signature || !timestamp || !invoiceId || !status || !Number.isFinite(finalAmount) || finalAmount <= 0) {
            return false;
        }

        const signatureData = `${invoiceId}|${status}|${Math.trunc(finalAmount)}|${timestamp}`;
        const expectedSignature = crypto
            .createHmac('sha256', config.BAYAR_GG_WEBHOOK_SECRET)
            .update(signatureData)
            .digest('hex');

        return safeEqual(signature.toLowerCase(), expectedSignature.toLowerCase());
    },
};

function normalizeCreatePaymentResponse(input: any): BayarGgPayment {
    const root = input?.data && typeof input.data === 'object' ? input.data : input;
    const payment = root?.payment || input?.payment || root || {};
    const qrisPayload = firstString(
        payment.qris_payload,
        payment.qris_string,
        payment.converted_qris,
        root?.qris_payload,
        root?.qris_string,
        root?.converted_qris,
        root?.qris_converter?.converted_qris,
        input?.qris_payload,
        input?.qris_string,
        input?.converted_qris,
        input?.qris_converter?.converted_qris
    );
    const qrisImageUrl = firstString(
        payment.qr_image_url,
        root?.qr_image_url,
        root?.qris_image_url,
        root?.qris_converter?.qr_image_url,
        input?.qr_image_url,
        input?.qris_image_url,
        input?.qris_converter?.qr_image_url
    );
    const amount = parsePositiveInt(payment.amount || root?.amount, 'Nominal transaksi BAYAR GG tidak valid');
    const finalAmount = parsePositiveInt(payment.final_amount || root?.final_amount, 'Nominal akhir BAYAR GG tidak valid');

    return {
        invoiceId: String(payment.invoice_id || root?.invoice_id || input?.invoice_id || '').trim(),
        amount,
        uniqueCode: parseNonNegativeInt(
            payment.unique_code ?? root?.unique_code ?? Math.max(0, finalAmount - amount),
            'Kode unik BAYAR GG tidak valid'
        ),
        finalAmount,
        paymentMethod: normalizeMethod(payment.payment_method || root?.payment_method || input?.payment_method || config.BAYAR_GG_PAYMENT_METHOD),
        status: String(payment.status || root?.status || '').trim().toLowerCase(),
        expiresAt: String(payment.expires_at || root?.expires_at || '').trim(),
        paymentUrl: String(root?.payment_url || input?.payment_url || payment.payment_url || '').trim(),
        qrisPayload,
        qrisImageUrl,
        raw: input,
    };
}

function normalizeCheckPaymentResponse(input: any): BayarGgPaymentDetail {
    const root = input?.data && typeof input.data === 'object' ? input.data : input;

    return {
        invoiceId: String(root?.invoice_id || '').trim(),
        status: String(root?.status || '').trim().toLowerCase(),
        amount: parsePositiveInt(root?.amount, 'Nominal detail BAYAR GG tidak valid'),
        finalAmount: parsePositiveInt(root?.final_amount, 'Nominal akhir detail BAYAR GG tidak valid'),
        paymentMethod: normalizeMethod(root?.payment_method || config.BAYAR_GG_PAYMENT_METHOD),
        paidAt: root?.paid_at ? String(root.paid_at) : null,
        paidReferenceNumber: root?.paid_reff_num ? String(root.paid_reff_num) : null,
        expiresAt: root?.expires_at ? String(root.expires_at) : null,
        raw: input,
    };
}

function normalizeMethod(value: unknown) {
    const normalized = String(value || 'qris').trim().toLowerCase();
    return normalized || 'qris';
}

function firstString(...values: unknown[]) {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
    }
    return '';
}

function parsePositiveInt(value: unknown, message: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(message);
    }
    return Math.trunc(parsed);
}

function parseNonNegativeInt(value: unknown, message: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(message);
    }
    return Math.trunc(parsed);
}

function safeEqual(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}
