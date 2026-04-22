import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import { smtpSettingsService } from '../settings/smtp-settings.service';
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

        return this.sendEmail({
            to: input.to,
            subject: `Kode OTP NokosHUB: ${input.otpCode}`,
            text: [
                `Halo ${input.recipientName || 'Pengguna'},`,
                '',
                `Kode OTP pendaftaran NokosHUB Anda adalah: ${input.otpCode}`,
                `Kode ini berlaku sekitar ${minutes} menit.`,
                '',
                'Jika Anda tidak merasa mendaftar, abaikan email ini.',
            ].join('\n'),
            html: `
                <div style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a">
                  <h2 style="margin:0 0 12px">Verifikasi Email NokosHUB</h2>
                  <p>Halo <strong>${escapedName}</strong>,</p>
                  <p>Kode OTP pendaftaran akun NokosHUB Anda adalah:</p>
                  <div style="display:inline-block;padding:12px 18px;border:2px solid #1d3557;border-radius:12px;background:#fff7d6;font-size:28px;font-weight:700;letter-spacing:6px;color:#1d3557">
                    ${escapedOtp}
                  </div>
                  <p style="margin-top:16px">Kode ini berlaku sekitar <strong>${minutes} menit</strong>.</p>
                  <p>Jika Anda tidak merasa mendaftar, abaikan email ini.</p>
                </div>
            `,
        });
    },

    async sendSmtpTestEmail(to: string) {
        return this.sendEmail({
            to,
            subject: 'Tes SMTP NokosHUB berhasil',
            text: 'Jika Anda menerima email ini, konfigurasi SMTP pada panel super admin NokosHUB sudah aktif.',
            html: `
                <div style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a">
                  <h2 style="margin:0 0 12px">Tes SMTP Berhasil</h2>
                  <p>Jika Anda menerima email ini, konfigurasi SMTP pada panel super admin NokosHUB sudah aktif.</p>
                </div>
            `,
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
