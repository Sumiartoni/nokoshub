import TelegramBot from 'node-telegram-bot-api';
import { config } from '../src/app/config';
import logger from '../src/utils/logger';
import { PromoSettings, promoSettingsService } from '../src/modules/settings/promo-settings.service';
import { AiDecision, generateCsReply, HistoryMessage } from './openrouter';

const BOT_TOKEN = config.CS_TELEGRAM_BOT_TOKEN.trim();
const BOT_USERNAME = normalizeBotUsername(config.CS_TELEGRAM_BOT_USERNAME || config.TELEGRAM_SUPPORT_HANDLE);
const ADMIN_IDS = parseTelegramAdminIds(config.CS_TELEGRAM_ADMIN_IDS || config.TELEGRAM_ADMIN_IDS);
const POLLING_TIMEOUT_SECONDS = Math.max(5, config.CS_TELEGRAM_POLLING_TIMEOUT_SECONDS);
const REQUEST_TIMEOUT_MS = Math.max(10000, config.CS_TELEGRAM_REQUEST_TIMEOUT_MS);
const MAX_HISTORY = Math.max(2, config.CS_BOT_MAX_HISTORY);
const TELEGRAM_NETWORK_WARNING_INTERVAL_MS = 60000;

const BOT_COMMANDS = [
    { command: '/start', description: 'Mulai bot Customer Service' },
    { command: '/help', description: 'Bantuan penggunaan bot CS' },
    { command: '/klaim', description: 'Klaim promo deposit aktif' },
    { command: '/myid', description: 'Lihat Telegram ID Anda' },
    { command: '/reply', description: 'Admin: /reply <chatId> <pesan>' },
    { command: '/done', description: 'Admin: akhiri mode handoff user' },
];

interface ClaimProof {
    kind: 'photo' | 'document';
    fileId: string;
    caption: string;
    fileName?: string;
    mimeType?: string;
}

interface ClaimSession {
    step: 'awaiting_proof' | 'awaiting_email';
    promoTitle: string;
    proof?: ClaimProof;
}

interface Session {
    history: HistoryMessage[];
    handoffActive: boolean;
    lastEscalationReason?: string;
    claim?: ClaimSession;
}

type ReplyTarget = {
    userChatId: number;
};

const sessions = new Map<number, Session>();
const adminReplyTargets = new Map<string, ReplyTarget>();
let lastTelegramNetworkWarningAt = 0;

export function createCsBot() {
    if (!BOT_TOKEN) {
        throw new Error('CS_TELEGRAM_BOT_TOKEN belum diisi');
    }

    if (!ADMIN_IDS.length) {
        logger.warn('CS bot started without CS_TELEGRAM_ADMIN_IDS; escalation will not reach any admin');
    }

    const requestOptions: any = {
        timeout: REQUEST_TIMEOUT_MS,
    };

    if (config.TELEGRAM_FORCE_IPV4) {
        requestOptions.family = 4;
        requestOptions.agentOptions = { family: 4 };
    }

    const bot = new TelegramBot(BOT_TOKEN, {
        polling: {
            autoStart: true,
            params: {
                timeout: POLLING_TIMEOUT_SECONDS,
            },
        },
        request: requestOptions,
    });

    bot.on('polling_error', (err: any) => {
        logTelegramNetworkWarning(err);
    });

    bot.setMyCommands(BOT_COMMANDS)
        .catch((err) => logger.warn({ err }, 'Failed to set CS bot commands'));

    bot.onText(/\/start/, async (msg) => {
        await sendWelcome(bot, msg.chat.id, isAdmin(msg) ? 'admin' : 'user');
    });

    bot.onText(/\/help/, async (msg) => {
        await sendHelp(bot, msg.chat.id, isAdmin(msg) ? 'admin' : 'user');
    });

    bot.onText(/\/klaim/, async (msg) => {
        if (isAdmin(msg)) {
            await bot.sendMessage(msg.chat.id, 'Perintah /klaim dipakai oleh user untuk klaim promo yang sedang aktif.');
            return;
        }
        await startPromoClaim(bot, msg);
    });

    bot.onText(/\/myid/, async (msg) => {
        await bot.sendMessage(msg.chat.id, `Telegram ID Anda: ${msg.from?.id ?? msg.chat.id}`);
    });

    bot.onText(/\/reply(?:\s+(\d+)\s+([\s\S]+))?/, async (msg, match) => {
        if (!isAdmin(msg)) return;
        const chatId = match?.[1] ? Number(match[1]) : 0;
        const text = String(match?.[2] || '').trim();
        if (!chatId || !text) {
            await bot.sendMessage(msg.chat.id, 'Format: /reply <chatId> <pesan>');
            return;
        }
        await relayAdminReply(bot, msg, chatId, text);
    });

    bot.onText(/\/done(?:\s+(\d+))?/, async (msg, match) => {
        if (!isAdmin(msg)) return;
        const explicitChatId = match?.[1] ? Number(match[1]) : 0;
        const replyTarget = getReplyTarget(msg);
        const userChatId = explicitChatId || replyTarget?.userChatId || 0;

        if (!userChatId) {
            await bot.sendMessage(msg.chat.id, 'Gunakan /done <chatId> atau balas pesan eskalasi user.');
            return;
        }

        const session = getSession(userChatId);
        session.handoffActive = false;
        session.lastEscalationReason = undefined;

        await bot.sendMessage(msg.chat.id, `Mode handoff untuk user ${userChatId} sudah ditutup. AI akan aktif lagi.`);
        await bot.sendMessage(userChatId, 'Customer Service telah menutup eskalasi. Anda bisa lanjut bertanya lagi ke bot ini.');
    });

    bot.on('message', async (msg) => {
        try {
            if (isSupportedMediaMessage(msg)) {
                if (isAdmin(msg)) {
                    await safeSendMessage(bot, msg.chat.id, 'Balasan admin via media belum didukung. Gunakan teks biasa atau /reply <chatId> <pesan>.');
                    return;
                }

                await handleUserMedia(bot, msg);
                return;
            }

            const text = getIncomingText(msg);
            if (!text || text.startsWith('/')) return;

            if (isAdmin(msg)) {
                const target = getReplyTarget(msg);
                if (target) {
                    await relayAdminReply(bot, msg, target.userChatId, text);
                    return;
                }

                await handleUserMessage(bot, msg, text, { adminTestMode: true });
                return;
            }

            await handleUserMessage(bot, msg, text);
        } catch (err) {
            logger.error({ err, chatId: msg.chat.id }, 'Unhandled CS bot message error');
            await safeSendMessage(bot, msg.chat.id, 'Terjadi gangguan saat memproses pesan Anda. Silakan coba lagi.');
        }
    });

    logger.info({ bot: BOT_USERNAME || 'cs-bot' }, 'CS Telegram bot started');
    return bot;
}

async function handleUserMessage(
    bot: TelegramBot,
    msg: TelegramBot.Message,
    text: string,
    options: {
        adminTestMode?: boolean;
    } = {}
) {
    const chatId = msg.chat.id;
    const session = getSession(chatId);

    if (session.claim?.step === 'awaiting_proof') {
        await safeSendMessage(
            bot,
            chatId,
            '📎 Promo masih menunggu bukti transfer.\n\nSilakan upload screenshot atau foto bukti pembayaran terlebih dahulu, lalu saya lanjut minta email terdaftar Anda.'
        );
        return;
    }

    if (session.claim?.step === 'awaiting_email') {
        const email = text.trim();
        if (!isValidEmail(email)) {
            await safeSendMessage(
                bot,
                chatId,
                '✉️ Format email belum valid.\n\nSilakan kirim email yang terdaftar di NokosHUB, misalnya `nama@email.com`.'
            );
            return;
        }

        await submitPromoClaim(bot, msg, session, email);
        return;
    }

    if (session.handoffActive) {
        if (options.adminTestMode) {
            await safeSendMessage(
                bot,
                chatId,
                'Mode admin test aktif. Untuk membalas user, balas pesan eskalasi atau gunakan /reply <chatId> <pesan>.'
            );
            return;
        }
        await forwardUserMessageToAdmins(bot, msg, text, session.lastEscalationReason || 'Percakapan masih dalam mode handoff');
        await safeSendMessage(bot, chatId, 'Pesan Anda sudah diteruskan ke admin Customer Service. Mohon tunggu balasan.');
        return;
    }

    const displayName = buildDisplayName(msg);
    const decision = await generateCsReply({
        userMessage: text,
        displayName,
        username: msg.from?.username,
        history: session.history,
    });

    if (decision.escalate) {
        if (options.adminTestMode) {
            await safeSendMessage(
                bot,
                chatId,
                `AI test mode: pertanyaan ini akan di-handoff ke admin manusia.\nAlasan: ${decision.reason || 'AI tidak yakin dengan jawaban'}`
            );
            return;
        }
        session.handoffActive = true;
        session.lastEscalationReason = decision.reason || 'AI tidak yakin dengan jawaban';
        await forwardUserMessageToAdmins(bot, msg, text, session.lastEscalationReason);
        await safeSendMessage(
            bot,
            chatId,
            'Pertanyaan Anda perlu ditangani Customer Service manusia. Pesan sudah kami teruskan ke admin dan akan dibalas lewat bot ini.'
        );
        return;
    }

    pushHistory(session, { role: 'user', content: text });
    pushHistory(session, { role: 'assistant', content: decision.answer });
    await safeSendMessage(bot, chatId, decision.answer);
}

async function forwardUserMessageToAdmins(
    bot: TelegramBot,
    msg: TelegramBot.Message,
    text: string,
    reason: string
) {
    const displayName = buildDisplayName(msg);
    const username = msg.from?.username ? `@${msg.from.username}` : '-';
    const body = [
        'Escalation Customer Service',
        '',
        `User chat ID: ${msg.chat.id}`,
        `Nama: ${displayName}`,
        `Username: ${username}`,
        `Alasan handoff: ${reason || '-'}`,
        '',
        'Pesan user:',
        text,
        '',
        'Balas pesan ini untuk mengirim jawaban ke user.',
        `Atau gunakan /reply ${msg.chat.id} <pesan>`,
        `Gunakan /done ${msg.chat.id} jika handoff selesai.`,
    ].join('\n');

    for (const adminId of ADMIN_IDS) {
        try {
            const sent = await bot.sendMessage(Number(adminId), body);
            registerAdminReplyTarget(Number(adminId), sent.message_id, msg.chat.id);
        } catch (err) {
            logger.warn({ err, adminId, userChatId: msg.chat.id }, 'Failed to forward CS escalation to admin');
        }
    }
}

async function relayAdminReply(
    bot: TelegramBot,
    adminMessage: TelegramBot.Message,
    userChatId: number,
    text: string
) {
    const session = getSession(userChatId);
    session.handoffActive = true;

    const adminName = buildDisplayName(adminMessage);
    const outgoing = `Customer Service:\n${text}`;
    await bot.sendMessage(userChatId, outgoing);
    await bot.sendMessage(adminMessage.chat.id, `Balasan terkirim ke user ${userChatId}.`);

    pushHistory(session, { role: 'assistant', content: `${adminName}: ${text}` });
}

function getIncomingText(msg: TelegramBot.Message) {
    return String(msg.text || msg.caption || '').trim();
}

function isSupportedMediaMessage(msg: TelegramBot.Message) {
    return Boolean(getClaimProofFromMessage(msg));
}

function getClaimProofFromMessage(msg: TelegramBot.Message): ClaimProof | null {
    if (msg.photo?.length) {
        const selected = msg.photo[msg.photo.length - 1];
        if (!selected?.file_id) return null;
        return {
            kind: 'photo',
            fileId: selected.file_id,
            caption: getIncomingText(msg),
            fileName: `bukti-transfer-${msg.message_id}.jpg`,
            mimeType: 'image/jpeg',
        };
    }

    const mimeType = String(msg.document?.mime_type || '').trim().toLowerCase();
    if (msg.document?.file_id && mimeType.startsWith('image/')) {
        return {
            kind: 'document',
            fileId: msg.document.file_id,
            caption: getIncomingText(msg),
            fileName: msg.document.file_name || `bukti-transfer-${msg.message_id}`,
            mimeType,
        };
    }

    return null;
}

function getSession(chatId: number): Session {
    if (!sessions.has(chatId)) {
        sessions.set(chatId, {
            history: [],
            handoffActive: false,
        });
    }
    return sessions.get(chatId)!;
}

function pushHistory(session: Session, message: HistoryMessage) {
    session.history.push(message);
    if (session.history.length > MAX_HISTORY) {
        session.history = session.history.slice(-MAX_HISTORY);
    }
}

function buildDisplayName(msg: TelegramBot.Message) {
    const first = String(msg.from?.first_name || '').trim();
    const last = String(msg.from?.last_name || '').trim();
    const full = `${first} ${last}`.trim();
    if (full) return full;
    if (msg.from?.username) return `@${msg.from.username}`;
    return `User ${msg.chat.id}`;
}

function parseTelegramAdminIds(value: string): string[] {
    return value
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter((item) => /^\d+$/.test(item));
}

function normalizeBotUsername(value: string) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function isAdmin(msg: TelegramBot.Message) {
    const telegramId = String(msg.from?.id ?? '');
    return ADMIN_IDS.includes(telegramId);
}

function registerAdminReplyTarget(adminChatId: number, messageId: number, userChatId: number) {
    adminReplyTargets.set(buildReplyTargetKey(adminChatId, messageId), {
        userChatId,
    });
}

function buildReplyTargetKey(adminChatId: number, messageId: number) {
    return `${adminChatId}:${messageId}`;
}

function getReplyTarget(msg: TelegramBot.Message) {
    const replyMessageId = msg.reply_to_message?.message_id;
    if (!replyMessageId) return null;
    return adminReplyTargets.get(buildReplyTargetKey(msg.chat.id, replyMessageId)) || null;
}

async function sendWelcome(bot: TelegramBot, chatId: number, mode: 'user' | 'admin') {
    if (mode === 'admin') {
        await bot.sendMessage(
            chatId,
            [
                `Bot ${BOT_USERNAME || 'Customer Service'} aktif.`,
                '',
                'Mode admin:',
                '- Balas pesan eskalasi untuk menjawab user',
                '- /reply <chatId> <pesan>',
                '- /done <chatId> untuk mengakhiri handoff',
                '- Kirim teks biasa tanpa reply untuk test jawaban AI',
            ].join('\n')
        );
        return;
    }

    await bot.sendMessage(
        chatId,
            [
                `Halo, ini ${BOT_USERNAME || 'Customer Service NokosHUB'}.`,
                'Silakan kirim pertanyaan Anda. AI akan menjawab pertanyaan umum terlebih dahulu.',
                'Jika ada promo aktif dan Anda ingin klaim bonus deposit, gunakan perintah /klaim.',
                'Jika pertanyaan membutuhkan bantuan manual, percakapan akan otomatis dialihkan ke admin Customer Service.',
            ].join('\n')
        );
}

async function sendHelp(bot: TelegramBot, chatId: number, mode: 'user' | 'admin') {
    if (mode === 'admin') {
        await bot.sendMessage(
            chatId,
            [
                'Panduan admin CS:',
                '- Balas pesan eskalasi untuk menjawab user langsung',
                '- /reply <chatId> <pesan>',
                '- /done <chatId> untuk mengembalikan percakapan ke AI',
                '- Kirim teks biasa tanpa reply untuk test AI langsung dari bot',
            ].join('\n')
        );
        return;
    }

    await bot.sendMessage(
        chatId,
            [
                'Panduan Customer Service:',
                '- Kirim pertanyaan Anda dengan teks biasa',
                '- Gunakan /klaim untuk klaim promo deposit yang sedang aktif',
                '- AI akan menjawab pertanyaan umum seputar NokosHUB',
                '- Jika dibutuhkan, admin manusia akan mengambil alih percakapan',
            ].join('\n')
        );
    }

async function safeSendMessage(bot: TelegramBot, chatId: number, text: string) {
    try {
        await bot.sendMessage(chatId, text);
    } catch (err) {
        logger.warn({ err, chatId }, 'Failed to send CS bot message');
    }
}

function logTelegramNetworkWarning(err: any) {
    const now = Date.now();
    if (now - lastTelegramNetworkWarningAt < TELEGRAM_NETWORK_WARNING_INTERVAL_MS) return;
    lastTelegramNetworkWarningAt = now;
    logger.warn({ err: summarizeTelegramError(err) }, 'CS bot polling warning');
}

function summarizeTelegramError(err: any) {
    if (!err) return { message: 'Unknown telegram error' };
    const body = err?.response?.body || err?.response?.data;
    return {
        code: err?.code,
        message: err?.message,
        body,
    };
}

async function startPromoClaim(bot: TelegramBot, msg: TelegramBot.Message) {
    const promo = await promoSettingsService.getRuntimeSettings();
    const chatId = msg.chat.id;
    const session = getSession(chatId);

    if (!promo.enabled) {
        session.claim = undefined;
        await safeSendMessage(
            bot,
            chatId,
            '📭 Saat ini belum ada promo yang sedang berjalan.\n\nKalau nanti ada promo aktif, Anda bisa ketik /klaim lagi dari bot ini.'
        );
        return;
    }

    session.claim = {
        step: 'awaiting_proof',
        promoTitle: promo.title,
    };

    await bot.sendMessage(
        chatId,
        [
            `🎁 Promo aktif: ${promo.title}`,
            '',
            `• Minimal deposit: ${formatRupiah(promo.minimumDeposit)}`,
            `• Bonus: ${formatRupiah(promo.bonusAmount)}`,
            `• Detail: ${promo.description}`,
            '',
            promo.claimInstructions,
        ].join('\n'),
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💳 Buka Halaman Top Up', url: promo.topupUrl }],
                ],
            },
        }
    );
}

async function handleUserMedia(bot: TelegramBot, msg: TelegramBot.Message) {
    const proof = getClaimProofFromMessage(msg);
    if (!proof) return;

    const session = getSession(msg.chat.id);

    if (session.claim?.step === 'awaiting_proof') {
        session.claim.proof = proof;
        session.claim.step = 'awaiting_email';

        await safeSendMessage(
            bot,
            msg.chat.id,
            '✅ Bukti transfer sudah saya terima.\n\nSekarang silakan kirim email yang terdaftar di NokosHUB agar klaim bisa saya teruskan ke admin.'
        );
        return;
    }

    if (session.claim?.step === 'awaiting_email') {
        session.claim.proof = proof;
        await safeSendMessage(
            bot,
            msg.chat.id,
            '✅ Bukti transfer diperbarui.\n\nSekarang kirim email yang terdaftar di NokosHUB agar klaim bisa saya teruskan ke admin.'
        );
        return;
    }

    const sentCount = await sendProofToAdmins(
        bot,
        proof,
        buildGenericProofCaption(msg, proof, 'User mengirim bukti transfer / gambar ke bot CS'),
        msg.chat.id
    );

    if (!sentCount) {
        await safeSendMessage(
            bot,
            msg.chat.id,
            'Terjadi gangguan saat meneruskan bukti transfer ke admin. Silakan coba kirim ulang beberapa saat lagi.'
        );
        return;
    }

    session.handoffActive = true;
    session.lastEscalationReason = 'User mengirim bukti transfer / gambar ke bot CS';

    await safeSendMessage(
        bot,
        msg.chat.id,
        '📩 Bukti transfer Anda sudah saya teruskan ke admin untuk direview.\n\nJika perlu, balas lagi dengan email terdaftar atau nomor invoice agar admin lebih mudah mengecek.'
    );
}

async function submitPromoClaim(
    bot: TelegramBot,
    msg: TelegramBot.Message,
    session: Session,
    email: string
) {
    const proof = session.claim?.proof;
    if (!session.claim || !proof) {
        session.claim = undefined;
        await safeSendMessage(
            bot,
            msg.chat.id,
            'Flow klaim promo tidak lengkap. Silakan ketik /klaim lagi lalu upload bukti transfer terlebih dahulu.'
        );
        return;
    }

    const promo = await promoSettingsService.getRuntimeSettings();
    const caption = buildPromoClaimCaption(msg, proof, promo, email);
    const sentCount = await sendProofToAdmins(bot, proof, caption, msg.chat.id);

    if (!sentCount) {
        await safeSendMessage(
            bot,
            msg.chat.id,
            'Terjadi gangguan saat meneruskan klaim promo ke admin. Silakan coba lagi beberapa saat.'
        );
        return;
    }

    session.claim = undefined;
    session.handoffActive = true;
    session.lastEscalationReason = `Klaim promo menunggu review admin: ${promo.title}`;

    await safeSendMessage(
        bot,
        msg.chat.id,
        '✅ Klaim promo Anda sudah saya teruskan ke admin.\n\nMohon tunggu review manual dari Customer Service. Balasan admin akan dikirim lewat bot ini.'
    );
}

async function sendProofToAdmins(
    bot: TelegramBot,
    proof: ClaimProof,
    caption: string,
    userChatId: number
) {
    let sentCount = 0;

    for (const adminId of ADMIN_IDS) {
        try {
            const sent = proof.kind === 'photo'
                ? await bot.sendPhoto(Number(adminId), proof.fileId, {
                    caption: trimTelegramCaption(caption),
                })
                : await bot.sendDocument(Number(adminId), proof.fileId, {
                    caption: trimTelegramCaption(caption),
                });

            registerAdminReplyTarget(Number(adminId), sent.message_id, userChatId);
            sentCount += 1;
        } catch (err) {
            logger.warn({ err, adminId, userChatId }, 'Failed to forward CS proof to admin');
        }
    }

    return sentCount;
}

function buildGenericProofCaption(msg: TelegramBot.Message, proof: ClaimProof, reason: string) {
    const displayName = buildDisplayName(msg);
    const username = msg.from?.username ? `@${msg.from.username}` : '-';
    const captionNote = proof.caption ? `Caption user: ${proof.caption}` : 'Caption user: -';

    return [
        'Bukti transfer masuk ke bot CS',
        '',
        `User chat ID: ${msg.chat.id}`,
        `Nama: ${displayName}`,
        `Username: ${username}`,
        `Alasan review: ${reason}`,
        captionNote,
        '',
        'Balas pesan ini untuk mengirim jawaban ke user.',
        `Atau gunakan /reply ${msg.chat.id} <pesan>`,
        `Gunakan /done ${msg.chat.id} jika review selesai.`,
    ].join('\n');
}

function buildPromoClaimCaption(
    msg: TelegramBot.Message,
    proof: ClaimProof,
    promo: PromoSettings,
    email: string
) {
    const displayName = buildDisplayName(msg);
    const username = msg.from?.username ? `@${msg.from.username}` : '-';
    const captionNote = proof.caption ? `Caption bukti: ${proof.caption}` : 'Caption bukti: -';

    return [
        'Klaim promo deposit menunggu review admin',
        '',
        `Promo: ${promo.title}`,
        `Minimal deposit: ${formatRupiah(promo.minimumDeposit)}`,
        `Bonus promo: ${formatRupiah(promo.bonusAmount)}`,
        `Email terdaftar: ${email}`,
        `Top up URL: ${promo.topupUrl}`,
        '',
        `User chat ID: ${msg.chat.id}`,
        `Nama: ${displayName}`,
        `Username: ${username}`,
        captionNote,
        '',
        'Bukti transfer terlampir. Balas pesan ini untuk menjawab user.',
        `Atau gunakan /reply ${msg.chat.id} <pesan>`,
        `Gunakan /done ${msg.chat.id} jika review selesai.`,
    ].join('\n');
}

function trimTelegramCaption(value: string) {
    const trimmed = String(value || '').trim();
    if (trimmed.length <= 1024) return trimmed;
    return `${trimmed.slice(0, 1020).trim()}...`;
}

function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function formatRupiah(value: number) {
    return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}
