import { prisma } from '../../database/prisma.client';
import { emailService, renderBrandedEmail } from '../email/email.service';
import { config } from '../../app/config';
import { userService } from '../users/user.service';
import logger from '../../utils/logger';

type NewsletterChannel = 'email' | 'telegram';
type NewsletterAudience = 'single_email' | 'all_web' | 'single_telegram' | 'all_bot';

interface NewsletterTemplate {
    key: string;
    label: string;
    description: string;
    channels: NewsletterChannel[];
    subject: string;
    body: string;
}

interface SendNewsletterInput {
    channel: NewsletterChannel;
    audience: NewsletterAudience;
    recipient?: string;
    subject?: string;
    body: string;
    templateKey?: string;
}

interface RecipientRecord {
    kind: NewsletterChannel;
    recipient: string;
    name: string;
    email?: string | null;
    telegramId?: string | null;
    balance?: number;
}

const NEWSLETTER_TEMPLATES: NewsletterTemplate[] = [
    {
        key: 'maintenance_notice',
        label: 'Info Maintenance',
        description: 'Umum dipakai saat ada maintenance atau pembatasan transaksi sementara.',
        channels: ['email', 'telegram'],
        subject: 'Informasi Maintenance NokosHUB',
        body: [
            'Halo {{name}},',
            '',
            'Kami ingin menginformasikan bahwa saat ini ada maintenance / penyesuaian sistem.',
            '',
            '{{maintenanceNotice}}',
            '',
            'Apabila ada transaksi yang tertunda, tim kami akan bantu cek dan selesaikan secepat mungkin.',
            '',
            'Butuh bantuan? Hubungi CS kami di {{supportHandle}}.',
            '',
            'Terima kasih atas pengertiannya.',
            'Tim NokosHUB',
        ].join('\n'),
    },
    {
        key: 'payment_followup',
        label: 'Tindak Lanjut Deposit',
        description: 'Untuk mengabari user soal pengecekan deposit, koreksi saldo, atau kendala pembayaran.',
        channels: ['email', 'telegram'],
        subject: 'Update Deposit NokosHUB',
        body: [
            'Halo {{name}},',
            '',
            'Kami sedang menindaklanjuti deposit / pembayaran Anda di NokosHUB.',
            '',
            'Jika ada selisih saldo atau transaksi yang belum sesuai, tim kami akan koreksi secara manual sampai beres.',
            '',
            'Silakan balas pesan ini atau hubungi {{supportHandle}} bila Anda ingin menyertakan invoice / bukti transfer.',
            '',
            'Terima kasih,',
            'Tim NokosHUB',
        ].join('\n'),
    },
    {
        key: 'promo_broadcast',
        label: 'Broadcast Promo',
        description: 'Template generik untuk promo, bonus deposit, atau pengumuman layanan baru.',
        channels: ['email', 'telegram'],
        subject: 'Promo Terbaru NokosHUB',
        body: [
            'Halo {{name}},',
            '',
            'Ada update promo dari NokosHUB untuk Anda.',
            '',
            '- Bonus / promo berlaku terbatas',
            '- Cek dashboard atau bot untuk detail lengkap',
            '- Saldo Anda saat ini: {{balance}}',
            '',
            'Kalau butuh bantuan, hubungi {{supportHandle}}.',
            '',
            'Salam,',
            'Tim NokosHUB',
        ].join('\n'),
    },
    {
        key: 'deposit_bonus_2000',
        label: 'Promo Deposit 20K Bonus 2K',
        description: 'Promo deposit minimal Rp20.000 bonus Rp2.000 dan klaim melalui CS admin.',
        channels: ['email', 'telegram'],
        subject: 'Promo Deposit NokosHUB: Min. Rp20.000 Free Rp2.000',
        body: [
            'Halo {{name}},',
            '',
            'Ada promo deposit terbaru dari NokosHUB khusus untuk Anda.',
            '',
            '- Deposit minimal Rp20.000',
            '- Bonus saldo Rp2.000',
            '- Promo berlaku terbatas',
            '',
            'Untuk klaim bonus promo ini, silakan langsung hubungi CS admin di {{supportHandle}}.',
            '',
            'Buka website: https://nokoshub.store',
            '',
            'Terima kasih,',
            'Tim NokosHUB',
        ].join('\n'),
    },
];

export const newsletterService = {
    getTemplates() {
        return NEWSLETTER_TEMPLATES;
    },

    async send(input: SendNewsletterInput) {
        const recipients = await resolveRecipients(input.audience, input.recipient);
        if (!recipients.length) {
            throw new Error('Tidak ada penerima yang cocok untuk target tersebut');
        }

        const normalizedSubject = (input.subject || '').trim();
        if (input.channel === 'email' && !normalizedSubject) {
            throw new Error('Subject email wajib diisi');
        }

        let sent = 0;
        let failed = 0;
        const failures: Array<{ recipient: string; error: string }> = [];

        for (const recipient of recipients) {
            try {
                const renderedSubject = renderTemplate(normalizedSubject, recipient);
                const renderedBody = renderTemplate(input.body, recipient);

                if (input.channel === 'email') {
                    await emailService.sendEmail({
                        to: recipient.recipient,
                        subject: renderedSubject,
                        text: renderedBody,
                        html: wrapNewsletterHtml(renderedSubject, renderedBody),
                    });
                } else {
                    await sendTelegramBroadcast(recipient.recipient, renderedBody);
                }

                sent += 1;
            } catch (err) {
                failed += 1;
                failures.push({
                    recipient: recipient.recipient,
                    error: (err as Error).message || 'Unknown error',
                });
                logger.warn(
                    {
                        err,
                        channel: input.channel,
                        audience: input.audience,
                        recipient: recipient.recipient,
                        templateKey: input.templateKey,
                    },
                    'Newsletter send failed for one recipient'
                );
            }
        }

        logger.info(
            {
                channel: input.channel,
                audience: input.audience,
                templateKey: input.templateKey,
                total: recipients.length,
                sent,
                failed,
            },
            'Newsletter broadcast finished'
        );

        return {
            total: recipients.length,
            sent,
            failed,
            failures: failures.slice(0, 20),
        };
    },
};

async function resolveRecipients(audience: NewsletterAudience, rawRecipient?: string): Promise<RecipientRecord[]> {
    if (audience === 'single_email') {
        const recipient = (rawRecipient || '').trim();
        if (!recipient) throw new Error('Email tujuan wajib diisi');
        return [{
            kind: 'email',
            recipient,
            name: recipient,
            email: recipient,
            balance: 0,
        }];
    }

    if (audience === 'single_telegram') {
        const recipient = (rawRecipient || '').trim();
        if (!recipient) throw new Error('Telegram ID tujuan wajib diisi');
        return [{
            kind: 'telegram',
            recipient,
            name: recipient,
            telegramId: recipient,
            balance: 0,
        }];
    }

    if (audience === 'all_bot') {
        const botUsers = await prisma.user.findMany({
            where: {
                telegramId: {
                    not: {
                        startsWith: 'web_',
                    },
                },
            },
            select: {
                telegramId: true,
                username: true,
                firstName: true,
                lastName: true,
                balance: true,
            },
            orderBy: { createdAt: 'asc' },
        });

        return dedupeRecipients(
            botUsers
                .filter((user) => /^\d+$/.test(String(user.telegramId || '').trim()))
                .map((user) => ({
                    kind: 'telegram' as const,
                    recipient: user.telegramId,
                    telegramId: user.telegramId,
                    name: buildDisplayName(user.firstName, user.lastName, user.username, user.telegramId),
                    balance: user.balance,
                }))
        );
    }

    const webUsers = await prisma.webUser.findMany({
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            telegramId: true,
            telegramUser: {
                select: {
                    balance: true,
                },
            },
        },
        orderBy: { createdAt: 'asc' },
    });

    const webWalletIds = webUsers.map((user) => userService.getWebWalletTelegramId(user.id));
    const wallets = webWalletIds.length
        ? await prisma.user.findMany({
            where: { telegramId: { in: webWalletIds } },
            select: { telegramId: true, balance: true },
        })
        : [];
    const walletBalanceMap = new Map(wallets.map((wallet) => [wallet.telegramId, wallet.balance]));

    return dedupeRecipients(
        webUsers
            .filter((user) => Boolean(user.email))
            .map((user) => ({
                kind: 'email' as const,
                recipient: user.email!,
                email: user.email!,
                telegramId: user.telegramId,
                name: buildDisplayName(user.firstName, user.lastName, null, user.email),
                balance: user.telegramUser?.balance
                    ?? walletBalanceMap.get(userService.getWebWalletTelegramId(user.id))
                    ?? 0,
            }))
    );
}

function dedupeRecipients<T extends RecipientRecord>(items: T[]) {
    const seen = new Set<string>();
    return items.filter((item) => {
        const key = `${item.kind}:${item.recipient}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function buildDisplayName(
    firstName?: string | null,
    lastName?: string | null,
    username?: string | null,
    fallback?: string | null
) {
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (username) return `@${username}`;
    return fallback || 'Pengguna NokosHUB';
}

function renderTemplate(template: string, recipient: RecipientRecord) {
    const balanceText = formatRupiah(recipient.balance ?? 0);
    const supportHandle = normalizeSupportHandle(config.CS_TELEGRAM_BOT_USERNAME || config.TELEGRAM_SUPPORT_HANDLE);
    const replacements: Record<string, string> = {
        name: recipient.name || 'Pengguna NokosHUB',
        email: recipient.email || '—',
        telegramId: recipient.telegramId || '—',
        balance: balanceText,
        supportHandle,
        maintenanceNotice: config.TELEGRAM_MAINTENANCE_NOTICE,
    };

    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, rawKey) => {
        const key = String(rawKey || '');
        return replacements[key] ?? '';
    });
}

function wrapNewsletterHtml(subject: string, body: string) {
    return renderBrandedEmail({
        eyebrow: 'Newsletter NokosHUB',
        title: subject,
        contentHtml: renderBodyHtml(body),
        ctaLabel: 'Buka Website NokosHUB',
        ctaUrl: 'https://nokoshub.store',
        footerHtml: `
          <p style="margin:0;font-size:12px;line-height:1.7;color:#94a3b8">
            Email ini dikirim dari panel admin NokosHUB.
          </p>
        `,
    });
}

function escapeHtml(value: string) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatRupiah(value: number) {
    return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

function normalizeSupportHandle(value: string) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '@nokoshubsupport';
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function renderBodyHtml(body: string) {
    const lines = String(body || '').replace(/\r/g, '').split('\n');
    const chunks: string[] = [];
    let listBuffer: string[] = [];

    const flushList = () => {
        if (!listBuffer.length) return;
        chunks.push(`
            <ul style="margin:0 0 16px;padding-left:20px;color:#334155">
              ${listBuffer.map((item) => `<li style="margin:0 0 8px">${escapeHtml(item)}</li>`).join('')}
            </ul>
        `);
        listBuffer = [];
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            flushList();
            continue;
        }

        if (line.startsWith('- ')) {
            listBuffer.push(line.slice(2).trim());
            continue;
        }

        flushList();
        chunks.push(`<p style="margin:0 0 14px;font-size:15px;line-height:1.8;color:#334155">${escapeHtml(line)}</p>`);
    }

    flushList();
    return chunks.join('');
}

async function sendTelegramBroadcast(chatId: string, text: string) {
    const res = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
        }),
    });

    const body = await (res.json() as Promise<{ ok?: boolean; description?: string }>).catch(
        (): { ok?: boolean; description?: string } => ({})
    );
    if (!res.ok || body?.ok === false) {
        throw new Error(body?.description || `Telegram request failed (${res.status})`);
    }
}
