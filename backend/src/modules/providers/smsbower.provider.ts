import axios, { AxiosInstance } from 'axios';
import { config } from '../../app/config';
import logger from '../../utils/logger';
import { pricingService } from '../pricing/pricing.service';
import { PROVIDER_BROWSER_HEADERS } from './provider-http';
import { buildOutboundAxiosConfig } from '../../utils/outbound-http';
import type {
    ProviderCountry,
    ProviderOrderParams,
    ProviderOrderResult,
    ProviderService,
    ProviderStatusResult,
} from './herosms.provider';

type AnyRecord = Record<string, any>;

export interface SmsBowerPriceIdParts {
    serviceCode: string;
    countryCode: string;
    providerId: string;
}

const PRICE_ID_PREFIX = 'server1';
const RETRYABLE_NETWORK_CODES = new Set(['EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND']);
const SERVER_EMPTY_WAIT_MESSAGE = 'Nomor dari server habis tunggu beberapa saat lagi';
const SERVER_EMPTY_RESTOCK_MESSAGE = 'Nomor dari server habis silahkan tunggu beberapa saat lagi hingga server re stock';

export function buildSmsBowerPriceId(serviceCode: string, countryCode: string, providerId: string) {
    return [
        PRICE_ID_PREFIX,
        encodePart(serviceCode),
        encodePart(countryCode),
        encodePart(providerId || 'default'),
    ].join(':');
}

export function parseSmsBowerPriceId(priceId: string): SmsBowerPriceIdParts | null {
    const [prefix, serviceCode, countryCode, providerId] = String(priceId || '').split(':');
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

function normalizeBaseUrl(value: string): string {
    const trimmed = value.replace(/\/+$/, '');
    if (trimmed.endsWith('/stubs/handler_api.php')) return trimmed;
    if (trimmed.endsWith('/api/v1')) {
        return trimmed.replace(/\/api\/v1$/, '/stubs/handler_api.php');
    }
    return `${trimmed}/stubs/handler_api.php`;
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

function textFromResponse(data: unknown): string {
    return typeof data === 'string' ? data.trim() : JSON.stringify(data);
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

    if (text === 'STATUS_WAIT_CODE' || text === 'STATUS_WAIT_RESEND') {
        return { success: false, status: 'waiting', sms_code: null, phone_number: null, message: text };
    }

    if (text === 'STATUS_CANCEL' || text === 'NO_ACTIVATION') {
        return { success: false, status: 'cancelled', sms_code: null, phone_number: null, message: text };
    }

    if (isRecord(data)) {
        const code = toStringValue(data.code ?? data.sms_code ?? data.otp);
        const status = toStringValue(data.status ?? data.state) ?? (code ? 'completed' : 'waiting');
        return {
            success: Boolean(code),
            status: code ? 'completed' : status.toLowerCase(),
            sms_code: code,
            phone_number: toStringValue(data.phone ?? data.number ?? data.phone_number),
            message: toStringValue(data.message) ?? status,
        };
    }

    return { success: false, status: 'waiting', sms_code: null, phone_number: null, message: text || 'Waiting' };
}

class SmsBowerProvider {
    private client: AxiosInstance;
    private countriesCache: Map<string, string> | null = null;

    constructor() {
        this.client = axios.create(
            buildOutboundAxiosConfig({
                baseURL: normalizeBaseUrl(config.SMSBOWER_BASE_URL),
                timeout: 15000,
                headers: PROVIDER_BROWSER_HEADERS,
            })
        );
    }

    isConfigured() {
        return Boolean(String(config.SMSBOWER_API_KEY || '').trim());
    }

    async getServices(): Promise<ProviderService[]> {
        if (!this.isConfigured()) return [];
        try {
            const res = await this.request('getServicesList');
            return normalizeServicesResponse(res.data);
        } catch (err: any) {
            logger.error({ err: this.errorSummary(err) }, 'SmsBower getServices failed');
            return [];
        }
    }

    async getCountries(serviceId: string | number): Promise<ProviderCountry[]> {
        if (!this.isConfigured()) return [];

        const serviceCode = String(serviceId);
        try {
            const [countriesById, pricesRes] = await Promise.all([
                this.getCountriesMap(),
                this.request('getPricesV3', { service: serviceCode }),
            ]);
            const rateInfo = await pricingService.getUsdIdrRate();
            return this.normalizePricesByCountry(pricesRes.data, serviceCode, countriesById, rateInfo.effectiveRate);
        } catch (err: any) {
            logger.warn({ err: this.errorSummary(err), serviceCode }, 'SmsBower getCountries failed');
            return [];
        }
    }

    async orderNumber(params: ProviderOrderParams): Promise<ProviderOrderResult> {
        if (!this.isConfigured()) {
            return { success: false, order_id: null, phone_number: null, message: 'SMSBower belum dikonfigurasi' };
        }

        try {
            const requestParams: AnyRecord = {
                service: params.serviceCode,
                country: params.countryCode,
            };
            if (params.providerId && params.providerId !== 'default') {
                requestParams.providerIds = params.providerId;
            }

            const maxPrice = await this.resolveMaxPrice(params);
            if (maxPrice) requestParams.maxPrice = maxPrice;

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
                const orderId = toStringValue(res.data.activationId ?? res.data.id ?? res.data.order_id);
                const phoneNumber = toStringValue(res.data.phoneNumber ?? res.data.number ?? res.data.phone);
                return {
                    success: Boolean(orderId && phoneNumber),
                    order_id: orderId,
                    phone_number: phoneNumber,
                    message: humanizeProviderOrderMessage(toStringValue(res.data.message) ?? 'Order response received'),
                };
            }

            return {
                success: false,
                order_id: null,
                phone_number: null,
                message: humanizeProviderOrderMessage(text || 'Order failed'),
            };
        } catch (err: any) {
            logger.error({ err: this.errorSummary(err) }, 'SmsBower orderNumber failed');
            return {
                success: false,
                order_id: null,
                phone_number: null,
                message: this.humanizeRequestError(err),
            };
        }
    }

    async checkStatus(orderId: string): Promise<ProviderStatusResult> {
        if (!this.isConfigured()) {
            return { success: false, status: 'error', sms_code: null, phone_number: null, message: 'SMSBower belum dikonfigurasi' };
        }
        try {
            const res = await this.request('getStatus', { id: orderId });
            return normalizeStatus(res.data);
        } catch (err: any) {
            logger.error({ err: this.errorSummary(err), orderId }, 'SmsBower getStatus failed');
            return { success: false, status: 'error', sms_code: null, phone_number: null, message: err.message };
        }
    }

    async finishActivation(orderId: string): Promise<void> {
        try {
            await this.request('setStatus', { id: orderId, status: 6 });
        } catch (err: any) {
            logger.warn({ err: this.errorSummary(err), orderId }, 'SmsBower finishActivation failed');
        }
    }

    async markActivationReady(orderId: string): Promise<void> {
        try {
            await this.request('setStatus', { id: orderId, status: 1 });
        } catch (err: any) {
            logger.warn({ err: this.errorSummary(err), orderId }, 'SmsBower setStatus=1 failed');
        }
    }

    async cancelActivation(orderId: string): Promise<void> {
        try {
            await this.request('setStatus', { id: orderId, status: 8 });
        } catch (err: any) {
            logger.warn({ err: this.errorSummary(err), orderId }, 'SmsBower cancelActivation failed');
        }
    }

    async getBalance(): Promise<number> {
        if (!this.isConfigured()) return 0;
        try {
            const res = await this.request('getBalance');
            const text = textFromResponse(res.data);
            if (text.startsWith('ACCESS_BALANCE:')) {
                return toNumberValue(text.split(':')[1]) ?? 0;
            }
            return toNumberValue(isRecord(res.data) ? res.data.balance : res.data) ?? 0;
        } catch (err: any) {
            logger.error({ err: this.errorSummary(err) }, 'SmsBower getBalance failed');
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

    private normalizePricesByCountry(body: unknown, serviceCode: string, countriesById: Map<string, string>, usdIdrRate: number): ProviderCountry[] {
        const root = isRecord(body) && isRecord(body.data) ? body.data : body;
        if (!isRecord(root)) return [];

        const grouped = new Map<string, ProviderCountry>();

        for (const [countryCode, countryValue] of Object.entries(root)) {
            if (!isRecord(countryValue)) continue;

            const providerEntries = isRecord(countryValue[serviceCode])
                ? countryValue[serviceCode]
                : countryValue;

            if (!isRecord(providerEntries)) continue;

            const prices = Object.entries(providerEntries)
                .map(([providerId, providerValue]) => {
                    if (!isRecord(providerValue)) return null;
                    const count = toNumberValue(providerValue.count ?? providerValue.quantity ?? providerValue.available);
                    if (count !== null && count <= 0) return null;

                    const rawPrice = toNumberValue(providerValue.cost ?? providerValue.price ?? providerValue.amount);
                    if (rawPrice === null || rawPrice <= 0) return null;

                    return {
                        provider_id: providerId,
                        price: this.toIdrPrice(rawPrice, usdIdrRate),
                        provider_price_usd: rawPrice < 1000 ? rawPrice : null,
                    };
                })
                .filter((item): item is { provider_id: string; price: number; provider_price_usd: number | null } => Boolean(item));

            if (!prices.length) continue;

            grouped.set(countryCode, {
                number_id: countryCode,
                name: countriesById.get(countryCode) ?? countryCode,
                pricelist: prices,
            });
        }

        return [...grouped.values()];
    }

    private request(action: string, params: AnyRecord = {}) {
        return withRetry(() => this.client.get('', {
            params: {
                api_key: config.SMSBOWER_API_KEY,
                action,
                ...params,
            },
        }), `smsbower:${action}`);
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

    private async resolveMaxPrice(params: ProviderOrderParams): Promise<number | undefined> {
        if (params.providerPriceUsd && params.providerPriceUsd > 0) {
            return Number(params.providerPriceUsd.toFixed(6));
        }

        const rateInfo = await pricingService.getUsdIdrRate();
        return this.toProviderPrice(params.maxPrice, rateInfo.effectiveRate);
    }

    private humanizeRequestError(err: any) {
        const status = Number(err?.response?.status || 0);
        const raw = err?.response?.data ? textFromResponse(err.response.data) : String(err?.message || 'Provider request failed');
        const normalized = raw.toLowerCase();

        if (normalized.includes('insufficient') || normalized.includes('balance')) {
            return SERVER_EMPTY_WAIT_MESSAGE;
        }
        if (status === 401 || status === 403 || normalized.includes('invalid api key')) {
            return 'API key SMSBower tidak valid atau akses ditolak.';
        }
        return humanizeProviderOrderMessage(raw);
    }

    private errorSummary(err: any) {
        return {
            status: err.response?.status,
            data: err.response?.data,
            message: err.message,
        };
    }
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await fn();
        } catch (err: any) {
            lastError = err;
            if (!isRetryableNetworkError(err) || attempt === maxAttempts) {
                throw err;
            }

            const retryMs = attempt * 1500;
            logger.warn({ label, attempt, retryMs, code: err?.code, message: err?.message }, 'Retrying SmsBower request after transient network error');
            await sleep(retryMs);
        }
    }

    throw lastError;
}

function isRetryableNetworkError(err: any): boolean {
    const code = String(err?.code || err?.cause?.code || err?.errno || '').toUpperCase();
    if (RETRYABLE_NETWORK_CODES.has(code)) return true;

    const message = String(err?.message || '').toUpperCase();
    return message.includes('EAI_AGAIN') || message.includes('ETIMEDOUT') || message.includes('ECONNRESET');
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function humanizeProviderOrderMessage(message: string) {
    const normalized = String(message || '').toUpperCase();
    if (
        normalized.includes('NO_NUMBERS')
        || normalized.includes('NO NUMBER')
        || normalized.includes('NO_NUMBER')
        || normalized.includes('NO STOCK')
        || normalized.includes('NOT ENOUGH STOCK')
        || normalized.includes('OUT OF STOCK')
    ) {
        return SERVER_EMPTY_RESTOCK_MESSAGE;
    }
    if (
        normalized.includes('INSUFFICIENT')
        || normalized.includes('LOW BALANCE')
        || normalized.includes('NOT ENOUGH BALANCE')
        || normalized.includes('BALANCE')
    ) {
        return SERVER_EMPTY_WAIT_MESSAGE;
    }
    return message;
}

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
    if (!serviceCode) return null;

    if (Array.isArray(value)) {
        return {
            service_code: serviceCode,
            service_name: toStringValue(value[0]) ?? serviceCode,
            service_img: toStringValue(value[1] ?? value[2]) ?? undefined,
        };
    }

    if (isRecord(value)) {
        const serviceName = toStringValue(
            value.service_name ?? value.name ?? value.title ?? value.eng ?? value.en
        ) ?? serviceCode;

        return {
            service_code: serviceCode,
            service_name: serviceName,
            service_img: toStringValue(value.service_img ?? value.icon ?? value.img ?? value.image) ?? undefined,
        };
    }

    const serviceName = toStringValue(value);
    if (!serviceName) return null;

    return {
        service_code: serviceCode,
        service_name: serviceName,
    };
}

export const smsBowerProvider = new SmsBowerProvider();
