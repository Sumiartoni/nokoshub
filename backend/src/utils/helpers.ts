import { z } from 'zod';

/**
 * Formats IDR currency for display in Telegram
 * Example: 3500 → "Rp3.500"
 */
export function formatRupiah(amount: number): string {
    return `Rp${amount.toLocaleString('id-ID')}`;
}

/**
 * Calculate sell price from provider price using 3.5x multiplier
 */
export function calculateSellPrice(providerPrice: number, multiplier = 3.5): number {
    return Math.ceil(providerPrice * multiplier);
}

/**
 * Parse telegramId from string to string (uniform handling)
 */
export function normalizeTelegramId(id: number | string): string {
    return String(id);
}

/**
 * Build a Zod schema for pagination query params
 */
export const paginationSchema = z.object({
    page: z
        .string()
        .optional()
        .default('1')
        .transform(Number)
        .pipe(z.number().int().min(1)),
    limit: z
        .string()
        .optional()
        .default('10')
        .transform(Number)
        .pipe(z.number().int().min(1).max(100)),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

/**
 * Sleep helper for polling
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
