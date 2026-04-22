import { prisma } from '../../database/prisma.client';

const SMTP_SETTINGS_KEY = 'smtp_settings';

export type EmailTransport = 'smtp' | 'brevo_api';

export interface SmtpSettings {
    transport: EmailTransport;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    apiKey: string;
    fromName: string;
    fromEmail: string;
}

const DEFAULT_SMTP_SETTINGS: SmtpSettings = {
    transport: 'smtp',
    host: '',
    port: 587,
    secure: false,
    username: '',
    password: '',
    apiKey: '',
    fromName: 'NokosHUB',
    fromEmail: '',
};

export const smtpSettingsService = {
    async getSettings(): Promise<SmtpSettings> {
        const row = await prisma.appSetting.findUnique({
            where: { key: SMTP_SETTINGS_KEY },
        });

        if (!row?.value) {
            return { ...DEFAULT_SMTP_SETTINGS };
        }

        try {
            const parsed = JSON.parse(row.value) as Partial<SmtpSettings>;
            return normalizeSmtpSettings(parsed);
        } catch {
            return { ...DEFAULT_SMTP_SETTINGS };
        }
    },

    async saveSettings(input: Partial<SmtpSettings>): Promise<SmtpSettings> {
        const normalized = normalizeSmtpSettings(input);
        await prisma.appSetting.upsert({
            where: { key: SMTP_SETTINGS_KEY },
            update: { value: JSON.stringify(normalized) },
            create: { key: SMTP_SETTINGS_KEY, value: JSON.stringify(normalized) },
        });

        return normalized;
    },

    async requireSettings(): Promise<SmtpSettings> {
        const settings = await this.getSettings();
        if (!settings.fromEmail) {
            throw new Error('Email pengirim belum dikonfigurasi di panel super admin');
        }

        if (settings.transport === 'brevo_api') {
            if (!settings.apiKey) {
                throw new Error('Brevo API key belum dikonfigurasi di panel super admin');
            }
            return settings;
        }

        if (!settings.host || !settings.port || !settings.username || !settings.password) {
            throw new Error('SMTP belum dikonfigurasi di panel super admin');
        }
        return settings;
    },
};

function normalizeSmtpSettings(input: Partial<SmtpSettings>): SmtpSettings {
    const port = Number(input.port ?? DEFAULT_SMTP_SETTINGS.port);

    return {
        transport: input.transport === 'brevo_api' ? 'brevo_api' : DEFAULT_SMTP_SETTINGS.transport,
        host: String(input.host ?? DEFAULT_SMTP_SETTINGS.host).trim(),
        port: Number.isFinite(port) && port > 0 ? Math.trunc(port) : DEFAULT_SMTP_SETTINGS.port,
        secure: Boolean(input.secure),
        username: String(input.username ?? DEFAULT_SMTP_SETTINGS.username).trim(),
        password: String(input.password ?? DEFAULT_SMTP_SETTINGS.password),
        apiKey: String(input.apiKey ?? DEFAULT_SMTP_SETTINGS.apiKey).trim(),
        fromName: String(input.fromName ?? DEFAULT_SMTP_SETTINGS.fromName).trim() || DEFAULT_SMTP_SETTINGS.fromName,
        fromEmail: String(input.fromEmail ?? DEFAULT_SMTP_SETTINGS.fromEmail).trim().toLowerCase(),
    };
}
