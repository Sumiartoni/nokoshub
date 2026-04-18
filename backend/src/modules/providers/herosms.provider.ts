import axios, { AxiosInstance } from 'axios';
import { config } from '../../app/config';
import logger from '../../utils/logger';
import { pricingService } from '../pricing/pricing.service';

type AnyRecord = Record<string, any>;

export interface ProviderService {
    service_code: string;
    service_name: string;
    service_img?: string;
}

export interface ProviderPrice {
    price: number;
    provider_id: string;
    provider_price_usd?: number | null;
}

export interface ProviderCountry {
    number_id: string;
    name: string;
    iso_code?: string;
    pricelist: ProviderPrice[];
}

export interface ProviderOrderParams {
    serviceCode: string;
    countryCode: string;
    providerId?: string;
    maxPrice?: number;
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

export interface HeroSMSPriceIdParts {
    serviceCode: string;
    countryCode: string;
    providerId: string;
}

const PRICE_ID_PREFIX = 'herosms';

export function buildHeroSMSPriceId(serviceCode: string, countryCode: string, providerId: string): string {
    return [
        PRICE_ID_PREFIX,
        encodePart(serviceCode),
        encodePart(countryCode),
        encodePart(providerId || 'default'),
    ].join(':');
}

export function parseHeroSMSPriceId(priceId: string): HeroSMSPriceIdParts | null {
    const [prefix, serviceCode, countryCode, providerId] = priceId.split(':');
    if (prefix !== PRICE_ID_PREFIX || !serviceCode || !countryCode || !providerId) {
        return null;
    }

    try {
        return {
            serviceCode: decodePart(serviceCode),
            countryCode: decodePart(countryCode),
            providerId: decodePart(providerId),
        };
    } catch {
        return null;
    }
}

function encodePart(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
}

function decodePart(value: string): string {
    return Buffer.from(value, 'base64url').toString('utf8');
}

function isRecord(value: unknown): value is AnyRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toStringValue(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
}

function toNumberValue(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const normalized = value.replace(/[^\d.,-]/g, '').replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeHeroSMSBaseUrl(value: string): string {
    const trimmed = value.replace(/\/+$/, '');
    if (trimmed.endsWith('/stubs/handler_api.php')) return trimmed;
    if (trimmed.endsWith('/api/v1')) {
        return trimmed.replace(/\/api\/v1$/, '/stubs/handler_api.php');
    }
    return `${trimmed}/stubs/handler_api.php`;
}

function textFromResponse(data: unknown): string {
    return typeof data === 'string' ? data.trim() : JSON.stringify(data);
}

function smsActivateMessage(data: unknown, fallback: string): string {
    const text = textFromResponse(data);
    return text && text !== '{}' ? text : fallback;
}

function normalizeStatus(data: unknown): ProviderStatusResult {
    const text = textFromResponse(data);

    if (text.startsWith('STATUS_OK:')) {
        return {
            success: true,
            status: 'completed',
            sms_code: text.split(':').slice(1).join(':'),
            phone_number: null,
            message: 'OTP received',
        };
    }

    if (text.startsWith('STATUS_WAIT_RETRY:')) {
        return {
            success: false,
            status: 'waiting',
            sms_code: text.split(':').slice(1).join(':') || null,
            phone_number: null,
            message: 'Waiting for another SMS',
        };
    }

    if (text === 'STATUS_WAIT_CODE') {
        return { success: false, status: 'waiting', sms_code: null, phone_number: null, message: 'Waiting for SMS' };
    }

    if (text === 'STATUS_CANCEL' || text === 'NO_ACTIVATION') {
        return { success: false, status: 'cancelled', sms_code: null, phone_number: null, message: text };
    }

    if (isRecord(data)) {
        const sms = isRecord(data.sms) ? data.sms : undefined;
        const call = isRecord(data.call) ? data.call : undefined;
        const code = toStringValue(data.code ?? data.sms_code ?? data.otp ?? sms?.code ?? call?.code);
        const status = toStringValue(data.status ?? data.state) ?? (code ? 'completed' : 'waiting');
        return {
            success: Boolean(code),
            status: code ? 'completed' : status.toLowerCase(),
            sms_code: code,
            phone_number: toStringValue(data.phone ?? data.number ?? data.phone_number),
            message: toStringValue(data.message ?? sms?.text ?? call?.text) ?? status,
        };
    }

    return { success: false, status: 'waiting', sms_code: null, phone_number: null, message: text || 'Waiting' };
}

class HeroSMSProvider {
    private client: AxiosInstance;
    private countriesCache: Map<string, string> | null = null;

    constructor() {
        this.client = axios.create({
            baseURL: normalizeHeroSMSBaseUrl(config.HERO_SMS_BASE_URL),
            timeout: 15000,
            headers: {
                Accept: 'application/json,text/plain,*/*',
            },
        });
    }

    async getServices(): Promise<ProviderService[]> {
        try {
            const res = await this.request('getServicesList');
            const services = normalizeServicesResponse(res.data);

            if (!services.length) {
                logger.warn({ body: res.data }, 'No HeroSMS services returned');
            }

            logger.info({ count: services.length }, 'HeroSMS services loaded');
            return services;
        } catch (err: any) {
            logger.error({ err: this.errorSummary(err) }, 'HeroSMS getServices failed');
            return [];
        }
    }

    async getCountries(serviceId: string | number): Promise<ProviderCountry[]> {
        const serviceCode = String(serviceId);

        try {
            const [countriesById, pricesRes] = await Promise.all([
                this.getCountriesMap(),
                this.request('getPrices', { service: serviceCode }),
            ]);
            const rateInfo = await pricingService.getUsdIdrRate();

            return this.normalizePricesByCountry(pricesRes.data, serviceCode, countriesById, rateInfo.effectiveRate);
        } catch (err: any) {
            logger.warn({ err: this.errorSummary(err), serviceCode }, 'HeroSMS getCountries failed');
            return [];
        }
    }

    async orderNumber(params: ProviderOrderParams): Promise<ProviderOrderResult> {
        try {
            const requestParams: AnyRecord = {
                service: params.serviceCode,
                country: params.countryCode,
            };

            const rateInfo = await pricingService.getUsdIdrRate();
            const maxPrice = this.toProviderPrice(params.maxPrice, rateInfo.effectiveRate);
            if (maxPrice) {
                requestParams.maxPrice = maxPrice;
            }

            const res = await this.request('getNumberV2', requestParams);
            const text = textFromResponse(res.data);

            if (text.startsWith('ACCESS_NUMBER:')) {
                const [, orderId, phoneNumber] = text.split(':');
                return {
                    success: Boolean(orderId && phoneNumber),
                    order_id: orderId ?? null,
                    phone_number: phoneNumber ?? null,
                    message: 'Order created',
                };
            }

            if (isRecord(res.data)) {
                const orderId = toStringValue(
                    res.data.activationId ?? res.data.id ?? res.data.order_id ?? res.data.activation_id
                );
                const phoneNumber = toStringValue(
                    res.data.phoneNumber ?? res.data.number ?? res.data.phone ?? res.data.phone_number
                );
                return {
                    success: Boolean(orderId && phoneNumber),
                    order_id: orderId,
                    phone_number: phoneNumber,
                    message: toStringValue(res.data.message) ?? 'Order response received',
                };
            }

            return { success: false, order_id: null, phone_number: null, message: text || 'Order failed' };
        } catch (err: any) {
            logger.error({ err: this.errorSummary(err) }, 'HeroSMS orderNumber failed');
            return {
                success: false,
                order_id: null,
                phone_number: null,
                message: err.response?.data ? smsActivateMessage(err.response.data, err.message) : err.message,
            };
        }
    }

    async checkStatus(orderId: string): Promise<ProviderStatusResult> {
        try {
            const res = await this.request('getStatusV2', { id: orderId });
            return normalizeStatus(res.data);
        } catch (err: any) {
            logger.warn({ err: this.errorSummary(err), orderId }, 'HeroSMS getStatusV2 failed, trying getStatus');
        }

        try {
            const res = await this.request('getStatus', { id: orderId });
            return normalizeStatus(res.data);
        } catch (err: any) {
            logger.error({ err: this.errorSummary(err), orderId }, 'HeroSMS getStatus failed');
            return { success: false, status: 'error', sms_code: null, phone_number: null, message: err.message };
        }
    }

    async finishActivation(orderId: string): Promise<void> {
        try {
            await this.request('finishActivation', { id: orderId });
        } catch (err: any) {
            logger.warn({ err: this.errorSummary(err), orderId }, 'HeroSMS finishActivation failed');
        }
    }

    async cancelActivation(orderId: string): Promise<void> {
        try {
            await this.request('cancelActivation', { id: orderId });
        } catch (err: any) {
            logger.warn({ err: this.errorSummary(err), orderId }, 'HeroSMS cancelActivation failed, trying SMS-Activate setStatus=8');
            await this.request('setStatus', { id: orderId, status: 8 });
        }
    }

    async getBalance(): Promise<number> {
        try {
            const res = await this.request('getBalance');
            const text = textFromResponse(res.data);
            if (text.startsWith('ACCESS_BALANCE:')) {
                return toNumberValue(text.split(':')[1]) ?? 0;
            }
            return toNumberValue(isRecord(res.data) ? res.data.balance : res.data) ?? 0;
        } catch (err: any) {
            logger.error({ err: this.errorSummary(err) }, 'HeroSMS getBalance failed');
            return 0;
        }
    }

    private async getCountriesMap(): Promise<Map<string, string>> {
        if (this.countriesCache) return this.countriesCache;

        const res = await this.request('getCountries');
        const countries = new Map<string, string>();
        const items = Array.isArray(res.data)
            ? res.data
            : Object.entries(isRecord(res.data) ? res.data : {}).map(([id, value]) => ({ id, ...(isRecord(value) ? value : {}) }));

        for (const item of items) {
            const id = toStringValue(item.id ?? item._key);
            const name = toStringValue(item.eng ?? item.name ?? item.rus ?? item.chn ?? id);
            if (id && name) countries.set(id, name);
        }

        this.countriesCache = countries;
        return countries;
    }

    private normalizePricesByCountry(
        body: unknown,
        serviceCode: string,
        countriesById: Map<string, string>,
        usdIdrRate: number
    ): ProviderCountry[] {
        const priceRoot = isRecord(body) && isRecord(body.data) ? body.data : body;
        if (Array.isArray(priceRoot)) {
            return this.normalizePriceArray(priceRoot, serviceCode, countriesById, usdIdrRate);
        }
        if (!isRecord(priceRoot)) return [];

        const countries: ProviderCountry[] = [];

        for (const [countryCode, countryValue] of Object.entries(priceRoot)) {
            if (!isRecord(countryValue)) continue;

            const servicePrice = countryValue[serviceCode] ?? countryValue;
            if (!isRecord(servicePrice)) continue;

            const count = toNumberValue(servicePrice.count ?? servicePrice.quantity ?? servicePrice.available);
            if (count !== null && count <= 0) continue;

            const rawPrice = toNumberValue(servicePrice.cost ?? servicePrice.price ?? servicePrice.amount);
            if (rawPrice === null || rawPrice <= 0) continue;

            countries.push({
                number_id: countryCode,
                name: countriesById.get(countryCode) ?? countryCode,
                pricelist: [
                    {
                        price: this.toIdrPrice(rawPrice, usdIdrRate),
                        provider_id: 'default',
                        provider_price_usd: rawPrice < 1000 ? rawPrice : null,
                    },
                ],
            });
        }

        return countries;
    }

    private normalizePriceArray(
        priceRoot: unknown[],
        serviceCode: string,
        countriesById: Map<string, string>,
        usdIdrRate: number
    ): ProviderCountry[] {
        return priceRoot
            .map((entry, index): ProviderCountry | null => {
                if (!isRecord(entry)) return null;

                const countryCode = toStringValue(entry.country ?? entry.countryCode ?? entry.id) ?? String(index);
                const servicePrice = isRecord(entry[serviceCode]) ? entry[serviceCode] : entry;

                const count = toNumberValue(servicePrice.count ?? servicePrice.quantity ?? servicePrice.available);
                if (count !== null && count <= 0) return null;

                const rawPrice = toNumberValue(servicePrice.cost ?? servicePrice.price ?? servicePrice.amount);
                if (rawPrice === null || rawPrice <= 0) return null;

                return {
                    number_id: countryCode,
                    name: countriesById.get(countryCode) ?? countryCode,
                    pricelist: [
                        {
                            price: this.toIdrPrice(rawPrice, usdIdrRate),
                            provider_id: 'default',
                            provider_price_usd: rawPrice < 1000 ? rawPrice : null,
                        },
                    ],
                };
            })
            .filter((item: ProviderCountry | null): item is ProviderCountry => Boolean(item));
    }

    private request(action: string, params: AnyRecord = {}) {
        return this.client.get('', {
            params: {
                api_key: config.HERO_SMS_API_KEY,
                action,
                ...params,
            },
        });
    }

    private toIdrPrice(price: number, usdIdrRate: number): number {
        if (price >= 1000) return Math.ceil(price);
        return Math.ceil(price * usdIdrRate);
    }

    private toProviderPrice(price: number | undefined, usdIdrRate: number): number | undefined {
        if (!price || price <= 0) return undefined;
        if (price >= 1000) {
            return Number((price / usdIdrRate).toFixed(4));
        }
        return price;
    }

    private errorSummary(err: any) {
        return {
            status: err.response?.status,
            data: err.response?.data,
            message: err.message,
        };
    }
}

export const heroSMSProvider = new HeroSMSProvider();

function normalizeServicesResponse(body: unknown): ProviderService[] {
    const servicesByCode = new Map<string, ProviderService>();

    const roots: unknown[] = [body];
    if (isRecord(body)) {
        roots.push(body.services, body.data);
        if (isRecord(body.data)) roots.push(body.data.services);
    }

    for (const root of roots) {
        for (const service of normalizeServicesRoot(root)) {
            servicesByCode.set(service.service_code, service);
        }
    }

    return [...servicesByCode.values()].sort((a, b) => a.service_name.localeCompare(b.service_name));
}

function normalizeServicesRoot(root: unknown): ProviderService[] {
    if (!root) return [];

    if (Array.isArray(root)) {
        return root
            .map((item): ProviderService | null => {
                if (Array.isArray(item)) return normalizeServiceEntry(item[0], item[1]);
                if (isRecord(item)) return normalizeServiceEntry(item.code ?? item.service ?? item.id, item);
                return null;
            })
            .filter((item: ProviderService | null): item is ProviderService => Boolean(item));
    }

    if (isRecord(root)) {
        return Object.entries(root)
            .map(([code, value]) => normalizeServiceEntry(code, value))
            .filter((item: ProviderService | null): item is ProviderService => Boolean(item));
    }

    return [];
}

function normalizeServiceEntry(codeValue: unknown, value: unknown): ProviderService | null {
    const serviceCode = toStringValue(codeValue);
    if (!serviceCode || ['status', 'msg', 'message', 'error'].includes(serviceCode.toLowerCase())) return null;

    const serviceName = isRecord(value)
        ? toStringValue(value.name ?? value.title ?? value.label ?? value.service ?? serviceCode)
        : toStringValue(value);

    if (!serviceName) return null;

    return {
        service_code: serviceCode,
        service_name: serviceName.trim(),
    };
}
