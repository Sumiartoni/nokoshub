import crypto from 'node:crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../app/config';

const COOKIE_NAME = 'nokos_backoffice_session';
const HASH_ALGORITHM = 'sha256';
const HASH_ITERATIONS = 210000;
const HASH_BYTES = 32;

export function hashBackofficePassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('base64url');
    const key = crypto
        .pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_BYTES, HASH_ALGORITHM)
        .toString('base64url');

    return `pbkdf2$${HASH_ALGORITHM}$${HASH_ITERATIONS}$${salt}$${key}`;
}

export function verifyBackofficePassword(password: string, storedHash: string): boolean {
    const [scheme, algorithm, iterationsRaw, salt, expectedKey] = storedHash.split('$');
    if (scheme !== 'pbkdf2' || algorithm !== HASH_ALGORITHM || !iterationsRaw || !salt || !expectedKey) {
        return false;
    }

    const iterations = Number(iterationsRaw);
    if (!Number.isInteger(iterations) || iterations < 100000) {
        return false;
    }

    const actualKey = crypto
        .pbkdf2Sync(password, salt, iterations, Buffer.from(expectedKey, 'base64url').length, algorithm)
        .toString('base64url');

    return safeEqual(actualKey, expectedKey);
}

export function createBackofficeSession(username: string): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: 'backoffice',
        username,
        iat: now,
        exp: now + config.BACKOFFICE_SESSION_HOURS * 60 * 60,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = sign(encodedPayload);

    return `${encodedPayload}.${signature}`;
}

export function getBackofficeSession(req: FastifyRequest): { username: string } | null {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_NAME];
    if (!token) return null;

    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature || !safeEqual(signature, sign(encodedPayload))) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
            sub?: string;
            username?: string;
            exp?: number;
        };

        if (payload.sub !== 'backoffice' || !payload.username || !payload.exp) return null;
        if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

        return { username: payload.username };
    } catch {
        return null;
    }
}

export function hasBackofficeSession(req: FastifyRequest): boolean {
    return Boolean(getBackofficeSession(req));
}

export function setBackofficeSessionCookie(reply: FastifyReply, token: string) {
    reply.header('Set-Cookie', serializeCookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: config.BACKOFFICE_COOKIE_SECURE,
        sameSite: 'Strict',
        path: '/',
        maxAge: config.BACKOFFICE_SESSION_HOURS * 60 * 60,
    }));
}

export function clearBackofficeSessionCookie(reply: FastifyReply) {
    reply.header('Set-Cookie', serializeCookie(COOKIE_NAME, '', {
        httpOnly: true,
        secure: config.BACKOFFICE_COOKIE_SECURE,
        sameSite: 'Strict',
        path: '/',
        maxAge: 0,
    }));
}

function sign(encodedPayload: string): string {
    return crypto
        .createHmac('sha256', config.BACKOFFICE_SESSION_SECRET || config.JWT_SECRET)
        .update(encodedPayload)
        .digest('base64url');
}

function parseCookies(cookieHeader?: string): Record<string, string> {
    if (!cookieHeader) return {};

    return cookieHeader.split(';').reduce<Record<string, string>>((acc, item) => {
        const [rawName, ...rawValue] = item.trim().split('=');
        if (!rawName) return acc;
        acc[rawName] = decodeURIComponent(rawValue.join('=') ?? '');
        return acc;
    }, {});
}

function serializeCookie(
    name: string,
    value: string,
    options: {
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'Strict' | 'Lax';
        path: string;
        maxAge: number;
    }
): string {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        `Max-Age=${options.maxAge}`,
        `Path=${options.path}`,
        `SameSite=${options.sameSite}`,
    ];

    if (options.httpOnly) parts.push('HttpOnly');
    if (options.secure) parts.push('Secure');

    return parts.join('; ');
}

function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}
