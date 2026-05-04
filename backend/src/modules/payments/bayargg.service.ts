import crypto from 'crypto';
import axios from 'axios';
import { config } from '../../app/config';

const bayarGgClient = axios.create({
    baseURL: 'https://www.bayar.gg/api',
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'NokosHUB/1.0 (+https://nokoshub.store)',
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

    buildWebhookUrl(includeAuthToken = false) {
        const publicBase = String(config.PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '');
        if (!publicBase) return '';

        const apiBase = publicBase.endsWith('/api') ? publicBase : `${publicBase}/api`;
        const url = new URL(`${apiBase}/payment/webhook`);
        if (includeAuthToken && config.BAYAR_GG_WEBHOOK_SECRET) {
            url.searchParams.set('token', String(config.BAYAR_GG_WEBHOOK_SECRET).trim());
        }
        return url.toString();
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

        const callbackUrl = this.buildWebhookUrl(true);
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

        const payment = normalizeCreatePaymentResponse(response.data);
        return enrichHostedPaymentQr(payment);
    },

    async checkPayment(invoiceId: string): Promise<BayarGgPaymentDetail> {
        this.assertConfigured();
        const headers = {
            'X-API-Key': config.BAYAR_GG_API_KEY,
        };

        try {
            const response = await bayarGgClient.get('/check-payment.php', {
                headers,
                params: {
                    invoice: invoiceId,
                },
            });

            return normalizeCheckPaymentResponse(response.data);
        } catch (error) {
            return checkPaymentFromList(invoiceId, headers, error);
        }
    },

    verifyWebhookSignature(payload: BayarGgWebhookPayload, headers: Record<string, any>) {
        const secret = String(config.BAYAR_GG_WEBHOOK_SECRET || '').trim();
        if (!secret) {
            return false;
        }

        const invoiceId = String(payload.invoice_id || '').trim();
        const rawStatus = String(payload.status || '').trim();
        const normalizedStatus = rawStatus.toLowerCase();
        const signature = normalizeSignatureValue(headers['x-webhook-signature'] || payload.signature);
        const rawFinalAmount = String(payload.final_amount ?? '').trim();
        const parsedFinalAmount = Number(payload.final_amount ?? Number.NaN);
        const timestampCandidates = uniqueNonEmptyStrings(
            headers['x-webhook-timestamp'],
            payload.timestamp
        );
        const finalAmountCandidates = uniqueNonEmptyStrings(
            rawFinalAmount,
            Number.isFinite(parsedFinalAmount) && parsedFinalAmount > 0 ? String(Math.trunc(parsedFinalAmount)) : ''
        );
        const statusCandidates = uniqueNonEmptyStrings(rawStatus, normalizedStatus);

        if (!signature || !invoiceId || !statusCandidates.length || !finalAmountCandidates.length || !timestampCandidates.length) {
            return false;
        }

        for (const status of statusCandidates) {
            for (const finalAmount of finalAmountCandidates) {
                for (const timestamp of timestampCandidates) {
                    const signatureData = `${invoiceId}|${status}|${finalAmount}|${timestamp}`;
                    const expectedSignature = crypto
                        .createHmac('sha256', secret)
                        .update(signatureData)
                        .digest('hex');

                    if (safeEqual(signature, expectedSignature.toLowerCase())) {
                        return true;
                    }
                }
            }
        }

        return false;
    },

    verifyWebhookToken(token?: string) {
        const secret = String(config.BAYAR_GG_WEBHOOK_SECRET || '').trim();
        if (!secret) return false;
        return safeEqual(String(token || '').trim(), secret);
    },
};

function normalizeCreatePaymentResponse(input: any): BayarGgPayment {
    const root = input?.data && typeof input.data === 'object' ? input.data : input;
    const payment = root?.payment || input?.payment || root || {};
    const qrisPayload = firstString(
        root?.qris_converter?.converted_qris,
        input?.qris_converter?.converted_qris,
        payment.converted_qris,
        root?.converted_qris,
        payment.qris_payload,
        payment.qris_string,
        root?.qris_payload,
        root?.qris_string,
        input?.qris_payload,
        input?.qris_string,
        input?.converted_qris
    );
    const qrisImageUrl = firstString(
        root?.qris_converter?.qr_image_url,
        input?.qris_converter?.qr_image_url,
        payment.qr_image_url,
        root?.qr_image_url,
        root?.qris_image_url,
        input?.qr_image_url,
        input?.qris_image_url
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
    if (input && typeof input === 'object' && input.success === false) {
        throw new Error(extractRemoteMessage(input, 'BAYAR GG mengembalikan response gagal'));
    }

    const root = input?.data && typeof input.data === 'object' ? input.data : input;
    const payment = root?.payment && typeof root.payment === 'object' ? root.payment : root;

    return {
        invoiceId: String(payment?.invoice_id || root?.invoice_id || '').trim(),
        status: String(payment?.status || root?.status || '').trim().toLowerCase(),
        amount: parsePositiveInt(payment?.amount ?? root?.amount, 'Nominal detail BAYAR GG tidak valid'),
        finalAmount: parsePositiveInt(payment?.final_amount ?? root?.final_amount, 'Nominal akhir detail BAYAR GG tidak valid'),
        paymentMethod: normalizeMethod(payment?.payment_method || root?.payment_method || config.BAYAR_GG_PAYMENT_METHOD),
        paidAt: payment?.paid_at ? String(payment.paid_at) : root?.paid_at ? String(root.paid_at) : null,
        paidReferenceNumber: payment?.paid_reff_num ? String(payment.paid_reff_num) : root?.paid_reff_num ? String(root.paid_reff_num) : null,
        expiresAt: payment?.expires_at ? String(payment.expires_at) : root?.expires_at ? String(root.expires_at) : null,
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

function normalizeSignatureValue(value: unknown) {
    return String(value || '')
        .trim()
        .replace(/^sha256=/i, '')
        .toLowerCase();
}

function uniqueNonEmptyStrings(...values: unknown[]) {
    const seen = new Set<string>();
    const results: string[] = [];

    for (const value of values) {
        const text = String(value ?? '').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        results.push(text);
    }

    return results;
}

function extractRemoteMessage(input: any, fallback: string) {
    const message = firstString(
        input?.message,
        input?.error,
        input?.errors?.[0]?.message,
        input?.data?.message,
        input?.data?.error
    );
    return message || fallback;
}

async function checkPaymentFromList(
    invoiceId: string,
    headers: Record<string, string>,
    cause: unknown
): Promise<BayarGgPaymentDetail> {
    const response = await bayarGgClient.get('/list-payments.php', {
        headers,
        params: {
            search: invoiceId,
            limit: 10,
        },
    });
    const payload: any = response.data;

    if (payload && typeof payload === 'object' && payload.success === false) {
        throw new Error(extractRemoteMessage(payload, 'BAYAR GG list-payments gagal'));
    }

    const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.payments)
          ? payload.payments
          : [];

    const exactMatch = rows.find((row: any) => String(row?.invoice_id || '').trim() === invoiceId);
    if (!exactMatch) {
        const originalError = extractAxiosErrorMessage(cause);
        throw new Error(originalError || `Invoice ${invoiceId} tidak ditemukan di response BAYAR GG`);
    }

    return normalizeCheckPaymentResponse(exactMatch);
}

function extractAxiosErrorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
        return extractRemoteMessage(error.response?.data, error.message);
    }
    if (error instanceof Error) {
        return error.message;
    }
    return '';
}

async function enrichHostedPaymentQr(payment: BayarGgPayment): Promise<BayarGgPayment> {
    if (!payment.paymentUrl) return payment;

    if (payment.qrisPayload && payment.qrisImageUrl) {
        return payment;
    }

    try {
        const response = await axios.get(payment.paymentUrl, {
            timeout: 15000,
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml',
            },
        });

        const html = String(response.data || '');
        const hostedQrImageUrl = extractHostedQrImageUrl(html, payment.paymentUrl);
        const hostedQrisPayload = extractHostedQrisPayload(hostedQrImageUrl);

        return {
            ...payment,
            qrisImageUrl: hostedQrImageUrl || payment.qrisImageUrl,
            qrisPayload: hostedQrisPayload || payment.qrisPayload,
        };
    } catch {
        return payment;
    }
}

function extractHostedQrImageUrl(html: string, paymentUrl: string) {
    const matches = [
        ...html.matchAll(/https?:\/\/[^"'\\\s>]+qr\.php\?text=[^"'\\\s>]+/gi),
        ...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi),
    ];

    for (const match of matches) {
        const candidate = String(match[1] || match[0] || '').trim();
        if (!candidate) continue;
        if (!/qr\.php\?text=|qris|qr-code/i.test(candidate)) continue;

        try {
            return new URL(candidate, paymentUrl).toString();
        } catch {
            continue;
        }
    }

    return '';
}

function extractHostedQrisPayload(qrImageUrl: string) {
    if (!qrImageUrl) return '';

    try {
        const url = new URL(qrImageUrl);
        return url.searchParams.get('text') || url.searchParams.get('qris') || '';
    } catch {
        return '';
    }
}
