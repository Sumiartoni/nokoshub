import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../app/config';

export const WEB_AUTH_COOKIE_NAME = 'nokoshub_web_session';

export function getWebAuthToken(req: FastifyRequest): string | null {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[WEB_AUTH_COOKIE_NAME] || null;
}

export function setWebAuthCookie(reply: FastifyReply, token: string) {
    reply.header('Set-Cookie', serializeCookie(WEB_AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'Strict',
        path: '/',
        maxAge: parseDurationToSeconds(config.JWT_EXPIRES_IN),
    }));
}

export function clearWebAuthCookie(reply: FastifyReply) {
    reply.header('Set-Cookie', serializeCookie(WEB_AUTH_COOKIE_NAME, '', {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'Strict',
        path: '/',
        maxAge: 0,
    }));
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
