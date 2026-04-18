import crypto from 'crypto';
import { prisma } from '../../database/prisma.client';
import { config } from '../../app/config';
import { userService } from '../users/user.service';

const TOKEN_TTL_SECONDS = parseDurationToSeconds(config.JWT_EXPIRES_IN);
const LINK_CODE_TTL_MINUTES = 10;

export interface AuthTokenPayload {
    sub: string;
    email: string;
    exp: number;
}

export const authService = {
    async register(input: { email: string; password: string; firstName?: string; lastName?: string }) {
        const email = normalizeEmail(input.email);
        const existing = await prisma.webUser.findUnique({ where: { email } });
        if (existing) throw new Error('Email sudah terdaftar');

        const passwordHash = hashPassword(input.password);
        const user = await prisma.webUser.create({
            data: {
                email,
                passwordHash,
                firstName: input.firstName,
                lastName: input.lastName,
            },
        });

        return { user: sanitizeWebUser(user), token: signToken(user.id, user.email) };
    },

    async login(input: { email: string; password: string }) {
        const email = normalizeEmail(input.email);
        const user = await prisma.webUser.findUnique({ where: { email } });
        if (!user || !verifyPassword(input.password, user.passwordHash)) {
            throw new Error('Email atau password tidak valid');
        }

        return { user: sanitizeWebUser(user), token: signToken(user.id, user.email) };
    },

    async getUserFromAuthHeader(authHeader?: string) {
        const token = extractBearerToken(authHeader);
        if (!token) return null;
        const payload = verifyToken(token);
        const user = await prisma.webUser.findUnique({ where: { id: payload.sub } });
        return user ? sanitizeWebUser(user) : null;
    },

    async requireUser(authHeader?: string) {
        const user = await authService.getUserFromAuthHeader(authHeader);
        if (!user) throw new Error('Unauthorized');
        return user;
    },

    async createTelegramLinkCode(webUserId: string) {
        const user = await prisma.webUser.findUnique({ where: { id: webUserId } });
        if (!user) throw new Error('User tidak ditemukan');
        if (user.telegramId) throw new Error('Akun Telegram sudah tertaut');

        await prisma.webTelegramLinkCode.updateMany({
            where: { webUserId, consumedAt: null },
            data: { consumedAt: new Date() },
        });

        const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000);
        let code = '';

        for (let attempt = 0; attempt < 8; attempt += 1) {
            code = generateCode();
            try {
                await prisma.webTelegramLinkCode.create({
                    data: { webUserId, code, expiresAt },
                });
                return { code, expiresAt };
            } catch {
                // Retry when a rare unique code collision happens.
            }
        }

        throw new Error('Gagal membuat kode link. Coba lagi.');
    },

    async confirmTelegramLink(input: {
        code: string;
        telegramId: string;
        username?: string;
        firstName?: string;
        lastName?: string;
    }) {
        const code = normalizeCode(input.code);
        const link = await prisma.webTelegramLinkCode.findUnique({
            where: { code },
            include: { webUser: true },
        });

        if (!link || link.consumedAt) throw new Error('Kode link tidak valid atau sudah dipakai');
        if (link.expiresAt.getTime() < Date.now()) throw new Error('Kode link sudah kadaluarsa');
        if (link.webUser.telegramId) throw new Error('Akun web ini sudah tertaut ke Telegram');

        const linkedToOther = await prisma.webUser.findUnique({
            where: { telegramId: input.telegramId },
        });
        if (linkedToOther && linkedToOther.id !== link.webUserId) {
            throw new Error('Telegram ini sudah tertaut ke akun web lain');
        }

        await userService.findOrCreate(input.telegramId, {
            username: input.username,
            firstName: input.firstName,
            lastName: input.lastName,
        });

        const webUser = await prisma.$transaction(async (tx) => {
            await tx.webTelegramLinkCode.update({
                where: { id: link.id },
                data: { consumedAt: new Date() },
            });

            return tx.webUser.update({
                where: { id: link.webUserId },
                data: { telegramId: input.telegramId },
            });
        });

        return sanitizeWebUser(webUser);
    },

    verifyToken,
};

export function sanitizeWebUser(user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    telegramId: string | null;
    createdAt: Date;
}) {
    return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        telegramId: user.telegramId,
        telegramLinked: Boolean(user.telegramId),
        createdAt: user.createdAt,
    };
}

function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

function normalizeCode(code: string) {
    return code.replace(/[^\d]/g, '').slice(0, 6);
}

function generateCode() {
    return String(crypto.randomInt(100000, 1000000));
}

function hashPassword(password: string) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string) {
    const [scheme, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;

    const computed = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === computed.length && crypto.timingSafeEqual(expected, computed);
}

function signToken(userId: string, email: string) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: AuthTokenPayload = {
        sub: userId,
        email,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    };

    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const signature = sign(`${encodedHeader}.${encodedPayload}`);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyToken(token: string): AuthTokenPayload {
    const [encodedHeader, encodedPayload, signature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !signature) throw new Error('Invalid token');

    const expected = sign(`${encodedHeader}.${encodedPayload}`);
    if (!safeEqual(signature, expected)) throw new Error('Invalid token signature');

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!payload.sub || !payload.email || !payload.exp) throw new Error('Invalid token payload');
    if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return payload;
}

function extractBearerToken(authHeader?: string) {
    const match = authHeader?.match(/^Bearer\s+(.+)$/i);
    return match?.[1] ?? null;
}

function sign(value: string) {
    return crypto.createHmac('sha256', config.JWT_SECRET).update(value).digest('base64url');
}

function base64url(value: string) {
    return Buffer.from(value).toString('base64url');
}

function safeEqual(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseDurationToSeconds(value: string) {
    const match = value.match(/^(\d+)([smhd])?$/i);
    if (!match) return 7 * 24 * 60 * 60;

    const amount = Number(match[1]);
    const unit = (match[2] || 's').toLowerCase();
    const multipliers: Record<string, number> = {
        s: 1,
        m: 60,
        h: 60 * 60,
        d: 24 * 60 * 60,
    };
    return amount * multipliers[unit];
}
