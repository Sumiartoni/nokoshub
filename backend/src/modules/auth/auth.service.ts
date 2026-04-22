import crypto from 'crypto';
import { prisma } from '../../database/prisma.client';
import { config } from '../../app/config';
import { userService } from '../users/user.service';

const TOKEN_TTL_SECONDS = parseDurationToSeconds(config.JWT_EXPIRES_IN);
const LINK_CODE_TTL_MINUTES = 10;
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

let googleSigningCertCache:
    | {
        expiresAt: number;
        certs: Map<string, string>;
    }
    | undefined;

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
        if (!user?.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
            throw new Error('Email atau password tidak valid');
        }

        return { user: sanitizeWebUser(user), token: signToken(user.id, user.email) };
    },

    async loginWithGoogle(credential: string) {
        if (!config.GOOGLE_CLIENT_ID) {
            throw new Error('Login Google belum dikonfigurasi');
        }

        const googleUser = await verifyGoogleIdToken(credential);
        const email = normalizeEmail(googleUser.email);
        const profile = extractGoogleProfile(googleUser);

        const existingByGoogleId = await prisma.webUser.findUnique({
            where: { googleId: googleUser.sub },
        });

        if (existingByGoogleId) {
            const emailOwner = existingByGoogleId.email !== email
                ? await prisma.webUser.findUnique({ where: { email } })
                : null;

            if (emailOwner && emailOwner.id !== existingByGoogleId.id) {
                throw new Error('Email Google ini sudah digunakan akun lain');
            }

            const updated = await prisma.webUser.update({
                where: { id: existingByGoogleId.id },
                data: {
                    email,
                    firstName: profile.firstName ?? existingByGoogleId.firstName,
                    lastName: profile.lastName ?? existingByGoogleId.lastName,
                },
            });

            return { user: sanitizeWebUser(updated), token: signToken(updated.id, updated.email) };
        }

        const existingByEmail = await prisma.webUser.findUnique({ where: { email } });
        if (existingByEmail) {
            if (existingByEmail.googleId && existingByEmail.googleId !== googleUser.sub) {
                throw new Error('Email ini sudah terhubung ke akun Google lain');
            }

            const updated = await prisma.webUser.update({
                where: { id: existingByEmail.id },
                data: {
                    googleId: googleUser.sub,
                    firstName: existingByEmail.firstName ?? profile.firstName,
                    lastName: existingByEmail.lastName ?? profile.lastName,
                },
            });

            return { user: sanitizeWebUser(updated), token: signToken(updated.id, updated.email) };
        }

        const created = await prisma.webUser.create({
            data: {
                email,
                googleId: googleUser.sub,
                passwordHash: null,
                firstName: profile.firstName,
                lastName: profile.lastName,
            },
        });

        return { user: sanitizeWebUser(created), token: signToken(created.id, created.email) };
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

interface GoogleIdTokenPayload {
    sub: string;
    email: string;
    email_verified?: boolean | string;
    given_name?: string;
    family_name?: string;
    name?: string;
    aud?: string;
    iss?: string;
    exp?: number;
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenPayload> {
    const [encodedHeader, encodedPayload, encodedSignature] = idToken.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
        throw new Error('Credential Google tidak valid');
    }

    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as {
        alg?: string;
        kid?: string;
    };

    if (header.alg !== 'RS256' || !header.kid) {
        throw new Error('Header token Google tidak valid');
    }

    const certs = await getGoogleSigningCertificates();
    const certPem = certs.get(header.kid);
    if (!certPem) {
        throw new Error('Kunci verifikasi Google tidak ditemukan');
    }

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();

    const signature = Buffer.from(encodedSignature, 'base64url');
    const isValidSignature = verifier.verify(crypto.createPublicKey(certPem), signature);
    if (!isValidSignature) {
        throw new Error('Signature Google tidak valid');
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<GoogleIdTokenPayload>;
    if (!payload.sub || !payload.email) {
        throw new Error('Payload Google tidak lengkap');
    }

    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
        throw new Error('Token Google sudah expired');
    }

    if (payload.aud !== config.GOOGLE_CLIENT_ID) {
        throw new Error('Audience Google tidak cocok');
    }

    if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) {
        throw new Error('Issuer Google tidak valid');
    }

    if (!normalizeBoolean(payload.email_verified)) {
        throw new Error('Email Google belum terverifikasi');
    }

    return {
        sub: payload.sub,
        email: payload.email,
        email_verified: payload.email_verified,
        given_name: payload.given_name,
        family_name: payload.family_name,
        name: payload.name,
        aud: payload.aud,
        iss: payload.iss,
        exp: payload.exp,
    };
}

async function getGoogleSigningCertificates(): Promise<Map<string, string>> {
    if (googleSigningCertCache && googleSigningCertCache.expiresAt > Date.now()) {
        return googleSigningCertCache.certs;
    }

    const response = await fetch(GOOGLE_CERTS_URL);
    if (!response.ok) {
        throw new Error('Gagal mengambil sertifikat Google');
    }

    const cacheControl = response.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
    const maxAgeSeconds = Number(maxAgeMatch?.[1] || 3600);
    const body = await response.json() as {
        keys?: Array<{
            kid?: string;
            x5c?: string[];
        }>;
    };

    const certs = new Map<string, string>();
    for (const key of body.keys || []) {
        if (!key.kid || !key.x5c?.[0]) continue;
        certs.set(key.kid, toPemCertificate(key.x5c[0]));
    }

    if (!certs.size) {
        throw new Error('Sertifikat Google kosong');
    }

    googleSigningCertCache = {
        certs,
        expiresAt: Date.now() + maxAgeSeconds * 1000,
    };

    return certs;
}

function toPemCertificate(value: string) {
    const lines = value.match(/.{1,64}/g)?.join('\n') ?? value;
    return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`;
}

function normalizeBoolean(value: boolean | string | undefined) {
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
}

function extractGoogleProfile(payload: GoogleIdTokenPayload) {
    const firstName = payload.given_name?.trim();
    const lastName = payload.family_name?.trim();

    if (firstName || lastName) {
        return {
            firstName: firstName || undefined,
            lastName: lastName || undefined,
        };
    }

    const parts = (payload.name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return {
        firstName: parts.shift() || undefined,
        lastName: parts.join(' ') || undefined,
    };
}
