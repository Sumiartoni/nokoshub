import axios from 'axios';
import { config } from '../../app/config';

const pakasirClient = axios.create({
    baseURL: 'https://app.pakasir.com/api',
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json',
    },
});

export interface PakasirPayment {
    project: string;
    orderId: string;
    amount: number;
    fee: number;
    totalPayment: number;
    paymentMethod: string;
    paymentNumber: string;
    expiredAt: string;
}

export interface PakasirTransactionDetail {
    amount: number;
    orderId: string;
    project: string;
    status: string;
    paymentMethod: string;
    completedAt: string | null;
}

export const pakasirService = {
    isConfigured() {
        return Boolean(config.PAKASIR_PROJECT_SLUG && config.PAKASIR_API_KEY);
    },

    assertConfigured() {
        if (!this.isConfigured()) {
            throw new Error('Pakasir belum dikonfigurasi di environment VPS');
        }
    },

    getConfigStatus() {
        return {
            configured: this.isConfigured(),
            projectSlug: config.PAKASIR_PROJECT_SLUG || '',
            paymentMethod: config.PAKASIR_PAYMENT_METHOD || 'qris',
            webhookTokenEnabled: Boolean(config.PAKASIR_WEBHOOK_TOKEN),
            redirectUrl: config.PAKASIR_REDIRECT_URL || '',
        };
    },

    async createTransaction(input: { orderId: string; amount: number }) {
        this.assertConfigured();

        const method = normalizeMethod(config.PAKASIR_PAYMENT_METHOD);
        const response = await pakasirClient.post(`/transactioncreate/${method}`, {
            project: config.PAKASIR_PROJECT_SLUG,
            order_id: input.orderId,
            amount: input.amount,
            api_key: config.PAKASIR_API_KEY,
        });

        const payment = response.data?.payment;
        if (!payment) {
            throw new Error('Response Pakasir tidak berisi data payment');
        }

        return normalizePayment(payment);
    },

    async getTransactionDetail(input: { orderId: string; amount: number }) {
        this.assertConfigured();

        const response = await pakasirClient.get('/transactiondetail', {
            params: {
                project: config.PAKASIR_PROJECT_SLUG,
                amount: input.amount,
                order_id: input.orderId,
                api_key: config.PAKASIR_API_KEY,
            },
        });

        const transaction = response.data?.transaction;
        if (!transaction) {
            throw new Error('Response detail transaksi Pakasir tidak valid');
        }

        return normalizeTransactionDetail(transaction);
    },

    async cancelTransaction(input: { orderId: string; amount: number }) {
        this.assertConfigured();

        await pakasirClient.post('/transactioncancel', {
            project: config.PAKASIR_PROJECT_SLUG,
            order_id: input.orderId,
            amount: input.amount,
            api_key: config.PAKASIR_API_KEY,
        });
    },

    async simulatePayment(input: { orderId: string; amount: number }) {
        this.assertConfigured();

        await pakasirClient.post('/paymentsimulation', {
            project: config.PAKASIR_PROJECT_SLUG,
            order_id: input.orderId,
            amount: input.amount,
            api_key: config.PAKASIR_API_KEY,
        });
    },

    buildHostedPaymentUrl(orderId: string, amount: number) {
        this.assertConfigured();

        const url = new URL(`https://app.pakasir.com/pay/${config.PAKASIR_PROJECT_SLUG}/${amount}`);
        url.searchParams.set('order_id', orderId);
        url.searchParams.set('qris_only', '1');

        if (config.PAKASIR_REDIRECT_URL) {
            url.searchParams.set('redirect', config.PAKASIR_REDIRECT_URL);
        }

        return url.toString();
    },
};

function normalizeMethod(input: string) {
    const value = String(input || 'qris').trim().toLowerCase();
    return value || 'qris';
}

function normalizePayment(input: any): PakasirPayment {
    return {
        project: String(input.project || config.PAKASIR_PROJECT_SLUG),
        orderId: String(input.order_id || ''),
        amount: parsePositiveInt(input.amount, 'Nominal transaksi Pakasir tidak valid'),
        fee: parseNonNegativeInt(input.fee, 'Fee Pakasir tidak valid'),
        totalPayment: parsePositiveInt(input.total_payment, 'Total pembayaran Pakasir tidak valid'),
        paymentMethod: String(input.payment_method || normalizeMethod(config.PAKASIR_PAYMENT_METHOD)),
        paymentNumber: String(input.payment_number || '').trim(),
        expiredAt: String(input.expired_at || ''),
    };
}

function normalizeTransactionDetail(input: any): PakasirTransactionDetail {
    return {
        amount: parsePositiveInt(input.amount, 'Nominal detail transaksi Pakasir tidak valid'),
        orderId: String(input.order_id || ''),
        project: String(input.project || ''),
        status: String(input.status || '').toLowerCase(),
        paymentMethod: String(input.payment_method || '').toLowerCase(),
        completedAt: input.completed_at ? String(input.completed_at) : null,
    };
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
