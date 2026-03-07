import axios, { AxiosInstance } from 'axios';
import { config } from '../../app/config';
import logger from '../../utils/logger';

// ─── Response Types ────────────────────────────────────────────────────────────

export interface ProviderService {
    service_code: number;
    service_name: string;
    service_img?: string;
}

export interface ProviderCountry {
    country_id: number;
    country_name: string;
    country_code: string;
    price: number;
    provider_id: number;
}

export interface ProviderOperator {
    operator_id: number;
    operator_name: string;
    number_id: number;
    price: number;
    provider_id: number;
}

export interface ProviderOrderResult {
    success: boolean;
    order_id: string | null;
    phone_number: string | null;
    message: string;
}

export interface ProviderStatusResult {
    success: boolean;
    status: string;
    sms_code: string | null;
    phone_number: string | null;
    message: string;
}

// ─── RumahOTP Provider (V2 API) ────────────────────────────────────────────────

class RumahOTPProvider {
    private client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: 'https://www.rumahotp.com/api',
            timeout: 15000,
            headers: {
                'x-apikey': config.RUMAHOTP_API_KEY,
                'Accept': 'application/json',
            },
        });
    }

    /** Get all available services */
    async getServices(): Promise<ProviderService[]> {
        try {
            const res = await this.client.get('/v2/services');
            const body = res.data;
            if (!body?.success || !Array.isArray(body.data)) {
                logger.warn({ body }, 'Unexpected getServices response');
                return [];
            }
            return body.data;
        } catch (err) {
            logger.error({ err }, 'RumahOTP getServices failed');
            return [];
        }
    }

    /** Get countries available for a service */
    async getCountries(serviceId: number): Promise<ProviderCountry[]> {
        try {
            const res = await this.client.get('/v2/countries', {
                params: { service_id: serviceId },
            });
            const body = res.data;
            if (!body?.success || !Array.isArray(body.data)) {
                return [];
            }
            return body.data;
        } catch (err) {
            logger.error({ err, serviceId }, 'RumahOTP getCountries failed');
            return [];
        }
    }

    /** Get operators/numbers for a country + provider */
    async getOperators(country: string, providerId: number): Promise<ProviderOperator[]> {
        try {
            const res = await this.client.get('/v2/operators', {
                params: { country, provider_id: providerId },
            });
            const body = res.data;
            if (!body?.status || !Array.isArray(body.data)) {
                return [];
            }
            return body.data;
        } catch (err) {
            logger.error({ err, country, providerId }, 'RumahOTP getOperators failed');
            return [];
        }
    }

    /** Order a number (V2) */
    async orderNumber(numberId: number, providerId: number, operatorId: number): Promise<ProviderOrderResult> {
        try {
            const res = await this.client.get('/v2/orders', {
                params: { number_id: numberId, provider_id: providerId, operator_id: operatorId },
            });
            const body = res.data;
            if (!body?.success) {
                return {
                    success: false,
                    order_id: null,
                    phone_number: null,
                    message: body?.message ?? 'Order failed',
                };
            }
            const d = body.data;
            return {
                success: true,
                order_id: String(d?.order_id ?? ''),
                phone_number: d?.phone_number ?? null,
                message: body.message ?? 'Order created',
            };
        } catch (err) {
            logger.error({ err }, 'RumahOTP orderNumber failed');
            return { success: false, order_id: null, phone_number: null, message: (err as Error).message };
        }
    }

    /** Check order status / SMS (V1 endpoint) */
    async checkStatus(orderId: string): Promise<ProviderStatusResult> {
        try {
            const res = await this.client.get('/v1/orders/get_status', {
                params: { order_id: orderId },
            });
            const body = res.data;
            if (!body?.success) {
                return { success: false, status: 'waiting', sms_code: null, phone_number: null, message: 'Waiting...' };
            }
            const d = body.data;
            const status = d?.status ?? 'waiting';
            // Extract OTP from sms_code field
            let smsCode: string | null = d?.sms_code ?? null;
            if (!smsCode && d?.sms) {
                // Fallback: extract digits from sms text
                const match = String(d.sms).match(/\b(\d{4,8})\b/);
                smsCode = match ? match[1] : String(d.sms);
            }
            return {
                success: status === 'completed' || status === 'received',
                status,
                sms_code: smsCode,
                phone_number: d?.phone_number ?? null,
                message: d?.message ?? status,
            };
        } catch (err) {
            logger.error({ err, orderId }, 'RumahOTP checkStatus failed');
            return { success: false, status: 'error', sms_code: null, phone_number: null, message: (err as Error).message };
        }
    }

    /** Get user balance/profile */
    async getBalance(): Promise<number> {
        try {
            const res = await this.client.get('/v1/profile');
            return res.data?.data?.balance ?? res.data?.balance ?? 0;
        } catch (err) {
            logger.error({ err }, 'RumahOTP getBalance failed');
            return 0;
        }
    }
}

export const rumahOTPProvider = new RumahOTPProvider();
