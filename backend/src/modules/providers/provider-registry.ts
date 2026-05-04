export type OtpProviderKey = 'herosms' | 'server1';

export interface ProviderDescriptor {
    key: OtpProviderKey | string;
    displayName: string;
    serverLabel: string;
    sortOrder: number;
}

const PROVIDERS: Record<string, ProviderDescriptor> = {
    server1: {
        key: 'server1',
        displayName: 'Server 1',
        serverLabel: 'Server 1',
        sortOrder: 1,
    },
    herosms: {
        key: 'herosms',
        displayName: 'HeroSMS',
        serverLabel: 'Server 2',
        sortOrder: 2,
    },
};

export function getProviderDescriptor(key?: string | null): ProviderDescriptor {
    if (key && PROVIDERS[key]) {
        return PROVIDERS[key];
    }

    const normalizedKey = String(key || '').trim().toLowerCase();
    if (normalizedKey && PROVIDERS[normalizedKey]) {
        return PROVIDERS[normalizedKey];
    }

    return {
        key: normalizedKey || 'unknown',
        displayName: normalizedKey || 'Unknown Provider',
        serverLabel: 'Server',
        sortOrder: 99,
    };
}

export function parseProviderKeyFromPriceId(priceId: string) {
    const [providerKey] = String(priceId || '').split(':');
    return providerKey ? providerKey.trim().toLowerCase() : '';
}
