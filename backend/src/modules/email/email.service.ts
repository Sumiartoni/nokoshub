import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import { smtpSettingsService } from '../settings/smtp-settings.service';
import { config } from '../../app/config';
import logger from '../../utils/logger';

interface EmailPayload {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

const SMTP_CONNECT_TIMEOUT_MS = 10000;
const SMTP_RESPONSE_TIMEOUT_MS = 15000;
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_TIMEOUT_MS = 15000;
const WEBSITE_URL = 'https://nokoshub.store';
const WEBSITE_LABEL = 'nokoshub.store';
const EMAIL_LOGO_URL = `${WEBSITE_URL}/user/assets/images/logo-email.png`;
const WEBSITE_TOPUP_URL = `${WEBSITE_URL}/user/#topup`;

export const emailService = {
    async sendRegistrationOtp(input: {
        to: string;
        otpCode: string;
        expiresAt: Date;
        recipientName?: string;
    }) {
        const minutes = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 60000));
        const escapedOtp = escapeHtml(input.otpCode);
        const escapedName = escapeHtml(input.recipientName || 'Pengguna');
        const subject = `Verifikasi Email NokosHUB - Kode OTP ${input.otpCode}`;

        return this.sendEmail({
            to: input.to,
            subject,
            text: [
                'NokosHUB',
                '',
                `Halo ${input.recipientName || 'Pengguna'},`,
                '',
                'Terima kasih sudah memulai pendaftaran akun di NokosHUB.',
                '',
                'Gunakan kode OTP berikut untuk memverifikasi email Anda:',
                '',
                `${input.otpCode}`,
                '',
                `Kode ini berlaku sekitar ${minutes} menit.`,
                'Demi keamanan akun, jangan bagikan kode ini kepada siapa pun.',
                '',
                'Jika Anda tidak merasa melakukan pendaftaran, abaikan email ini.',
                '',
                `Website: ${WEBSITE_URL}`,
                'Email ini dikirim otomatis oleh sistem NokosHUB.',
            ].join('\n'),
            html: renderBrandedEmail({
                eyebrow: 'Verifikasi Email',
                title: 'Satu langkah lagi untuk aktivasi akun Anda',
                introHtml: `<p style="margin:0 0 14px;font-size:15px;line-height:1.8">Halo <strong>${escapedName}</strong>,</p>
                  <p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#334155">
                    Gunakan kode OTP berikut untuk memverifikasi email Anda dan melanjutkan pembuatan akun NokosHUB.
                  </p>`,
                contentHtml: `
                  <div style="margin:0 0 20px;padding:18px;border-radius:18px;background:#eef9ff;border:1px solid #bfe7f8;text-align:center">
                    <div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#0d7490;margin-bottom:10px">Kode OTP Anda</div>
                    <div style="font-size:34px;line-height:1;font-weight:700;letter-spacing:8px;color:#0f3f73">${escapedOtp}</div>
                  </div>

                  <div style="margin:0 0 18px;padding:16px 18px;border-radius:16px;background:#f8fbff;border:1px solid #d9e9f7">
                    <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#334155">
                      Kode ini berlaku sekitar <strong>${minutes} menit</strong>.
                    </p>
                    <p style="margin:0;font-size:14px;line-height:1.7;color:#334155">
                      Demi keamanan akun, jangan bagikan kode ini kepada siapa pun.
                    </p>
                  </div>

                  <p style="margin:0;font-size:14px;line-height:1.8;color:#475569">
                    Jika Anda tidak merasa melakukan pendaftaran, abaikan email ini. Tidak ada perubahan apa pun pada akun Anda sampai kode diverifikasi.
                  </p>
                `,
                ctaLabel: 'Buka Website NokosHUB',
                ctaUrl: WEBSITE_URL,
                footerHtml: `
                  <p style="margin:0 0 6px;font-size:13px;line-height:1.7;color:#64748b">
                    Website: <a href="${WEBSITE_URL}" style="color:#0f6db5;text-decoration:none">${WEBSITE_LABEL}</a>
                  </p>
                  <p style="margin:0;font-size:12px;line-height:1.7;color:#94a3b8">
                    Email ini dikirim otomatis oleh sistem NokosHUB.
                  </p>
                `,
            }),
        });
    },

    async sendSmtpTestEmail(to: string) {
        return this.sendEmail({
            to,
            subject: 'Tes SMTP NokosHUB berhasil',
            text: 'Jika Anda menerima email ini, konfigurasi SMTP pada panel super admin NokosHUB sudah aktif.',
            html: renderBrandedEmail({
                eyebrow: 'Tes Konfigurasi',
                title: 'Koneksi email NokosHUB berhasil',
                introHtml: `<p style="margin:0;font-size:15px;line-height:1.8;color:#334155">Jika Anda menerima email ini, konfigurasi SMTP pada panel super admin NokosHUB sudah aktif dan siap dipakai.</p>`,
                contentHtml: `
                  <div style="padding:16px 18px;border-radius:16px;background:#f4fcf7;border:1px solid #c6efd4;color:#166534">
                    <strong>SMTP aktif ✅</strong><br>
                    Pengiriman email dari sistem NokosHUB sudah berhasil diuji.
                  </div>
                `,
                ctaLabel: 'Buka Website NokosHUB',
                ctaUrl: WEBSITE_URL,
                footerHtml: `
                  <p style="margin:0;font-size:12px;line-height:1.7;color:#94a3b8">
                    Email test ini dikirim dari panel super admin NokosHUB.
                  </p>
                `,
            }),
        });
    },

    async sendEmail(payload: EmailPayload) {
        const settings = await smtpSettingsService.requireSettings();
        logger.info(
            {
                transport: settings.transport,
                smtpHost: settings.host,
                smtpPort: settings.port,
                secure: settings.secure,
                fromEmail: settings.fromEmail,
                to: payload.to,
                subject: payload.subject,
            },
            'Sending email via SMTP'
        );

        try {
            if (settings.transport === 'brevo_api') {
                await sendBrevoApiMail(settings, payload);
            } else {
                await sendSmtpMail(settings, payload);
            }
            logger.info(
                {
                    transport: settings.transport,
                    smtpHost: settings.host,
                    fromEmail: settings.fromEmail,
                    to: payload.to,
                    subject: payload.subject,
                },
                'SMTP accepted email'
            );
        } catch (err) {
            logger.error(
                {
                    err,
                    transport: settings.transport,
                    smtpHost: settings.host,
                    smtpPort: settings.port,
                    secure: settings.secure,
                    fromEmail: settings.fromEmail,
                    to: payload.to,
                    subject: payload.subject,
                },
                'SMTP send failed'
            );
            throw err;
        }
    },
};

export function renderBrandedEmail(input: {
    eyebrow: string;
    title: string;
    introHtml?: string;
    contentHtml: string;
    ctaLabel?: string;
    ctaUrl?: string;
    footerHtml?: string;
    variant?: 'brand' | 'neutral';
}) {
    const supportHandle = normalizeSupportHandle(config.CS_TELEGRAM_BOT_USERNAME || config.TELEGRAM_SUPPORT_HANDLE);
    const supportUrl = buildTelegramUrl(supportHandle);
    const variant = input.variant || 'brand';
    const isNeutral = variant === 'neutral';
    const ctaHtml = input.ctaLabel && input.ctaUrl
        ? `
            <div style="margin-top:24px;text-align:center">
              <a href="${escapeHtmlAttr(input.ctaUrl)}" style="display:inline-block;padding:13px 24px;border-radius:${isNeutral ? '14px' : '999px'};background:${isNeutral ? '#ffffff' : 'linear-gradient(135deg,#1aa0e8 0%,#38d6d1 100%)'};color:${isNeutral ? '#0f3f73' : '#ffffff'};font-size:14px;font-weight:700;text-decoration:none;${isNeutral ? 'border:1px solid #cbdde9;' : 'box-shadow:0 10px 20px rgba(26,160,232,0.18)'}">
                ${escapeHtml(input.ctaLabel)}
              </a>
            </div>
        `
        : '';
    const supportButtonHtml = supportUrl
        ? `
            <div style="margin-top:14px;text-align:center">
              <a href="${escapeHtmlAttr(supportUrl)}" style="display:inline-block;padding:12px 22px;border-radius:${isNeutral ? '14px' : '999px'};background:#ffffff;color:#0f6db5;font-size:14px;font-weight:700;text-decoration:none;border:1px solid ${isNeutral ? '#d5e1ea' : '#b9d7ee'}">
                Chat Customer Service
              </a>
            </div>
        `
        : '';

    return `
        <div style="margin:0;padding:24px 12px;background:${isNeutral ? '#f7f9fb' : '#f3f8fc'};font-family:Arial,sans-serif;color:#0f172a">
          <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid ${isNeutral ? '#dde6ec' : '#d9e8f4'};border-radius:24px;overflow:hidden;box-shadow:${isNeutral ? '0 6px 18px rgba(15,23,42,0.05)' : '0 12px 34px rgba(15,23,42,0.08)'}">
            <div style="padding:24px 28px 18px;background:${isNeutral ? '#ffffff' : 'linear-gradient(180deg,#f4fbff 0%,#ebf8ff 100%)'};border-bottom:1px solid ${isNeutral ? '#e4ebf0' : '#d6ecf9'};text-align:center">
              <img src="${EMAIL_LOGO_URL}" alt="NokosHUB" width="96" height="96" style="display:block;margin:0 auto 14px;max-width:96px;height:auto">
              <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:${isNeutral ? '#4b6478' : '#0f6db5'};font-weight:700;margin-bottom:8px">${escapeHtml(input.eyebrow)}</div>
              <h1 style="margin:0;font-size:24px;line-height:1.35;color:#12344d">${escapeHtml(input.title)}</h1>
            </div>

            <div style="padding:28px">
              ${input.introHtml || ''}
              ${input.contentHtml}
              ${ctaHtml}
              ${supportButtonHtml}
            </div>

            <div style="padding:18px 28px;background:${isNeutral ? '#fbfcfd' : '#f8fbfe'};border-top:1px solid ${isNeutral ? '#e6edf2' : '#e2edf5'}">
              ${input.footerHtml || ''}
              <p style="margin:8px 0 0;font-size:12px;line-height:1.7;color:#94a3b8">
                Butuh bantuan? Hubungi CS admin di ${escapeHtml(supportHandle)}.
              </p>
            </div>
          </div>
        </div>
    `;
}

async function sendBrevoApiMail(
    settings: Awaited<ReturnType<typeof smtpSettingsService.requireSettings>>,
    payload: EmailPayload
) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BREVO_API_TIMEOUT_MS);

    try {
        const response = await fetch(BREVO_API_URL, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'api-key': settings.apiKey,
            },
            body: JSON.stringify({
                sender: {
                    name: settings.fromName,
                    email: settings.fromEmail,
                },
                to: [{ email: payload.to }],
                subject: payload.subject,
                htmlContent: payload.html,
                textContent: payload.text || stripHtml(payload.html),
            }),
            signal: controller.signal,
        });

        const rawBody = await response.text();
        const body = parseJsonSafely(rawBody);

        if (!response.ok) {
            throw new Error(extractBrevoError(body, response.status));
        }
    } catch (err) {
        if ((err as Error).name === 'AbortError') {
            throw new Error('Timeout koneksi ke Brevo API. Periksa firewall server atau coba lagi.');
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

async function sendSmtpMail(
    settings: Awaited<ReturnType<typeof smtpSettingsService.requireSettings>>,
    payload: EmailPayload
) {
    let socket = await openSmtpSocket(settings);

    try {
        await readSmtpResponse(socket, 220);
        let capabilities = await sendEhlo(socket, settings.host);

        if (!settings.secure && capabilities.includes('STARTTLS')) {
            await sendCommand(socket, 'STARTTLS', 220);
            socket = await upgradeToTls(socket, settings.host);
            capabilities = await sendEhlo(socket, settings.host);
        }

        await authenticateSmtp(socket, settings.username, settings.password);
        await sendEmailData(socket, settings, payload);
        await sendCommand(socket, 'QUIT', 221).catch(() => null);
    } finally {
        socket.end();
    }
}

async function sendEmailData(
    socket: net.Socket | tls.TLSSocket,
    settings: Awaited<ReturnType<typeof smtpSettingsService.requireSettings>>,
    payload: EmailPayload
) {
    await sendCommand(socket, `MAIL FROM:<${settings.fromEmail}>`, [250, 251]);
    await sendCommand(socket, `RCPT TO:<${payload.to}>`, [250, 251]);
    await sendCommand(socket, 'DATA', 354);

    const message = buildMimeMessage({
        fromName: settings.fromName,
        fromEmail: settings.fromEmail,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text || stripHtml(payload.html),
    });

    await writeSocket(socket, `${message}\r\n.\r\n`);
    await readSmtpResponse(socket, 250);
}

async function authenticateSmtp(socket: net.Socket | tls.TLSSocket, username: string, password: string) {
    if (!username || !password) return;
    await sendCommand(socket, 'AUTH LOGIN', 334);
    await sendCommand(socket, Buffer.from(username, 'utf8').toString('base64'), 334);
    await sendCommand(socket, Buffer.from(password, 'utf8').toString('base64'), 235);
}

async function sendEhlo(socket: net.Socket | tls.TLSSocket, host: string) {
    const response = await sendCommand(socket, `EHLO ${sanitizeHostname(host)}`, 250);
    return response.lines.map((line) => line.slice(4).trim().toUpperCase());
}

async function sendCommand(
    socket: net.Socket | tls.TLSSocket,
    command: string,
    expectedCodes: number | number[]
) {
    await writeSocket(socket, `${command}\r\n`);
    return readSmtpResponse(socket, expectedCodes);
}

function openSmtpSocket(settings: Awaited<ReturnType<typeof smtpSettingsService.requireSettings>>) {
    return new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
        let timer: NodeJS.Timeout | null = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout koneksi SMTP. Periksa host, port, dan firewall server.'));
        }, SMTP_CONNECT_TIMEOUT_MS);

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            socket?.off('error', handleError);
        };

        let socket: net.Socket | tls.TLSSocket | null = null;

        const handleError = (err: Error) => {
            cleanup();
            reject(err);
        };

        if (settings.secure) {
            socket = tls.connect({
                host: settings.host,
                port: settings.port,
                servername: settings.host,
            }, () => {
                cleanup();
                resolve(socket as tls.TLSSocket);
            });
            socket.once('error', handleError);
            return;
        }

        socket = net.createConnection({
            host: settings.host,
            port: settings.port,
        }, () => {
            cleanup();
            resolve(socket as net.Socket);
        });
        socket.once('error', handleError);
    });
}

function upgradeToTls(socket: net.Socket | tls.TLSSocket, host: string) {
    return new Promise<tls.TLSSocket>((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout saat upgrade STARTTLS ke TLS.'));
        }, SMTP_CONNECT_TIMEOUT_MS);

        const cleanup = () => {
            clearTimeout(timer);
            upgraded.off('error', onError);
        };

        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };

        const upgraded = tls.connect({
            socket: socket as net.Socket,
            servername: host,
        }, () => {
            cleanup();
            resolve(upgraded);
        });
        upgraded.once('error', onError);
    });
}

function readSmtpResponse(socket: net.Socket | tls.TLSSocket, expectedCodes: number | number[]) {
    const expected = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];

    return new Promise<{ code: number; lines: string[] }>((resolve, reject) => {
        let buffer = '';
        const lines: string[] = [];
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout menunggu respons SMTP.'));
        }, SMTP_RESPONSE_TIMEOUT_MS);

        const cleanup = () => {
            clearTimeout(timer);
            socket.off('data', onData);
            socket.off('error', onError);
            socket.off('close', onClose);
        };

        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };

        const onClose = () => {
            cleanup();
            reject(new Error('Koneksi SMTP terputus'));
        };

        const onData = (chunk: Buffer | string) => {
            buffer += chunk.toString();

            while (buffer.includes('\r\n')) {
                const index = buffer.indexOf('\r\n');
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 2);
                if (!line) continue;
                lines.push(line);

                if (/^\d{3} /.test(line)) {
                    const code = Number(line.slice(0, 3));
                    cleanup();

                    if (!expected.includes(code)) {
                        reject(new Error(`SMTP error ${code}: ${line.slice(4)}`));
                        return;
                    }

                    resolve({ code, lines });
                    return;
                }
            }
        };

        socket.on('data', onData);
        socket.once('error', onError);
        socket.once('close', onClose);
    });
}

function writeSocket(socket: net.Socket | tls.TLSSocket, content: string) {
    return new Promise<void>((resolve, reject) => {
        socket.write(content, 'utf8', (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function buildMimeMessage(input: {
    fromName: string;
    fromEmail: string;
    to: string;
    subject: string;
    html: string;
    text: string;
}) {
    const boundary = `nokoshub-${Date.now().toString(16)}`;
    const from = formatMailbox(input.fromName, input.fromEmail);
    const subject = encodeMimeHeader(input.subject);

    const headers = [
        `From: ${from}`,
        `To: ${input.to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${Date.now()}.${Math.random().toString(16).slice(2)}@${sanitizeHostname(os.hostname())}>`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        dotStuff(input.text),
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        dotStuff(input.html),
        '',
        `--${boundary}--`,
    ];

    return headers.join('\r\n');
}

function formatMailbox(name: string, email: string) {
    return `"${name.replace(/"/g, '\\"')}" <${email}>`;
}

function encodeMimeHeader(value: string) {
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(value: string) {
    return value.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function normalizeSupportHandle(value: string) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '@nokoshubsupport';
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function buildTelegramUrl(handle: string) {
    const normalized = normalizeSupportHandle(handle);
    return `https://t.me/${normalized.replace(/^@/, '')}`;
}

function escapeHtmlAttr(value: string) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function stripHtml(value: string) {
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseJsonSafely(value: string) {
    if (!value) return null;
    try {
        return JSON.parse(value) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function extractBrevoError(body: Record<string, unknown> | null, status: number) {
    const message = typeof body?.message === 'string' ? body.message : null;
    const code = typeof body?.code === 'string' ? body.code : null;
    if (message && code) return `Brevo API error ${status} (${code}): ${message}`;
    if (message) return `Brevo API error ${status}: ${message}`;
    return `Brevo API error ${status}`;
}

function sanitizeHostname(value: string) {
    return value.replace(/[^\w.-]+/g, '') || 'localhost';
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
