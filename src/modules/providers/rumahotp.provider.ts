import axios, { AxiosInstance } from 'axios';
import { config } from '../../app/config';
import logger from '../../utils/logger';

// ─── Response Types ────────────────────────────────────────────────────────────

export interface ProviderServiceItem {
    service: string;
    country: string;
    price_id: string;
    price: number;
}

export interface ProviderOrderResult {
    success: boolean;
    number: string | null;
    providerOrderId: string | null;
    message: string;
}

export interface ProviderSmsResult {
    success: boolean;
    otpCode: string | null;
    message: string;
}

// ─── RumahOTP Provider ─────────────────────────────────────────────────────────

class RumahOTPProvider {
    private client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: config.RUMAHOTP_BASE_URL,
            timeout: 15000,
        });
    }

    private apiKey(): string {
        return config.RUMAHOTP_API_KEY;
    }

    /** Get provider account balance */
    async getBalance(): Promise<number> {
        try {
            const res = await this.client.get('/user', {
                params: { api_key: this.apiKey() },
            });
            return res.data?.balance ?? 0;
        } catch (err) {
            logger.error({ err }, 'RumahOTP getBalance failed');
            throw err;
        }
    }

    /** Get full service + price list */
    async getServices(): Promise<ProviderServiceItem[]> {
        try {
            const res = await this.client.get('/service', {
                params: { api_key: this.apiKey() },
            });

            const raw = res.data;

            // Provider may return array or object keyed by price_id
            if (Array.isArray(raw)) return raw;

            // Normalize object response
            return Object.values(raw).map((item: any) => ({
                service: item.service ?? item.name,
                country: item.country,
                price_id: String(item.price_id ?? item.id),
                price: Number(item.price ?? item.harga ?? 0),
            }));
        } catch (err) {
            logger.error({ err }, 'RumahOTP getServices failed');
            throw err;
        }
    }

    /** Order a number by price_id */
    async orderNumber(priceId: string): Promise<ProviderOrderResult> {
        try {
            const res = await this.client.get('/order', {
                params: { api_key: this.apiKey(), price_id: priceId },
            });

            const data = res.data;

            if (!data || data.status === 'error' || data.status === 'false') {
                return {
                    success: false,
                    number: null,
                    providerOrderId: null,
                    message: data?.message ?? 'Order failed',
                };
            }

            return {
                success: true,
                number: data.number ?? data.phone ?? null,
                providerOrderId: String(data.order_id ?? data.id ?? ''),
                message: data.message ?? 'Order created',
            };
        } catch (err) {
            logger.error({ err, priceId }, 'RumahOTP orderNumber failed');
            return {
                success: false,
                number: null,
                providerOrderId: null,
                message: (err as Error).message,
            };
        }
    }

    /** Check SMS / OTP for an order */
    async checkSMS(providerOrderId: string): Promise<ProviderSmsResult> {
        try {
            const res = await this.client.get('/sms', {
                params: { api_key: this.apiKey(), order_id: providerOrderId },
            });

            const data = res.data;

            if (!data || !data.sms) {
                return { success: false, otpCode: null, message: 'Waiting for OTP...' };
            }

            // Extract OTP from SMS text (first sequence of 4-8 digits)
            const msg: string = String(data.sms);
            const match = msg.match(/\b(\d{4,8})\b/);
            const otpCode = match ? match[1] : msg;

            return { success: true, otpCode, message: msg };
        } catch (err) {
            logger.error({ err, providerOrderId }, 'RumahOTP checkSMS failed');
            return { success: false, otpCode: null, message: (err as Error).message };
        }
    }

    /** Cancel an order */
    async cancelOrder(providerOrderId: string): Promise<boolean> {
        try {
            const res = await this.client.get('/cancel', {
                params: { api_key: this.apiKey(), order_id: providerOrderId },
            });
            return res.data?.status !== 'error';
        } catch (err) {
            logger.error({ err, providerOrderId }, 'RumahOTP cancelOrder failed');
            return false;
        }
    }
}

export const rumahOTPProvider = new RumahOTPProvider();
