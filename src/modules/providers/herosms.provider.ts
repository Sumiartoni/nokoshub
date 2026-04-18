import axios, { AxiosInstance } from 'axios';
import { config } from '../../app/config';
import logger from '../../utils/logger';

type AnyRecord = Record<string, any>;

export interface ProviderService {
    service_code: string;
    service_name: string;
    service_img?: string;
}

export interface ProviderPrice {
    price: number;
    provider_id: string;
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
const COLLECTION_META_KEYS = new Set([
    'success',
    'ok',
    'status',
    'message',
    'error',
    'errors',
    'balance',
    'data',
    'result',
    'response',
]);

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

function pick(source: AnyRecord | undefined, keys: string[]): unknown {
    if (!source) return undefined;
    for (const key of keys) {
        const value = source[key];
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return undefined;
}

function pickDeep(source: unknown, keys: string[]): unknown {
    const candidates = expandResponseCandidates(source);
    for (const candidate of candidates) {
        const value = pick(candidate, keys);
        if (value !== undefined) return value;
    }
    return undefined;
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

function expandResponseCandidates(source: unknown): AnyRecord[] {
    const candidates: AnyRecord[] = [];
    const queue: unknown[] = [source];

    while (queue.length) {
        const item = queue.shift();
        if (!isRecord(item)) continue;

        candidates.push(item);
        for (const key of ['data', 'result', 'response', 'order', 'sms']) {
            if (isRecord(item[key])) queue.push(item[key]);
        }
    }

    return candidates;
}

function collectionFrom(source: unknown, collectionKeys: string[]): AnyRecord[] {
    const queue: unknown[] = [source];

    while (queue.length) {
        const item = queue.shift();
        if (Array.isArray(item)) {
            return item.filter(isRecord);
        }

        if (!isRecord(item)) continue;

        for (const key of collectionKeys) {
            const nested = item[key];
            if (Array.isArray(nested)) {
                return nested.filter(isRecord);
            }
            if (isRecord(nested)) {
                return Object.entries(nested).map(([entryKey, value]) => {
                    return isRecord(value)
                        ? { _key: entryKey, ...value }
                        : { _key: entryKey, _value: value };
                });
            }
        }

        for (const key of ['data', 'result', 'response']) {
            if (item[key] !== undefined) queue.push(item[key]);
        }

        const entries = Object.entries(item)
            .filter(([key]) => !COLLECTION_META_KEYS.has(key))
            .map(([entryKey, value]) => {
                return isRecord(value)
                    ? { _key: entryKey, ...value }
                    : { _key: entryKey, _value: value };
            });

        if (entries.length) return entries;
    }

    return [];
}

function extractOtp(source: unknown): string | null {
    const explicit = toStringValue(pickDeep(source, ['sms_code', 'smsCode', 'code', 'otp', 'pin']));
    if (explicit) return explicit;

    const text = toStringValue(pickDeep(source, ['sms', 'message', 'text', 'body']));
    if (!text) return null;

    const match = text.match(/\b(\d{4,8})\b/);
    return match ? match[1] : text;
}

function normalizeProviderStatus(status: string | null, hasOtp: boolean): string {
    const normalized = (status ?? '').toLowerCase();
    if (hasOtp || ['done', 'completed', 'received', 'success', 'finished', 'ready'].includes(normalized)) {
        return 'completed';
    }
    if (['cancelled', 'canceled', 'expired', 'expiring', 'timeout', 'failed', 'refunded'].includes(normalized)) {
        return 'cancelled';
    }
    return normalized || 'waiting';
}

function responseSucceeded(source: unknown, fallback: boolean): boolean {
    const flag = pickDeep(source, ['success', 'ok']);
    if (typeof flag === 'boolean') return flag;
    if (typeof flag === 'number') return flag === 1;
    if (typeof flag === 'string') {
        return ['1', 'true', 'ok', 'success'].includes(flag.toLowerCase());
    }

    const status = toStringValue(pickDeep(source, ['status']));
    if (status) {
        return ['ok', 'success', 'completed', 'received', 'done'].includes(status.toLowerCase());
    }

    return fallback;
}

function responseMessage(source: unknown, fallback: string): string {
    return toStringValue(pickDeep(source, ['message', 'error', 'detail'])) ?? fallback;
}

class HeroSMSProvider {
    private client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: config.HERO_SMS_BASE_URL.replace(/\/+$/, ''),
            timeout: 15000,
            headers: {
                Authorization: `Bearer ${config.HERO_SMS_API_KEY}`,
                'X-API-Key': config.HERO_SMS_API_KEY,
                Accept: 'application/json',
            },
        });
    }

    async getServices(): Promise<ProviderService[]> {
        try {
            const res = await this.client.get('/services', {
                params: this.withApiKey(),
            });

            const services = collectionFrom(res.data, ['services', 'items', 'data'])
                .map((item): ProviderService | null => {
                    const serviceCode = toStringValue(
                        pick(item, ['service_code', 'service', 'code', 'id', 'slug']) ?? item._key
                    );
                    const serviceName = toStringValue(
                        pick(item, ['service_name', 'name', 'title', 'label']) ?? item._value ?? serviceCode
                    );
                    const serviceImg = toStringValue(pick(item, ['service_img', 'image', 'icon', 'logo'])) ?? undefined;

                    if (!serviceCode || !serviceName) return null;
                    return {
                        service_code: serviceCode,
                        service_name: serviceName,
                        ...(serviceImg ? { service_img: serviceImg } : {}),
                    };
                })
                .filter((item): item is ProviderService => Boolean(item));

            if (!services.length) {
                logger.warn({ body: res.data }, 'No HeroSMS services returned');
            }

            return services;
        } catch (err) {
            logger.error({ err }, 'HeroSMS getServices failed');
            return [];
        }
    }

    async getCountries(serviceId: string | number): Promise<ProviderCountry[]> {
        const serviceCode = String(serviceId);
        const attempts = [
            { path: '/countries', params: { service: serviceCode } },
            { path: '/countries', params: { service_id: serviceCode } },
            { path: `/services/${encodeURIComponent(serviceCode)}/countries`, params: {} },
        ];

        for (const attempt of attempts) {
            try {
                const res = await this.client.get(attempt.path, {
                    params: this.withApiKey(attempt.params),
                });
                const countries = this.normalizeCountries(res.data, serviceCode);
                if (countries.length) return countries;
            } catch (err) {
                logger.warn({ err, serviceCode, path: attempt.path }, 'HeroSMS getCountries attempt failed');
            }
        }

        logger.warn({ serviceCode }, 'No HeroSMS countries returned');
        return [];
    }

    async orderNumber(params: ProviderOrderParams): Promise<ProviderOrderResult> {
        try {
            const payload: AnyRecord = {
                service: params.serviceCode,
                country: params.countryCode,
            };

            if (params.providerId && params.providerId !== 'default') {
                payload.provider_id = params.providerId;
            }
            if (params.maxPrice) {
                payload.max_price = params.maxPrice;
            }

            const res = await this.client.post('/number/order', this.withApiKey(payload));
            const orderId = toStringValue(
                pickDeep(res.data, ['order_id', 'orderId', 'activation_id', 'activationId', 'request_id', 'id'])
            );
            const phoneNumber = toStringValue(
                pickDeep(res.data, ['phone_number', 'phoneNumber', 'number', 'phone', 'msisdn'])
            );

            const success = responseSucceeded(res.data, Boolean(orderId && phoneNumber));
            return {
                success,
                order_id: orderId,
                phone_number: phoneNumber,
                message: responseMessage(res.data, success ? 'Order created' : 'Order failed'),
            };
        } catch (err: any) {
            logger.error({ err: err.response?.data ?? err }, 'HeroSMS orderNumber failed');
            return {
                success: false,
                order_id: null,
                phone_number: null,
                message: err.response?.data?.message ?? err.message,
            };
        }
    }

    async checkStatus(orderId: string): Promise<ProviderStatusResult> {
        try {
            const res = await this.client.get('/sms/check', {
                params: this.withApiKey({ order_id: orderId }),
            });

            const smsCode = extractOtp(res.data);
            const phoneNumber = toStringValue(
                pickDeep(res.data, ['phone_number', 'phoneNumber', 'number', 'phone', 'msisdn'])
            );
            const rawStatus = toStringValue(pickDeep(res.data, ['status', 'state']));
            const status = normalizeProviderStatus(rawStatus, Boolean(smsCode));

            return {
                success: status === 'completed' && Boolean(smsCode),
                status,
                sms_code: smsCode,
                phone_number: phoneNumber,
                message: responseMessage(res.data, status),
            };
        } catch (err: any) {
            logger.error({ err: err.response?.data ?? err, orderId }, 'HeroSMS checkStatus failed');
            return { success: false, status: 'error', sms_code: null, phone_number: null, message: err.message };
        }
    }

    async getBalance(): Promise<number> {
        try {
            const res = await this.client.get('/balance', {
                params: this.withApiKey(),
            });
            return toNumberValue(pickDeep(res.data, ['balance', 'amount', 'value'])) ?? 0;
        } catch (err) {
            logger.error({ err }, 'HeroSMS getBalance failed');
            return 0;
        }
    }

    private normalizeCountries(body: unknown, serviceCode: string): ProviderCountry[] {
        return collectionFrom(body, ['countries', 'items', 'data'])
            .map((item): ProviderCountry | null => {
                const numberId = toStringValue(
                    pick(item, ['number_id', 'country_id', 'country', 'id', 'code', 'iso_code', 'iso']) ?? item._key
                );
                const name = toStringValue(
                    pick(item, ['name', 'country_name', 'title', 'label']) ?? item._value ?? numberId
                );

                if (!numberId || !name) return null;

                return {
                    number_id: numberId,
                    name,
                    ...(toStringValue(pick(item, ['iso_code', 'iso']))
                        ? { iso_code: toStringValue(pick(item, ['iso_code', 'iso']))! }
                        : {}),
                    pricelist: this.normalizePrices(item, serviceCode),
                };
            })
            .filter((item): item is ProviderCountry => Boolean(item && item.pricelist.length));
    }

    private normalizePrices(country: AnyRecord, serviceCode: string): ProviderPrice[] {
        const explicitPrices = pick(country, ['pricelist', 'prices', 'price_list', 'tariffs', 'providers', 'operators']);
        const rawPrices = this.priceCollectionFrom(explicitPrices, serviceCode);

        if (!rawPrices.length) {
            const price = toNumberValue(pick(country, ['price', 'cost', 'rate', 'amount', 'value']) ?? country._value);
            if (price === null) return [];
            rawPrices.push({ ...country, price });
        }

        return rawPrices
            .map((priceItem) => {
                const rawPrice = toNumberValue(
                    pick(priceItem, ['price', 'cost', 'rate', 'amount', 'value']) ?? priceItem._value
                );
                if (rawPrice === null || rawPrice <= 0) return null;

                const fallbackProviderId =
                    priceItem._key && priceItem._key !== serviceCode ? String(priceItem._key) : 'default';
                const providerId = toStringValue(
                    pick(priceItem, ['provider_id', 'provider', 'operator_id', 'operator', 'id', 'code']) ??
                    fallbackProviderId
                ) ?? 'default';

                return {
                    price: this.toIdrPrice(rawPrice),
                    provider_id: providerId,
                };
            })
            .filter((item): item is ProviderPrice => Boolean(item));
    }

    private priceCollectionFrom(source: unknown, serviceCode: string): AnyRecord[] {
        if (Array.isArray(source)) return source.filter(isRecord);
        if (!isRecord(source)) return [];

        const directForService = source[serviceCode];
        if (directForService !== undefined) {
            return isRecord(directForService)
                ? [{ _key: 'default', ...directForService }]
                : [{ _key: 'default', _value: directForService }];
        }

        return Object.entries(source).map(([entryKey, value]) => {
            return isRecord(value)
                ? { _key: entryKey, ...value }
                : { _key: entryKey, _value: value };
        });
    }

    private toIdrPrice(price: number): number {
        if (price >= 1000) return Math.ceil(price);
        return Math.ceil(price * config.HERO_SMS_PRICE_TO_IDR_RATE);
    }

    private withApiKey(params: AnyRecord = {}): AnyRecord {
        return { api_key: config.HERO_SMS_API_KEY, ...params };
    }
}

export const heroSMSProvider = new HeroSMSProvider();
