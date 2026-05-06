import { prisma } from '../../database/prisma.client';
import { config } from '../../app/config';

const CS_BOT_SETTINGS_KEY = 'cs_bot_settings';
const CACHE_TTL_MS = 30 * 1000;

export interface CsBotSettings {
    apiKey: string;
    model: string;
    siteUrl: string;
    siteName: string;
    knowledgePrompt: string;
}

const DEFAULT_CS_BOT_SETTINGS: CsBotSettings = {
    apiKey: '',
    model: 'openai/gpt-oss-20b:free',
    siteUrl: '',
    siteName: 'NokosHUB CS Bot',
    knowledgePrompt: '',
};

let runtimeCache:
    | {
        value: CsBotSettings;
        expiresAt: number;
    }
    | null = null;

export const csBotSettingsService = {
    async getSettings(): Promise<CsBotSettings> {
        const row = await prisma.appSetting.findUnique({
            where: { key: CS_BOT_SETTINGS_KEY },
        });

        if (!row?.value) {
            return mergeWithEnvDefaults({});
        }

        try {
            const parsed = JSON.parse(row.value) as Partial<CsBotSettings>;
            return mergeWithEnvDefaults(parsed);
        } catch {
            return mergeWithEnvDefaults({});
        }
    },

    async saveSettings(input: Partial<CsBotSettings>): Promise<CsBotSettings> {
        const current = await this.getSettings();
        const normalized = normalizeCsBotSettings({
            ...current,
            ...input,
            apiKey: typeof input.apiKey === 'string'
                ? (input.apiKey.trim() === '********' ? current.apiKey : input.apiKey)
                : current.apiKey,
        });

        await prisma.appSetting.upsert({
            where: { key: CS_BOT_SETTINGS_KEY },
            update: { value: JSON.stringify(normalized) },
            create: { key: CS_BOT_SETTINGS_KEY, value: JSON.stringify(normalized) },
        });

        runtimeCache = null;
        return normalized;
    },

    async getRuntimeSettings(): Promise<CsBotSettings> {
        if (runtimeCache && runtimeCache.expiresAt > Date.now()) {
            return runtimeCache.value;
        }

        const value = await this.getSettings();
        runtimeCache = {
            value,
            expiresAt: Date.now() + CACHE_TTL_MS,
        };
        return value;
    },
};

function mergeWithEnvDefaults(input: Partial<CsBotSettings>) {
    return normalizeCsBotSettings({
        apiKey: input.apiKey ?? config.OPENROUTER_API_KEY,
        model: input.model ?? config.OPENROUTER_MODEL,
        siteUrl: input.siteUrl ?? config.OPENROUTER_SITE_URL,
        siteName: input.siteName ?? config.OPENROUTER_SITE_NAME,
        knowledgePrompt: input.knowledgePrompt ?? config.CS_BOT_SYSTEM_PROMPT,
    });
}

function normalizeCsBotSettings(input: Partial<CsBotSettings>): CsBotSettings {
    return {
        apiKey: String(input.apiKey ?? DEFAULT_CS_BOT_SETTINGS.apiKey).trim(),
        model: String(input.model ?? DEFAULT_CS_BOT_SETTINGS.model).trim() || DEFAULT_CS_BOT_SETTINGS.model,
        siteUrl: String(input.siteUrl ?? DEFAULT_CS_BOT_SETTINGS.siteUrl).trim(),
        siteName: String(input.siteName ?? DEFAULT_CS_BOT_SETTINGS.siteName).trim() || DEFAULT_CS_BOT_SETTINGS.siteName,
        knowledgePrompt: String(input.knowledgePrompt ?? DEFAULT_CS_BOT_SETTINGS.knowledgePrompt).trim(),
    };
}
