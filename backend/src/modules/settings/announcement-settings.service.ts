import { prisma } from '../../database/prisma.client';

const ANNOUNCEMENT_SETTINGS_KEY = 'announcement_settings';
const CACHE_TTL_MS = 30 * 1000;

export interface AnnouncementSettings {
    enabled: boolean;
    title: string;
    message: string;
}

const DEFAULT_ANNOUNCEMENT_SETTINGS: AnnouncementSettings = {
    enabled: false,
    title: 'Pengumuman NokosHUB',
    message: 'Saat ini belum ada pengumuman baru.',
};

let runtimeCache:
    | {
        value: AnnouncementSettings;
        expiresAt: number;
    }
    | null = null;

export const announcementSettingsService = {
    async getSettings(): Promise<AnnouncementSettings> {
        const row = await prisma.appSetting.findUnique({
            where: { key: ANNOUNCEMENT_SETTINGS_KEY },
        });

        if (!row?.value) {
            return normalizeAnnouncementSettings({});
        }

        try {
            const parsed = JSON.parse(row.value) as Partial<AnnouncementSettings>;
            return normalizeAnnouncementSettings(parsed);
        } catch {
            return normalizeAnnouncementSettings({});
        }
    },

    async saveSettings(input: Partial<AnnouncementSettings>): Promise<AnnouncementSettings> {
        const current = await this.getSettings();
        const normalized = normalizeAnnouncementSettings({
            ...current,
            ...input,
        });

        await prisma.appSetting.upsert({
            where: { key: ANNOUNCEMENT_SETTINGS_KEY },
            update: { value: JSON.stringify(normalized) },
            create: { key: ANNOUNCEMENT_SETTINGS_KEY, value: JSON.stringify(normalized) },
        });

        runtimeCache = null;
        return normalized;
    },

    async getRuntimeSettings(): Promise<AnnouncementSettings> {
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

function normalizeAnnouncementSettings(input: Partial<AnnouncementSettings>): AnnouncementSettings {
    return {
        enabled: Boolean(input.enabled),
        title: String(input.title ?? DEFAULT_ANNOUNCEMENT_SETTINGS.title).trim() || DEFAULT_ANNOUNCEMENT_SETTINGS.title,
        message: String(input.message ?? DEFAULT_ANNOUNCEMENT_SETTINGS.message).trim() || DEFAULT_ANNOUNCEMENT_SETTINGS.message,
    };
}
