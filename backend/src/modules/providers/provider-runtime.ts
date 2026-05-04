import {
    buildHeroSMSPriceId,
    heroSMSProvider,
    parseHeroSMSPriceId,
    type ProviderCountry,
    type ProviderOrderParams,
    type ProviderOrderResult,
    type ProviderService,
    type ProviderStatusResult,
} from './herosms.provider';
import {
    buildSmsBowerPriceId,
    parseSmsBowerPriceId,
    smsBowerProvider,
} from './smsbower.provider';
import { getProviderDescriptor, parseProviderKeyFromPriceId, type OtpProviderKey } from './provider-registry';

export interface OtpProviderAdapter {
    isConfigured(): boolean;
    getServices(): Promise<ProviderService[]>;
    getCountries(serviceId: string | number): Promise<ProviderCountry[]>;
    orderNumber(params: ProviderOrderParams): Promise<ProviderOrderResult>;
    checkStatus(orderId: string): Promise<ProviderStatusResult>;
    finishActivation(orderId: string): Promise<void>;
    markActivationReady(orderId: string): Promise<void>;
    cancelActivation(orderId: string): Promise<void>;
    getBalance(): Promise<number>;
}

export interface ParsedProviderPriceParts {
    serviceCode: string;
    countryCode: string;
    providerId: string;
}

export interface ResolvedProviderRuntime {
    providerKey: OtpProviderKey;
    providerLabel: string;
    serverLabel: string;
    provider: OtpProviderAdapter;
    parsedPrice: ParsedProviderPriceParts;
}

export interface ProviderBalanceSnapshot {
    providerKey: OtpProviderKey;
    providerLabel: string;
    serverLabel: string;
    balanceUsd: number;
}

const PROVIDER_ADAPTERS: Record<OtpProviderKey, OtpProviderAdapter> = {
    server1: smsBowerProvider,
    herosms: heroSMSProvider,
};

export function getOtpProvider(providerKey: OtpProviderKey): OtpProviderAdapter {
    return PROVIDER_ADAPTERS[providerKey];
}

export function getConfiguredOtpProviders() {
    return (Object.entries(PROVIDER_ADAPTERS) as [OtpProviderKey, OtpProviderAdapter][])
        .filter(([, provider]) => provider.isConfigured())
        .map(([providerKey, provider]) => ({
            providerKey,
            provider,
            descriptor: getProviderDescriptor(providerKey),
        }))
        .sort((a, b) => a.descriptor.sortOrder - b.descriptor.sortOrder);
}

export function resolveProviderRuntimeFromPriceId(priceId: string): ResolvedProviderRuntime | null {
    const providerKey = parseProviderKeyFromPriceId(priceId) as OtpProviderKey;
    const provider = PROVIDER_ADAPTERS[providerKey];
    if (!provider) return null;

    let parsedPrice: ParsedProviderPriceParts | null = null;
    if (providerKey === 'server1') {
        parsedPrice = parseSmsBowerPriceId(priceId);
    } else if (providerKey === 'herosms') {
        parsedPrice = parseHeroSMSPriceId(priceId);
    }

    if (!parsedPrice) return null;

    const descriptor = getProviderDescriptor(providerKey);
    return {
        providerKey,
        providerLabel: descriptor.displayName,
        serverLabel: descriptor.serverLabel,
        provider,
        parsedPrice,
    };
}

export function buildProviderPriceId(
    providerKey: OtpProviderKey,
    serviceCode: string,
    countryCode: string,
    providerId: string
) {
    if (providerKey === 'server1') {
        return buildSmsBowerPriceId(serviceCode, countryCode, providerId);
    }

    return buildHeroSMSPriceId(serviceCode, countryCode, providerId);
}

export async function getConfiguredProviderBalances(): Promise<ProviderBalanceSnapshot[]> {
    const providers = getConfiguredOtpProviders();
    const balances = await Promise.all(
        providers.map(async ({ providerKey, provider, descriptor }) => ({
            providerKey,
            providerLabel: descriptor.displayName,
            serverLabel: descriptor.serverLabel,
            balanceUsd: await provider.getBalance(),
        }))
    );

    return balances.sort((a, b) => getProviderDescriptor(a.providerKey).sortOrder - getProviderDescriptor(b.providerKey).sortOrder);
}
