import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().default('8000').transform(Number),
    API_BASE_URL: z.string().url().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),

    RUMAHOTP_API_KEY: z.string().min(1, 'RUMAHOTP_API_KEY is required'),
    RUMAHOTP_BASE_URL: z.string().url().default('https://www.rumahotp.com/api'),

    QRIS_STATIC_STRING: z.string().min(1, 'QRIS_STATIC_STRING is required'),
    PAYMENT_WEBHOOK_SECRET: z.string().min(1, 'PAYMENT_WEBHOOK_SECRET is required'),

    ADMIN_API_KEY: z.string().min(1, 'ADMIN_API_KEY is required'),

    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').default('change_this_secret_in_production'),
    JWT_EXPIRES_IN: z.string().default('7d'),

    SELL_PRICE_MULTIPLIER: z.string().default('3.5').transform(Number),
    OTP_POLL_INTERVAL_MS: z.string().default('5000').transform(Number),
    OTP_POLL_MAX_MS: z.string().default('120000').transform(Number),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
