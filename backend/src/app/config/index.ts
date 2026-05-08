import { z } from 'zod';
import * as dotenv from 'dotenv';
import dns from 'node:dns';

dotenv.config();
dns.setDefaultResultOrder('ipv4first');

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().default('8000').transform(Number),
    API_BASE_URL: z.string().url().default('http://localhost:3000'),
    PUBLIC_API_BASE_URL: z.string().default(''),
    BACKEND_DASHBOARD_ENABLED: z.string().default('false').transform((value) => {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }),
    INTERNAL_API_SECRET: z.string().min(24, 'INTERNAL_API_SECRET must be at least 24 characters'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
    TELEGRAM_ADMIN_IDS: z.string().default(''),
    TELEGRAM_SUPPORT_HANDLE: z.string().default('@nokoshubsupport'),
    TELEGRAM_MAINTENANCE_NOTICE: z.string().default('Maintenance harian 23:00 WIB - 00:10 WIB. Hindari transaksi pada jam tersebut karena pesanan bisa tertunda atau gagal.'),
    TELEGRAM_FORCE_IPV4: z.string().default('true').transform((value) => {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }),
    TELEGRAM_POLLING_TIMEOUT_SECONDS: z.string().default('25').transform(Number),
    TELEGRAM_REQUEST_TIMEOUT_MS: z.string().default('35000').transform(Number),

    CS_TELEGRAM_BOT_TOKEN: z.string().default(''),
    CS_TELEGRAM_BOT_USERNAME: z.string().default(''),
    CS_TELEGRAM_ADMIN_IDS: z.string().default(''),
    CS_TELEGRAM_POLLING_TIMEOUT_SECONDS: z.string().default('25').transform(Number),
    CS_TELEGRAM_REQUEST_TIMEOUT_MS: z.string().default('35000').transform(Number),
    CS_BOT_SYSTEM_PROMPT: z.string().default(''),
    CS_BOT_MAX_HISTORY: z.string().default('12').transform(Number),

    OPENROUTER_API_KEY: z.string().default(''),
    OPENROUTER_MODEL: z.string().default('openai/gpt-oss-20b:free'),
    OPENROUTER_SITE_URL: z.string().default(''),
    OPENROUTER_SITE_NAME: z.string().default('NokosHUB CS Bot'),

    HERO_SMS_API_KEY: z.string().min(1, 'HERO_SMS_API_KEY is required'),
    HERO_SMS_BASE_URL: z.string().url().default('https://hero-sms.com/stubs/handler_api.php'),
    SMSBOWER_API_KEY: z.string().default(''),
    SMSBOWER_BASE_URL: z.string().url().default('https://smsbower.page/stubs/handler_api.php'),
    HERO_SMS_PRICE_TO_IDR_RATE: z.string().default('17000').transform(Number),
    USD_IDR_RATE_AUTO_ENABLED: z.string().default('true').transform((value) => {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }),
    USD_IDR_RATE_API_URL: z.string().url().default('https://api.frankfurter.dev/v2/rate/USD/IDR'),
    USD_IDR_RATE_BUFFER_PERCENT: z.string().default('0').transform(Number),
    USD_IDR_RATE_REFRESH_MINUTES: z.string().default('360').transform(Number),

    QRIS_STATIC_STRING: z.string().default(''),
    QRIS_DYNAMIC_ENABLED: z.string().default('true').transform((value) => {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }),
    PAYMENT_WEBHOOK_SECRET: z.string().default(''),
    BAYAR_GG_API_KEY: z.string().default(''),
    BAYAR_GG_WEBHOOK_SECRET: z.string().default(''),
    BAYAR_GG_PAYMENT_METHOD: z.string().default('qris'),
    BAYAR_GG_REDIRECT_URL: z.string().default(''),

    ADMIN_API_KEY: z.string().min(1, 'ADMIN_API_KEY is required'),
    BACKOFFICE_USERNAME: z.string().default('admin'),
    BACKOFFICE_PASSWORD_HASH: z.string().default(''),
    BACKOFFICE_SESSION_SECRET: z.string().min(24, 'BACKOFFICE_SESSION_SECRET must be at least 24 characters'),
    BACKOFFICE_SESSION_HOURS: z.string().default('8').transform(Number),
    BACKOFFICE_COOKIE_SECURE: z.string().default('false').transform((value) => {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }),
    CORS_ALLOWED_ORIGINS: z.string().default(''),
    GOOGLE_CLIENT_ID: z.string().default(''),
    EMAIL_TRANSPORT: z.enum(['', 'smtp', 'brevo_api']).default(''),
    EMAIL_FROM_NAME: z.string().default('NokosHUB'),
    EMAIL_FROM_EMAIL: z.string().default(''),
    BREVO_API_KEY: z.string().default(''),
    TURNSTILE_SITE_KEY: z.string().default(''),
    TURNSTILE_SECRET_KEY: z.string().default(''),
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: z.string().default('587').transform(Number),
    SMTP_SECURE: z.string().default('false').transform((value) => {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }),
    SMTP_USERNAME: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),

    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    JWT_EXPIRES_IN: z.string().default('7d'),

    SELL_PRICE_MULTIPLIER: z.string().default('3.5').transform(Number),
    PROVIDER_SYNC_ON_STARTUP: z.string().default('true').transform((value) => {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }),
    PROVIDER_SYNC_INTERVAL_MINUTES: z.string().default('360').transform(Number),
    PROVIDER_SYNC_STARTUP_DELAY_MS: z.string().default('30000').transform(Number),
    OTP_POLL_INTERVAL_MS: z.string().default('5000').transform(Number),
    OTP_POLL_MAX_MS: z.string().default('1200000').transform(Number),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
