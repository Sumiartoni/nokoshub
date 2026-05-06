import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import QRCode from 'qrcode';
import { config } from '../src/app/config';
import { setNotifyHandler } from '../src/modules/routes/webhook.routes';
import { maintenanceService } from '../src/modules/maintenance/maintenance.service';
import logger from '../src/utils/logger';
import { formatRupiah } from '../src/utils/helpers';

const BASE_URL = `http://127.0.0.1:${config.PORT}`;
const TELEGRAM_POLLING_TIMEOUT_SECONDS = Math.max(5, config.TELEGRAM_POLLING_TIMEOUT_SECONDS);
const TELEGRAM_REQUEST_TIMEOUT_MS = Math.max(10000, config.TELEGRAM_REQUEST_TIMEOUT_MS);
const TELEGRAM_NETWORK_WARNING_INTERVAL_MS = 60000;
const TELEGRAM_COMMANDS_RETRY_MAX_MS = 300000;
const TELEGRAM_ADMIN_IDS = parseTelegramAdminIds(config.TELEGRAM_ADMIN_IDS);
const TELEGRAM_SUPPORT_HANDLE = normalizeSupportHandle(config.TELEGRAM_SUPPORT_HANDLE);
const BOT_COMMANDS = [
    { command: '/start', description: 'Mulai bot NokosHUB' },
    { command: '/menu', description: 'Buka menu utama' },
    { command: '/buy', description: 'Beli nomor virtual' },
    { command: '/deposit', description: 'Isi saldo' },
    { command: '/balance', description: 'Cek sisa saldo' },
    { command: '/history', description: 'Riwayat transaksi' },
    { command: '/linked', description: 'Tautkan akun web' },
    { command: '/myid', description: 'Lihat Telegram ID' },
    { command: '/help', description: 'Bantuan & Panduan' },
];

let lastTelegramNetworkWarningAt = 0;

// ─── API Helpers ──────────────────────────────────────────────────────────────

async function apiGet<T = any>(path: string, params?: object): Promise<T> {
    const res = await axios.get(`${BASE_URL}${path}`, {
        params,
        headers: {
            'x-internal-secret': config.INTERNAL_API_SECRET,
        },
    });
    return res.data;
}

async function apiPost<T = any>(path: string, data?: object): Promise<T> {
    const res = await axios.post(`${BASE_URL}${path}`, data, {
        headers: {
            'x-internal-secret': config.INTERNAL_API_SECRET,
        },
    });
    return res.data;
}

// ─── Session Storage (in-memory) ─────────────────────────────────────────────
// Holds transient state between bot steps per chat

interface Session {
    step?: string;
    panelMessageId?: number;
    replyPromptMessageId?: number;
    selectedServerKey?: string;
    selectedServerLabel?: string;
    selectedServiceId?: string;
    selectedServiceName?: string;
    selectedCountryId?: string;
    selectedCountryName?: string;
    prices?: Array<{ id: string; sellPrice: number }>;
    depositAmount?: number;
    pendingDeposit?: PendingDeposit;
    pendingWebLink?: boolean;
}

interface PendingDeposit {
    invoiceId: string;
    telegramId: string;
    requestedAmount: number;
    payableAmount: number;
    expiredAt: string | Date;
}

interface PaymentProof {
    fileId: string;
    type: 'photo' | 'document';
}

type PaymentSettings = {
    minimumDeposit: number;
    maximumDeposit: number;
};

const BUY_SERVER_OPTIONS = [
    {
        key: 'server1',
        label: 'Server 1',
        description: 'Jalur utama untuk layanan OTP',
    },
    {
        key: 'herosms',
        label: 'Server 2',
        description: 'Jalur alternatif untuk layanan OTP',
    },
];

const POPULAR_SERVICE_ORDER = [
    'whatsapp',
    'telegram',
    'instagram',
    'google',
    'shopee',
    'facebook',
    'tokopedia',
    'tiktok',
    'discord',
    'netflix',
    'spotify',
];

const sessions = new Map<number, Session>();
let paymentSettingsCache: { value: PaymentSettings; expiresAt: number } | null = null;

function isDepositExpired(deposit: PendingDeposit): boolean {
    const expiredAt = new Date(deposit.expiredAt).getTime();
    return Number.isFinite(expiredAt) && expiredAt <= Date.now();
}

function getSession(chatId: number): Session {
    if (!sessions.has(chatId)) sessions.set(chatId, {});
    return sessions.get(chatId)!;
}

function clearSession(chatId: number) {
    sessions.set(chatId, {});
}

function buildReplyOptions(messageId?: number) {
    if (!messageId) return {};
    return {
        reply_to_message_id: messageId,
        allow_sending_without_reply: true,
    };
}

function isMessageNotModifiedError(err: any): boolean {
    const message = String(err?.response?.body?.description ?? err?.message ?? '').toLowerCase();
    return message.includes('message is not modified');
}

async function deleteMessageSafe(bot: TelegramBot, chatId: number, messageId?: number) {
    if (!messageId) return;
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch {
        // Ignore cleanup errors; message may already be gone or not deletable anymore.
    }
}

async function clearReplyPrompt(bot: TelegramBot, chatId: number) {
    const session = getSession(chatId);
    const promptId = session.replyPromptMessageId;
    session.replyPromptMessageId = undefined;
    await deleteMessageSafe(bot, chatId, promptId);
}

async function upsertTextPanel(
    bot: TelegramBot,
    chatId: number,
    text: string,
    options: TelegramBot.SendMessageOptions = {},
    panelOptions: {
        sourceMessageId?: number;
        targetMessageId?: number;
        forceNew?: boolean;
    } = {}
) {
    const session = getSession(chatId);
    const panelMessageId = panelOptions.forceNew
        ? undefined
        : (panelOptions.targetMessageId ?? session.panelMessageId);

    if (panelMessageId) {
        try {
            const editOptions: TelegramBot.EditMessageTextOptions = {
                chat_id: chatId,
                message_id: panelMessageId,
                parse_mode: options.parse_mode,
                disable_web_page_preview: options.disable_web_page_preview,
                reply_markup: options.reply_markup && 'inline_keyboard' in options.reply_markup
                    ? options.reply_markup
                    : undefined,
            };
            await bot.editMessageText(text, {
                ...editOptions,
            });
            session.panelMessageId = panelMessageId;
            return panelMessageId;
        } catch (err) {
            if (isMessageNotModifiedError(err)) {
                session.panelMessageId = panelMessageId;
                return panelMessageId;
            }
            await deleteMessageSafe(bot, chatId, panelMessageId);
            if (session.panelMessageId === panelMessageId) {
                session.panelMessageId = undefined;
            }
        }
    }

    const sent = await bot.sendMessage(chatId, text, {
        ...options,
        ...buildReplyOptions(panelOptions.sourceMessageId),
    });
    session.panelMessageId = sent.message_id;
    return sent.message_id;
}

async function upsertPhotoPanel(
    bot: TelegramBot,
    chatId: number,
    photo: any,
    options: TelegramBot.SendPhotoOptions = {},
    panelOptions: {
        sourceMessageId?: number;
    } = {}
) {
    const session = getSession(chatId);
    await deleteMessageSafe(bot, chatId, session.panelMessageId);

    const sent = await bot.sendPhoto(chatId, photo as any, {
        ...options,
        ...buildReplyOptions(panelOptions.sourceMessageId),
    });
    session.panelMessageId = sent.message_id;
    return sent.message_id;
}

async function sendReplyPrompt(
    bot: TelegramBot,
    chatId: number,
    text: string,
    inputPlaceholder: string,
    sourceMessageId?: number
) {
    const session = getSession(chatId);
    await clearReplyPrompt(bot, chatId);

    const prompt = await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...buildReplyOptions(sourceMessageId),
        reply_markup: {
            force_reply: true,
            selective: true,
            input_field_placeholder: inputPlaceholder,
        },
    });

    session.replyPromptMessageId = prompt.message_id;
    return prompt.message_id;
}

async function handleWebLinkCode(bot: TelegramBot, msg: TelegramBot.Message, code: string) {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from?.id ?? msg.chat.id);
    const currentPanelMessageId = getSession(chatId).panelMessageId;

    try {
        const res = await apiPost('/api/auth/telegram-link/confirm', {
            code,
            telegramId,
            username: msg.from?.username,
            firstName: msg.from?.first_name,
            lastName: msg.from?.last_name,
        });

        clearSession(chatId);

        const email = res.data?.user?.email ?? 'akun web';
        await upsertTextPanel(
            bot,
            chatId,
            `✅ *Akun Telegram berhasil ditautkan!*\n\n` +
            `Telegram ID: \`${telegramId}\`\n` +
            `Akun web: *${email}*\n\n` +
            `Sekarang saldo dan riwayat bot bisa dipakai juga di dashboard web.`,
            { parse_mode: 'Markdown' },
            { sourceMessageId: msg.message_id, targetMessageId: currentPanelMessageId }
        );
    } catch (err: any) {
        const errMsg = err?.response?.data?.error ?? err.message ?? 'Kode tidak valid';
        await upsertTextPanel(
            bot,
            chatId,
            `❌ Gagal menautkan akun.\n\n${errMsg}\n\n` +
            `Buat kode baru dari dashboard web jika kode sudah kadaluarsa.`,
            undefined,
            { sourceMessageId: msg.message_id, targetMessageId: currentPanelMessageId }
        );
    }
}

function parseTelegramAdminIds(value: string): string[] {
    return value
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter((item) => /^\d+$/.test(item));
}

function isAdminTelegramId(telegramId: string): boolean {
    return TELEGRAM_ADMIN_IDS.includes(telegramId);
}

function normalizeSupportHandle(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return '@nokoshubsupport';
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function escapeTelegramMarkdown(value: string) {
    return value.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function getTimeGreeting(date = new Date()) {
    const hour = Number(new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        hour12: false,
    }).format(date));

    if (hour < 4) return 'Selamat dini hari';
    if (hour < 11) return 'Selamat pagi';
    if (hour < 15) return 'Selamat siang';
    if (hour < 18) return 'Selamat sore';
    return 'Selamat malam';
}

function menuBackKeyboard(extraRows: TelegramBot.InlineKeyboardButton[][] = []) {
    return {
        inline_keyboard: [
            ...extraRows,
            [{ text: '⬅️ Kembali ke Menu Utama', callback_data: 'menu' }],
        ],
    };
}

function resetBuySelection(session: Session) {
    session.selectedServerKey = undefined;
    session.selectedServerLabel = undefined;
    session.selectedServiceId = undefined;
    session.selectedServiceName = undefined;
    session.selectedCountryId = undefined;
    session.selectedCountryName = undefined;
    session.prices = undefined;
}

function popularServiceScore(name: string) {
    const normalized = String(name || '').toLowerCase();
    const index = POPULAR_SERVICE_ORDER.findIndex((keyword) => normalized.includes(keyword));
    return index === -1 ? 999 : index;
}

function buildHelpText() {
    return (
        `📖 *Pusat Bantuan NokosHUB*\n\n` +
        `• *Beli Nomor OTP*:\n` +
        `  1. Pilih menu beli nomor\n` +
        `  2. Pilih server terlebih dahulu\n` +
        `  3. Pilih aplikasi, negara, lalu harga\n` +
        `  4. Nomor akan dikirim dan OTP masuk otomatis ke chat ini\n\n` +
        `• *Deposit Saldo*:\n` +
        `  1. Pilih menu deposit\n` +
        `  2. Masukkan nominal\n` +
        `  3. Bayar QRIS sesuai nominal invoice\n` +
        `  4. Saldo masuk otomatis setelah pembayaran terdeteksi\n\n` +
        `• *Catatan Penting*:\n` +
        `  OTP tidak masuk dalam batas waktu akan diproses gagal dan saldo direfund otomatis sesuai status order.\n\n` +
        `🛠 *Info Maintenance*\n` +
        `${config.TELEGRAM_MAINTENANCE_NOTICE}\n\n` +
        `📞 *Customer Service*\n` +
        `${TELEGRAM_SUPPORT_HANDLE}`
    );
}

function buildBotDescription(settings?: { enabled: boolean; title: string; message: string; expectedEndAt: string }) {
    const maintenanceText = settings?.enabled
        ? `${settings.title}: ${settings.message}${settings.expectedEndAt ? ` Selesai sekitar ${new Date(settings.expectedEndAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}.` : ''}`
        : config.TELEGRAM_MAINTENANCE_NOTICE;

    return (
        `Apa yang dapat bot ini lakukan?\n\n` +
        `🛠 ${maintenanceText}\n\n` +
        `📞 Customer Service / Bantuan:\n${TELEGRAM_SUPPORT_HANDLE}\n\n` +
        `Terima kasih atas pengertian dan kesabarannya.`
    ).slice(0, 512);
}

function buildBotShortDescription() {
    return 'Order nomor OTP otomatis, deposit saldo, dan cek riwayat langsung dari Telegram.';
}

async function getTelegramUserSession(telegramId: string, meta?: {
    username?: string;
    firstName?: string;
    lastName?: string;
}) {
    const res = await apiPost('/api/user/session', {
        telegramId,
        username: meta?.username,
        firstName: meta?.firstName,
        lastName: meta?.lastName,
    });

    return res.data as {
        telegramId: string;
        username?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        balance: number;
        createdAt?: string;
    };
}

function formatTelegramDisplayName(input: {
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
    fallback?: string;
}) {
    const fullName = [input.firstName, input.lastName].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (input.username) return `@${input.username}`;
    return input.fallback ?? 'Pelanggan';
}

// ─── Bot Factory ──────────────────────────────────────────────────────────────

export function createBot(): TelegramBot {
    const requestOptions: any = {
        timeout: TELEGRAM_REQUEST_TIMEOUT_MS,
    };

    if (config.TELEGRAM_FORCE_IPV4) {
        requestOptions.family = 4;
        requestOptions.agentOptions = { family: 4 };
    }

    const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, {
        polling: {
            interval: 3000,
            autoStart: true,
            params: {
                timeout: TELEGRAM_POLLING_TIMEOUT_SECONDS,
            },
        },
        request: requestOptions,
    });

    bot.on('polling_error', (err: any) => {
        if (isTelegramNetworkIssue(err)) {
            logTelegramNetworkWarning(err, 'Telegram polling timeout; retrying automatically');
            return;
        }

        logger.error(summarizeTelegramError(err), 'Telegram polling error');
    });

    // Set Telegram bot profile + commands.
    scheduleBotCommandsSetup(bot);

    // ─── OTP Notification handler (from worker) ───────────────────────────────
    setNotifyHandler(async (data: any) => {
        const { telegramId, type, orderId, otpCode } = data;
        const chatId = parseInt(telegramId);

        if (type === 'OTP_RECEIVED') {
            await bot.sendMessage(
                chatId,
                `✅ *Kode OTP diterima!*\n\n` +
                `📱 Kode: \`${otpCode}\`\n` +
                `📦 Order: \`${orderId}\`\n\n` +
                `_Kode OTP ini bersifat rahasia, jangan berikan kepada siapapun._`,
                { parse_mode: 'Markdown' }
            );
        } else if (type === 'OTP_TIMEOUT') {
            await bot.sendMessage(
                chatId,
                `⚠️ *OTP tidak diterima*\n\n` +
                `SMS tidak masuk dalam 20 menit.\n` +
                `📦 Order ID: \`${orderId}\`\n\n` +
                `Order otomatis dibatalkan dan saldo sudah dikembalikan.`,
                { parse_mode: 'Markdown' }
            );
        }
    });

    // ─── /start ───────────────────────────────────────────────────────────────
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        clearSession(chatId);
        await sendMainMenu(bot, chatId, undefined, msg.message_id, {
            telegramId: String(msg.from?.id ?? msg.chat.id),
            username: msg.from?.username,
            firstName: msg.from?.first_name,
            lastName: msg.from?.last_name,
        });
    });

    // ─── /menu ────────────────────────────────────────────────────────────────
    bot.onText(/\/menu/, async (msg) => {
        const existingPanelId = getSession(msg.chat.id).panelMessageId;
        clearSession(msg.chat.id);
        await sendMainMenu(bot, msg.chat.id, existingPanelId, msg.message_id, {
            telegramId: String(msg.from?.id ?? msg.chat.id),
            username: msg.from?.username,
            firstName: msg.from?.first_name,
            lastName: msg.from?.last_name,
        });
    });

    // ─── /balance ─────────────────────────────────────────────────────────────
    bot.onText(/\/balance/, async (msg) => {
        await handleBalance(bot, msg.chat.id, String(msg.from?.id), msg.message_id);
    });

    // ─── /history ─────────────────────────────────────────────────────────────
    bot.onText(/\/history/, async (msg) => {
        await handleHistory(bot, msg.chat.id, String(msg.from?.id), msg.message_id);
    });

    // ─── /linked ──────────────────────────────────────────────────────────────
    bot.onText(/\/linked(?:\s+(\d{4,8}))?/, async (msg, match) => {
        const code = match?.[1];
        if (code) {
            await handleWebLinkCode(bot, msg, code);
            return;
        }

        const session = getSession(msg.chat.id);
        session.pendingWebLink = true;
        session.step = 'AWAIT_WEB_LINK_CODE';
        await upsertTextPanel(
            bot,
            msg.chat.id,
            `🔗 *Tautkan Akun Web NokosHUB*\n\n` +
            `1. Buka dashboard web.\n` +
            `2. Masuk ke menu *Profil / Setelan*.\n` +
            `3. Tekan *Buat Kode Link Telegram*.\n` +
            `4. Balas prompt di bawah dengan kode 6 digit dari web.`,
            {
                parse_mode: 'Markdown',
                reply_markup: menuBackKeyboard(),
            },
            { sourceMessageId: msg.message_id }
        );
        await sendReplyPrompt(
            bot,
            msg.chat.id,
            '🔢 Balas pesan ini dengan kode link 6 digit dari dashboard web.',
            'Ketik kode 6 digit',
            msg.message_id
        );
    });

    // ─── /myid ────────────────────────────────────────────────────────────────
    bot.onText(/\/myid/, async (msg) => {
        const telegramId = String(msg.from?.id ?? msg.chat.id);
        await upsertTextPanel(
            bot,
            msg.chat.id,
            `Telegram ID Anda:\n\`${telegramId}\``,
            { parse_mode: 'Markdown' },
            { sourceMessageId: msg.message_id }
        );
    });

    // ─── /buy ─────────────────────────────────────────────────────────────────
    bot.onText(/\/buy/, async (msg) => {
        await handleBuyStart(bot, msg.chat.id, undefined, msg.message_id);
    });

    // ─── /deposit ─────────────────────────────────────────────────────────────
    bot.onText(/\/deposit(?:\s+(\d+))?/, async (msg, match) => {
        const amountStr = match?.[1];
        if (amountStr) {
            await handleDepositWithAmount(bot, msg.chat.id, String(msg.from?.id), parseInt(amountStr), msg.message_id);
        } else {
            await askDepositAmount(bot, msg.chat.id, msg.message_id);
        }
    });

    // ─── /status ──────────────────────────────────────────────────────────────
    bot.onText(/\/status(?:\s+(.+))?/, async (msg, match) => {
        const orderId = match?.[1];
        if (!orderId) {
            return upsertTextPanel(
                bot,
                msg.chat.id,
                'Gunakan: `/status <orderId>`',
                { parse_mode: 'Markdown' },
                { sourceMessageId: msg.message_id }
            );
        }
        await handleOrderStatus(bot, msg.chat.id, orderId, msg.message_id);
    });

    // ─── /help ────────────────────────────────────────────────────────────────
    bot.onText(/\/help/, async (msg) => {
        await upsertTextPanel(
            bot,
            msg.chat.id,
            buildHelpText(),
            {
                parse_mode: 'Markdown',
                reply_markup: menuBackKeyboard(),
            },
            { sourceMessageId: msg.message_id }
        );
    });

    // ─── Text/media message handler (deposit amount + payment proof) ──────────
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = String(msg.from?.id);
        const session = getSession(chatId);

        if (session.step === 'AWAIT_WEB_LINK_CODE' && msg.text && !msg.text.startsWith('/')) {
            const code = msg.text.replace(/[^\d]/g, '');
            if (!/^\d{6}$/.test(code)) {
                await upsertTextPanel(
                    bot,
                    chatId,
                    `❗ *Kode belum valid*\n\nKodenya harus *6 digit angka*.\nSilakan balas prompt sekali lagi dengan kode dari dashboard web.`,
                    { parse_mode: 'Markdown' },
                    { sourceMessageId: msg.message_id }
                );
                await clearReplyPrompt(bot, chatId);
                await sendReplyPrompt(
                    bot,
                    chatId,
                    '🔢 Balas pesan ini dengan kode link 6 digit dari dashboard web.',
                    'Ketik kode 6 digit',
                    msg.message_id
                );
                return;
            }
            await clearReplyPrompt(bot, chatId);
            await handleWebLinkCode(bot, msg, code);
            return;
        }

        if (session.step === 'AWAIT_PAYMENT_PROOF') {
            session.step = undefined;
            await upsertTextPanel(
                bot,
                chatId,
                'ℹ️ Bukti transfer tidak perlu dikirim lagi. Deposit sekarang diproses otomatis oleh BAYAR GG. Setelah pembayaran berhasil, saldo akan bertambah otomatis.',
                undefined,
                { sourceMessageId: msg.message_id }
            );
            return;
        }

        if (!msg.text || msg.text.startsWith('/')) return;

        if (session.step === 'AWAIT_DEPOSIT_AMOUNT') {
            const paymentSettings = await getPaymentSettings();
            const amount = parseInt(msg.text.replace(/[^\d]/g, ''));
            if (isNaN(amount) || amount < paymentSettings.minimumDeposit) {
                await upsertTextPanel(
                    bot,
                    chatId,
                    `❗ *Nominal belum valid*\n\nMasukkan jumlah minimal *${formatRupiah(paymentSettings.minimumDeposit)}*.\nContoh: \`50000\``,
                    { parse_mode: 'Markdown' },
                    { sourceMessageId: msg.message_id }
                );
                await clearReplyPrompt(bot, chatId);
                await sendReplyPrompt(
                    bot,
                    chatId,
                    `💬 Balas pesan ini dengan nominal deposit.\nMinimal ${formatRupiah(paymentSettings.minimumDeposit)}.`,
                    'Ketik nominal deposit',
                    msg.message_id
                );
                return;
            }
            session.step = undefined;
            await clearReplyPrompt(bot, chatId);
            await handleDepositWithAmount(bot, chatId, telegramId, amount, msg.message_id);
        }
    });

    // ─── Callback query handler ───────────────────────────────────────────────
    bot.on('callback_query', async (query) => {
        const chatId = query.message?.chat.id;
        const telegramId = String(query.from.id);
        const data = query.data ?? '';

        if (!chatId) return;
        await bot.answerCallbackQuery(query.id);

        if (data.startsWith('pay_ok:') || data.startsWith('pay_no:')) {
            return bot.sendMessage(
                chatId,
                'ℹ️ Konfirmasi manual deposit sudah tidak dipakai lagi. Deposit sekarang diproses otomatis oleh BAYAR GG setelah pembayaran terdeteksi.'
            );
        }

        if (data === 'menu') {
            const existingPanelId = getSession(chatId).panelMessageId ?? query.message?.message_id;
            clearSession(chatId);
            return sendMainMenu(bot, chatId, existingPanelId);
        }

        if (data === 'buy') return handleBuyStart(bot, chatId, query.message?.message_id);
        if (data === 'balance') return handleBalance(bot, chatId, telegramId, undefined, query.message?.message_id);
        if (data === 'history') return handleHistory(bot, chatId, telegramId, undefined, query.message?.message_id);
        if (data === 'deposit') return askDepositAmount(bot, chatId, undefined, query.message?.message_id);
        if (data === 'linked') {
            const session = getSession(chatId);
            session.pendingWebLink = true;
            session.step = 'AWAIT_WEB_LINK_CODE';
            await upsertTextPanel(
                bot,
                chatId,
                `🔗 *Tautkan Akun Web NokosHUB*\n\n` +
                `1. Buka dashboard web\n` +
                `2. Masuk ke menu *Profil / Setelan*\n` +
                `3. Tekan *Buat Kode Link Telegram*\n` +
                `4. Balas prompt dengan kode 6 digit dari web`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: menuBackKeyboard(),
                },
                { targetMessageId: query.message?.message_id }
            );
            return sendReplyPrompt(
                bot,
                chatId,
                '🔢 Balas pesan ini dengan kode link 6 digit dari dashboard web.',
                'Ketik kode 6 digit',
                query.message?.message_id
            );
        }
        if (data === 'help') {
            return upsertTextPanel(
                bot,
                chatId,
                buildHelpText(),
                {
                    parse_mode: 'Markdown',
                    reply_markup: menuBackKeyboard(),
                },
                { targetMessageId: query.message?.message_id }
            );
        }

        // Quick deposit amount buttons
        if (data.startsWith('DEPOSIT_')) {
            const paymentSettings = await getPaymentSettings();
            const amount = parseInt(data.replace('DEPOSIT_', ''));
            if (!isNaN(amount) && amount >= paymentSettings.minimumDeposit) {
                return handleDepositWithAmount(bot, chatId, telegramId, amount, undefined, query.message?.message_id);
            }
            return upsertTextPanel(
                bot,
                chatId,
                `❗ Minimum deposit saat ini ${formatRupiah(paymentSettings.minimumDeposit)}.`,
                {},
                { targetMessageId: query.message?.message_id }
            );
        }

        if (data === 'back_services') {
            const session = getSession(chatId);
            if (!session.selectedServerKey || !session.selectedServerLabel) {
                return handleBuyStart(bot, chatId, query.message?.message_id);
            }
            return handleServerSelected(
                bot,
                chatId,
                session.selectedServerKey,
                session.selectedServerLabel,
                0,
                query.message?.message_id
            );
        }

        if (data === 'back_countries') {
            const session = getSession(chatId);
            if (!session.selectedServiceId || !session.selectedServiceName) {
                return handleBuyStart(bot, chatId, query.message?.message_id);
            }
            return handleServiceSelected(
                bot,
                chatId,
                session.selectedServiceId,
                session.selectedServiceName,
                0,
                query.message?.message_id
            );
        }

        // Pagination for services
        if (data.startsWith('page_svc:')) {
            const [, pageStr] = data.split(':');
            const session = getSession(chatId);
            if (!session.selectedServerKey || !session.selectedServerLabel) {
                return upsertTextPanel(bot, chatId, '❌ Sesi kadaluarsa. Mulai ulang dari /buy', {}, { targetMessageId: query.message?.message_id });
            }
            return handleServerSelected(
                bot,
                chatId,
                session.selectedServerKey,
                session.selectedServerLabel,
                parseInt(pageStr),
                query.message?.message_id
            );
        }

        // Pagination for countries
        if (data.startsWith('page_ctr:')) {
            const [, pageStr] = data.split(':');
            const session = getSession(chatId);
            if (!session.selectedServiceId || !session.selectedServiceName) {
                return upsertTextPanel(bot, chatId, '❌ Sesi kadaluarsa. Mulai ulang dari /buy', {}, { targetMessageId: query.message?.message_id });
            }
            return handleServiceSelected(
                bot,
                chatId,
                session.selectedServiceId,
                session.selectedServiceName,
                parseInt(pageStr),
                query.message?.message_id
            );
        }

        // Pagination for prices
        if (data.startsWith('page_prc:')) {
            const [, pageStr] = data.split(':');
            const session = getSession(chatId);
            if (!session.selectedCountryId || !session.selectedCountryName) {
                return upsertTextPanel(bot, chatId, '❌ Sesi kadaluarsa. Mulai ulang dari /buy', {}, { targetMessageId: query.message?.message_id });
            }
            return handleCountrySelected(
                bot,
                chatId,
                telegramId,
                session.selectedCountryId,
                session.selectedCountryName,
                parseInt(pageStr),
                query.message?.message_id
            );
        }

        if (data.startsWith('service:')) {
            const [, serviceId, ...nameParts] = data.split(':');
            const serviceName = nameParts.join(':');
            return handleServiceSelected(bot, chatId, serviceId, serviceName, 0, query.message?.message_id);
        }

        if (data.startsWith('server:')) {
            const [, serverKey, ...labelParts] = data.split(':');
            const serverLabel = labelParts.join(':');
            return handleServerSelected(bot, chatId, serverKey, serverLabel, 0, query.message?.message_id);
        }

        if (data.startsWith('country:')) {
            const [, countryId, ...nameParts] = data.split(':');
            const countryName = nameParts.join(':');
            return handleCountrySelected(bot, chatId, telegramId, countryId, countryName, 0, query.message?.message_id);
        }

        if (data.startsWith('price:')) {
            const [, priceId] = data.split(':');
            return handlePriceSelected(bot, chatId, telegramId, priceId, undefined, query.message?.message_id);
        }

        if (data.startsWith('cancel_order:')) {
            const [, orderId] = data.split(':');
            return handleCancelOrder(bot, chatId, telegramId, orderId, query.message?.message_id);
        }
    });

    logger.info('🤖 Telegram bot started');
    return bot;
}

function scheduleBotCommandsSetup(bot: TelegramBot, attempt = 1) {
    Promise.all([
        bot.setMyCommands(BOT_COMMANDS),
        maintenanceService.getSettings()
            .then((settings) => bot.setMyDescription({ description: buildBotDescription(settings) }))
            .catch(() => bot.setMyDescription({ description: buildBotDescription() })),
        bot.setMyShortDescription({ short_description: buildBotShortDescription() }),
    ])
        .then(() => logger.info({ attempt }, 'Telegram bot profile and commands set'))
        .catch((err: any) => {
            if (!isTelegramNetworkIssue(err)) {
                logger.error(summarizeTelegramError(err), 'Failed to set bot profile or commands');
                return;
            }

            const retryMs = Math.min(TELEGRAM_COMMANDS_RETRY_MAX_MS, attempt * 15000);
            logger.warn(
                {
                    ...summarizeTelegramNetworkIssue(err),
                    attempt,
                    retryMs,
                },
                'Telegram bot profile setup delayed; retrying automatically'
            );
            setTimeout(() => scheduleBotCommandsSetup(bot, attempt + 1), retryMs);
        });
}

function logTelegramNetworkWarning(err: any, message: string) {
    const now = Date.now();
    if (now - lastTelegramNetworkWarningAt < TELEGRAM_NETWORK_WARNING_INTERVAL_MS) return;

    lastTelegramNetworkWarningAt = now;
    logger.warn(summarizeTelegramNetworkIssue(err), message);
}

function summarizeTelegramNetworkIssue(err: any) {
    return {
        code: 'TELEGRAM_NETWORK_TIMEOUT',
        retryable: true,
        networkCodes: extractTelegramNetworkCodes(err),
    };
}

function summarizeTelegramError(err: any, includeStack = true) {
    return {
        code: err?.code,
        message: redactTelegramToken(err?.message),
        response: redactTelegramToken(err?.response?.body ?? err?.response?.data),
        cause: err?.cause
            ? {
                code: err.cause.code,
                message: redactTelegramToken(err.cause.message),
            }
            : undefined,
        errors: redactTelegramToken(err?.errors),
        stack: includeStack ? redactTelegramToken(err?.stack) : undefined,
    };
}

function isTelegramNetworkIssue(err: any): boolean {
    const text = collectTelegramErrorText(err).toUpperCase();
    return [
        'ETIMEDOUT',
        'ESOCKETTIMEDOUT',
        'ECONNRESET',
        'ECONNREFUSED',
        'ENOTFOUND',
        'EAI_AGAIN',
        'AGGREGATEERROR',
        'TLSWRAP',
        'SOCKET',
    ].some((needle) => text.includes(needle));
}

function collectTelegramErrorText(err: any): string {
    const parts: string[] = [];

    function visit(value: any, depth = 0) {
        if (!value || depth > 3) return;

        if (typeof value === 'string') {
            parts.push(value);
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((item) => visit(item, depth + 1));
            return;
        }

        if (typeof value !== 'object') return;

        parts.push(
            String(value.code ?? ''),
            String(value.message ?? ''),
            String(value.stack ?? '')
        );

        visit(value.cause, depth + 1);
        visit(value.errors, depth + 1);
        visit(value.response?.body ?? value.response?.data, depth + 1);
    }

    visit(err);
    return parts.filter(Boolean).join(' ');
}

function extractTelegramNetworkCodes(err: any): string[] {
    const codes = new Set<string>();

    function visit(value: any, depth = 0) {
        if (!value || depth > 3) return;

        if (Array.isArray(value)) {
            value.forEach((item) => visit(item, depth + 1));
            return;
        }

        if (typeof value !== 'object') return;

        const code = String(value.code ?? '').toUpperCase();
        if (
            code &&
            code !== 'EFATAL' &&
            [
                'ETIMEDOUT',
                'ESOCKETTIMEDOUT',
                'ECONNRESET',
                'ECONNREFUSED',
                'ENOTFOUND',
                'EAI_AGAIN',
            ].includes(code)
        ) {
            codes.add(code);
        }

        visit(value.cause, depth + 1);
        visit(value.errors, depth + 1);
    }

    visit(err);
    return [...codes];
}

function redactTelegramToken(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>');
    }

    if (Array.isArray(value)) return value.map(redactTelegramToken);

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, item]) => [
                key,
                redactTelegramToken(item),
            ])
        );
    }

    return value;
}

// ─── Helper UI Functions ──────────────────────────────────────────────────────

function mainMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🛒 Beli Nomor', callback_data: 'buy' },
                { text: '💳 Deposit', callback_data: 'deposit' },
            ],
            [
                { text: '💰 Saldo Saya', callback_data: 'balance' },
                { text: '📦 Riwayat', callback_data: 'history' },
            ],
            [
                { text: '🔗 Tautkan Akun Web', callback_data: 'linked' },
                { text: '🆘 Bantuan', callback_data: 'help' },
            ],
        ],
    };
}

async function sendMainMenu(
    bot: TelegramBot,
    chatId: number,
    messageId?: number,
    sourceMessageId?: number,
    profileInput?: {
        telegramId?: string;
        username?: string;
        firstName?: string;
        lastName?: string;
    }
) {
    const telegramId = profileInput?.telegramId ?? String(chatId);

    try {
        const session = await getTelegramUserSession(telegramId, {
            username: profileInput?.username,
            firstName: profileInput?.firstName,
            lastName: profileInput?.lastName,
        });
        const displayName = escapeTelegramMarkdown(formatTelegramDisplayName({
            firstName: session.firstName ?? profileInput?.firstName,
            lastName: session.lastName ?? profileInput?.lastName,
            username: session.username ?? profileInput?.username,
            fallback: 'Pelanggan',
        }));
        const usernameText = session.username ? `@${escapeTelegramMarkdown(session.username)}` : 'Belum ada username';
        const supportText = escapeTelegramMarkdown(TELEGRAM_SUPPORT_HANDLE);
        const greeting = escapeTelegramMarkdown(getTimeGreeting());

        await upsertTextPanel(
            bot,
            chatId,
            `${greeting}, *${displayName}* 👋\n\n` +
            `🏪 *NokosHUB Auto Order*\n\n` +
            `🆔 *Profil Anda*\n` +
            `• ID: \`${telegramId}\`\n` +
            `• Username: ${usernameText}\n` +
            `• Saldo: *${formatRupiah(session.balance ?? 0)}*\n\n` +
            `🛠 *Info Maintenance*\n` +
            `${escapeTelegramMarkdown(config.TELEGRAM_MAINTENANCE_NOTICE)}\n\n` +
            `📞 *Customer Service*\n` +
            `${supportText}\n\n` +
            `Pilih menu di bawah untuk melanjutkan.`,
            {
                parse_mode: 'Markdown',
                reply_markup: mainMenuKeyboard(),
            },
            { sourceMessageId, targetMessageId: messageId }
        );
    } catch {
        await upsertTextPanel(
            bot,
            chatId,
            `🏪 *NokosHUB Auto Order*\n\n` +
            `🆔 ID Telegram: \`${telegramId}\`\n` +
            `📞 Customer Service: ${escapeTelegramMarkdown(TELEGRAM_SUPPORT_HANDLE)}\n\n` +
            `Pilih menu di bawah untuk melanjutkan.`,
            {
                parse_mode: 'Markdown',
                reply_markup: mainMenuKeyboard(),
            },
            { sourceMessageId, targetMessageId: messageId }
        );
    }
}

// ─── Flow Handlers ────────────────────────────────────────────────────────────

async function handleBalance(
    bot: TelegramBot,
    chatId: number,
    telegramId: string,
    sourceMessageId?: number,
    messageId?: number
) {
    try {
        const res = await apiGet('/api/user/balance', { telegramId });
        const balance = res.data?.balance ?? 0;
        await upsertTextPanel(
            bot,
            chatId,
            `💰 *Saldo Anda*\n\n${formatRupiah(balance)}\n\nGunakan menu deposit jika ingin menambah saldo.`,
            {
                parse_mode: 'Markdown',
                reply_markup: menuBackKeyboard(),
            },
            { sourceMessageId, targetMessageId: messageId }
        );
    } catch {
        await upsertTextPanel(bot, chatId, '❌ Gagal mengambil saldo. Coba lagi.', {}, { sourceMessageId, targetMessageId: messageId });
    }
}

async function handleHistory(
    bot: TelegramBot,
    chatId: number,
    telegramId: string,
    sourceMessageId?: number,
    messageId?: number
) {
    try {
        const res = await apiGet('/api/orders', { telegramId });
        const orders: any[] = res.data ?? [];

        if (!orders.length) {
            return upsertTextPanel(bot, chatId, 'Belum ada riwayat order.', {}, { sourceMessageId, targetMessageId: messageId });
        }

        const statusEmoji: Record<string, string> = {
            PENDING: '⏳',
            ACTIVE: '🔄',
            SUCCESS: '✅',
            FAILED: '❌',
            CANCELLED: '🚫',
        };

        const lines = orders.slice(0, 5).map((o: any, i: number) => {
            const emoji = statusEmoji[o.status] ?? '❓';
            const service = o.price?.service?.name ?? '-';
            const country = o.price?.country?.name ?? '-';
            const phone = o.phoneNumber ?? '-';
            const otp = o.otpCode ? `\n   OTP: \`${o.otpCode}\`` : '';
            return `${i + 1}. ${emoji} ${service} (${country})\n   📞 ${phone}${otp}\n   ID: \`${o.id}\``;
        });

        await upsertTextPanel(
            bot,
            chatId,
            `📋 *Riwayat 5 Order Terakhir*\n\n${lines.join('\n\n')}`,
            {
                parse_mode: 'Markdown',
                reply_markup: menuBackKeyboard(),
            },
            { sourceMessageId, targetMessageId: messageId }
        );
    } catch {
        await upsertTextPanel(bot, chatId, '❌ Gagal mengambil riwayat. Coba lagi.', {}, { sourceMessageId, targetMessageId: messageId });
    }
}

async function handleBuyStart(
    bot: TelegramBot,
    chatId: number,
    messageId?: number,
    sourceMessageId?: number
) {
    const session = getSession(chatId);
    resetBuySelection(session);

    const rows = BUY_SERVER_OPTIONS.map((server) => ([
        {
            text: `${server.label}`,
            callback_data: `server:${server.key}:${server.label}`,
        },
    ]));

    rows.push([{ text: '⬅️ Kembali ke Menu', callback_data: 'menu' }]);

    const text =
        `🛒 *Beli Nomor OTP*\n\n` +
        `Sebelum memilih layanan, silakan pilih server terlebih dahulu.\n\n` +
        BUY_SERVER_OPTIONS.map((server, index) => `${index + 1}. *${server.label}* — ${server.description}`).join('\n');

    const options: any = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows },
    };

    await upsertTextPanel(bot, chatId, text, options, { sourceMessageId, targetMessageId: messageId });
}

async function handleServerSelected(
    bot: TelegramBot,
    chatId: number,
    serverKey: string,
    serverLabel: string,
    page: number = 0,
    messageId?: number
) {
    const session = getSession(chatId);
    session.selectedServerKey = serverKey;
    session.selectedServerLabel = serverLabel;
    session.selectedServiceId = undefined;
    session.selectedServiceName = undefined;
    session.selectedCountryId = undefined;
    session.selectedCountryName = undefined;
    session.prices = undefined;

    try {
        const res = await apiGet('/api/services');
        const services: any[] = (res.data ?? [])
            .filter((service: any) => service.providerKey === serverKey)
            .sort((a: any, b: any) => {
                const popularA = popularServiceScore(a.name);
                const popularB = popularServiceScore(b.name);
                if (popularA !== popularB) return popularA - popularB;
                return String(a.name || '').localeCompare(String(b.name || ''));
            });

        if (!services.length) {
            return upsertTextPanel(
                bot,
                chatId,
                `❌ Tidak ada layanan tersedia untuk *${serverLabel}* saat ini.`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⬅️ Pilih Server Lain', callback_data: 'buy' }],
                            [{ text: '⬅️ Kembali ke Menu', callback_data: 'menu' }],
                        ],
                    },
                },
                { targetMessageId: messageId }
            );
        }

        const ITEMS_PER_PAGE = 10;
        const totalPages = Math.ceil(services.length / ITEMS_PER_PAGE);
        const paginated = services.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

        // Build inline keyboard, max 2 per row
        const buttons = paginated.map((s: any) => ({
            text: s.name,
            callback_data: `service:${s.id}:${s.name}`,
        }));

        const rows = [];
        for (let i = 0; i < buttons.length; i += 2) {
            rows.push(buttons.slice(i, i + 2));
        }

        const navRow = [];
        if (page > 0) {
            navRow.push({ text: '⬅️ Prev', callback_data: `page_svc:${page - 1}` });
        }
        if (page < totalPages - 1) {
            navRow.push({ text: 'Next ➡️', callback_data: `page_svc:${page + 1}` });
        }
        if (navRow.length > 0) {
            rows.push(navRow);
        }
        rows.push([
            { text: '⬅️ Ganti Server', callback_data: 'buy' },
            { text: '🏠 Menu', callback_data: 'menu' },
        ]);

        const text =
            `📲 *Pilih Aplikasi*\n\n` +
            `Server: *${serverLabel}*\n` +
            `Pilih aplikasi yang ingin kamu verifikasi.\n\n` +
            `_Halaman ${page + 1} dari ${totalPages}_`;
        const options: any = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } };
        await upsertTextPanel(bot, chatId, text, options, { targetMessageId: messageId });
    } catch {
        await upsertTextPanel(bot, chatId, '❌ Gagal memuat daftar layanan. Coba lagi.', {}, { targetMessageId: messageId });
    }
}

async function handleServiceSelected(
    bot: TelegramBot,
    chatId: number,
    serviceId: string,
    serviceName: string,
    page: number = 0,
    messageId?: number
) {
    const session = getSession(chatId);
    session.selectedServiceId = serviceId;
    session.selectedServiceName = serviceName;
    session.selectedCountryId = undefined;
    session.selectedCountryName = undefined;
    session.prices = undefined;
    const serverLabel = session.selectedServerLabel || 'Server';

    try {
        const res = await apiGet('/api/countries', { serviceId });
        const countries: any[] = res.data ?? [];

        if (!countries.length) {
                return upsertTextPanel(bot, chatId, `❌ Tidak ada negara tersedia untuk ${serviceName}.`, {}, { targetMessageId: messageId });
        }

        const ITEMS_PER_PAGE = 16;
        const totalPages = Math.ceil(countries.length / ITEMS_PER_PAGE);
        const paginated = countries.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

        const buttons = paginated.map((c: any) => ({
            text: c.name,
            callback_data: `country:${c.id}:${c.name}`,
        }));

        const rows = [];
        for (let i = 0; i < buttons.length; i += 2) {
            rows.push(buttons.slice(i, i + 2));
        }

        const navRow = [];
        if (page > 0) {
            navRow.push({ text: '⬅️ Prev', callback_data: `page_ctr:${page - 1}` });
        }
        if (page < totalPages - 1) {
            navRow.push({ text: 'Next ➡️', callback_data: `page_ctr:${page + 1}` });
        }
        if (navRow.length > 0) {
            rows.push(navRow);
        }
        rows.push([
            { text: '⬅️ Ganti Layanan', callback_data: 'back_services' },
            { text: '🏠 Menu', callback_data: 'menu' },
        ]);

        const text =
            `🌍 *Pilih Negara*\n\n` +
            `Server: *${serverLabel}*\n` +
            `Layanan: *${serviceName}*\n` +
            `_Halaman ${page + 1} dari ${totalPages}_\n\n` +
            `Pilih negara yang tersedia:`;
        const options: any = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } };
        await upsertTextPanel(bot, chatId, text, options, { targetMessageId: messageId });
    } catch {
        await upsertTextPanel(bot, chatId, '❌ Gagal memuat daftar negara. Coba lagi.', {}, { targetMessageId: messageId });
    }
}

async function handleCountrySelected(
    bot: TelegramBot,
    chatId: number,
    telegramId: string,
    countryId: string,
    countryName: string,
    page: number = 0,
    messageId?: number
) {
    const session = getSession(chatId);
    const serviceId = session.selectedServiceId;
    const serviceName = session.selectedServiceName;
    const serverLabel = session.selectedServerLabel || 'Server';

    if (!serviceId) {
        return upsertTextPanel(bot, chatId, '❌ Sesi tidak valid. Mulai ulang dari /buy', {}, { targetMessageId: messageId });
    }

    session.selectedCountryId = countryId;
    session.selectedCountryName = countryName;

    try {
        const res = await apiGet('/api/prices', { serviceId, countryId });
        const prices: Array<{ id: string; sellPrice: number }> = res.data ?? [];

        if (!prices.length) {
            return upsertTextPanel(bot, chatId, `❌ Tidak ada harga tersedia untuk ${serviceName} di ${countryName}.`, {}, { targetMessageId: messageId });
        }

        // Store prices in session
        session.prices = prices;

        const ITEMS_PER_PAGE = 4;
        const totalPages = Math.ceil(prices.length / ITEMS_PER_PAGE);
        const paginated = prices.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

        // Check user balance
        const balRes = await apiGet('/api/user/balance', { telegramId });
        const balance = balRes.data?.balance ?? 0;

        // Build buttons
        const rows = paginated.map((p, i) => {
            const indexStr = `${(page * ITEMS_PER_PAGE) + i + 1}.`;
            return [{
                text: `${indexStr} ${formatRupiah(p.sellPrice)}`,
                callback_data: `price:${p.id}`,
            }];
        });

        const navRow = [];
        if (page > 0) {
            navRow.push({ text: '⬅️ Prev', callback_data: `page_prc:${page - 1}` });
        }
        if (page < totalPages - 1) {
            navRow.push({ text: 'Next ➡️', callback_data: `page_prc:${page + 1}` });
        }
        if (navRow.length > 0) {
            rows.push(navRow);
        }
        rows.push([
            { text: '⬅️ Ganti Negara', callback_data: 'back_countries' },
            { text: '🏠 Menu', callback_data: 'menu' },
        ]);

        const text = `💳 *${serviceName} ${countryName}*\n\n` +
            `Server: *${serverLabel}*\n` +
            `Saldo kamu: *${formatRupiah(balance)}*\n_Halaman ${page + 1} dari ${totalPages}_\n\n` +
            `Pilih harga nomor (termurah ke termahal):`;

        const options: any = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } };
        await upsertTextPanel(bot, chatId, text, options, { targetMessageId: messageId });
    } catch {
        await upsertTextPanel(bot, chatId, '❌ Gagal memuat harga. Coba lagi.', {}, { targetMessageId: messageId });
    }
}

async function handlePriceSelected(
    bot: TelegramBot,
    chatId: number,
    telegramId: string,
    priceId: string,
    sourceMessageId?: number,
    messageId?: number
) {
    await upsertTextPanel(
        bot,
        chatId,
        '⏳ *Memproses pesanan...*\n\nMohon tunggu sebentar, kami sedang memesan nomor untuk kamu.',
        { parse_mode: 'Markdown' },
        { sourceMessageId, targetMessageId: messageId }
    );

    try {
        const res = await apiPost('/api/order', { priceId, telegramId });

        if (!res.success) {
            return upsertTextPanel(bot, chatId, `❌ Gagal memesan: ${res.error}`);
        }

        const { orderId, phoneNumber } = res.data;

        clearSession(chatId);

        await upsertTextPanel(
            bot,
            chatId,
            `✅ *Nomor berhasil dipesan!*\n\n` +
            `📞 Nomor Anda:\n\`${phoneNumber}\`\n\n` +
            `🆔 Order ID: \`${orderId}\`\n\n` +
            `⏳ Sistem sedang menunggu OTP. Kode akan dikirim otomatis ke sini.\n` +
            `_Maksimal menunggu 20 menit._\n` +
            `_Pembatalan manual tersedia setelah 2 menit jika OTP belum masuk._\n\n` +
            `Untuk membatalkan: /status ${orderId}`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 Menu Utama', callback_data: 'menu' }],
                    ],
                },
            },
            { sourceMessageId, targetMessageId: messageId }
        );
    } catch (err: any) {
        const errMsg = err?.response?.data?.error ?? err.message ?? 'Error tidak diketahui';
        await upsertTextPanel(bot, chatId, `❌ Gagal: ${errMsg}`);
    }
}

async function askDepositAmount(
    bot: TelegramBot,
    chatId: number,
    sourceMessageId?: number,
    messageId?: number
) {
    const paymentSettings = await getPaymentSettings();
    const session = getSession(chatId);
    session.step = 'AWAIT_DEPOSIT_AMOUNT';

    await upsertTextPanel(
        bot,
        chatId,
        `💳 *Deposit Saldo*\n\n` +
        `Pilih nominal cepat di bawah atau balas prompt dengan jumlah deposit.\n\n` +
        `Minimal deposit: *${formatRupiah(paymentSettings.minimumDeposit)}*\n` +
        `Contoh balasan: \`50000\``,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: `Min ${formatRupiah(paymentSettings.minimumDeposit)}`, callback_data: `DEPOSIT_${paymentSettings.minimumDeposit}` },
                        { text: 'Rp20.000', callback_data: 'DEPOSIT_20000' },
                    ],
                    [
                        { text: 'Rp50.000', callback_data: 'DEPOSIT_50000' },
                        { text: 'Rp100.000', callback_data: 'DEPOSIT_100000' },
                    ],
                    [
                        { text: '⬅️ Kembali ke Menu', callback_data: 'menu' },
                    ],
                ],
            },
        },
        { sourceMessageId, targetMessageId: messageId }
    );
    await sendReplyPrompt(
        bot,
        chatId,
        `💬 Balas pesan ini dengan nominal deposit.\nMinimal ${formatRupiah(paymentSettings.minimumDeposit)}.`,
        'Ketik nominal deposit',
        sourceMessageId
    );
}

async function handleDepositWithAmount(
    bot: TelegramBot,
    chatId: number,
    telegramId: string,
    amount: number,
    sourceMessageId?: number,
    messageId?: number
) {
    await upsertTextPanel(
        bot,
        chatId,
        `⏳ *Membuat invoice ${formatRupiah(amount)}...*\n\nMohon tunggu sebentar.`,
        { parse_mode: 'Markdown' },
        { sourceMessageId, targetMessageId: messageId }
    );

    try {
        const res = await apiPost('/api/deposit', { amount, telegramId });

        if (!res.success) {
            return upsertTextPanel(bot, chatId, `❌ Gagal membuat invoice: ${res.error}`);
        }

        const { invoiceId, qrisPayload, qrisImageUrl, expiredAt, amount: payableAmount, paymentUrl, fee, baseAmount } = res.data;

        const caption =
            `💳 *Invoice Deposit*\n\n` +
            `Jumlah deposit: *${formatRupiah(baseAmount ?? amount)}*\n` +
            `Biaya gateway: *${formatRupiah(fee ?? 0)}*\n` +
            `Nominal bayar: *${formatRupiah(payableAmount)}*\n` +
            `Invoice ID: \`${invoiceId}\`\n` +
            `Expires: ${new Date(expiredAt).toLocaleString('id-ID')}\n\n` +
            `📌 Scan QR di atas, lalu bayar sesuai nominal bayar persis.\n` +
            `${paymentUrl ? `🌐 Link bayar: ${paymentUrl}\n\n` : ''}` +
            `_Saldo akan ditambahkan otomatis setelah pembayaran terdeteksi._`;

        if (qrisImageUrl) {
            await upsertPhotoPanel(bot, chatId, qrisImageUrl, {
                caption,
                parse_mode: 'Markdown',
            }, { sourceMessageId });
        } else if (qrisPayload) {
            const qrBuffer = await QRCode.toBuffer(qrisPayload, {
                type: 'png',
                width: 900,
                margin: 4,
                errorCorrectionLevel: 'H',
                color: {
                    dark: '#000000',
                    light: '#FFFFFF',
                },
            });

            await upsertPhotoPanel(bot, chatId, qrBuffer as any, {
                caption,
                parse_mode: 'Markdown',
            }, { sourceMessageId });
        } else {
            await upsertTextPanel(bot, chatId, caption, {
                parse_mode: 'Markdown',
            }, { sourceMessageId });
        }

        const session = getSession(chatId);
        session.step = undefined;
        session.pendingDeposit = {
            invoiceId,
            telegramId,
            requestedAmount: amount,
            payableAmount,
            expiredAt,
        };
    } catch (err: any) {
        const errMsg = err?.response?.data?.error ?? err.message ?? 'Error';
        await upsertTextPanel(bot, chatId, `❌ Gagal: ${errMsg}`);
    }
}

function getPaymentProofFromMessage(msg: TelegramBot.Message): PaymentProof | null {
    const photo = msg.photo?.[msg.photo.length - 1];
    if (photo?.file_id) {
        return { fileId: photo.file_id, type: 'photo' };
    }

    const document = msg.document;
    if (document?.file_id && document.mime_type?.startsWith('image/')) {
        return { fileId: document.file_id, type: 'document' };
    }

    return null;
}

async function notifyAdminsManualDeposit(
    bot: TelegramBot,
    deposit: PendingDeposit,
    proof: PaymentProof
): Promise<boolean> {
    if (!TELEGRAM_ADMIN_IDS.length) {
        logger.warn({ invoiceId: deposit.invoiceId }, 'Manual payment proof received but TELEGRAM_ADMIN_IDS is empty');
        return false;
    }

    const caption =
        `🔔 Deposit baru menunggu konfirmasi manual\n\n` +
        `Invoice ID: ${deposit.invoiceId}\n` +
        `Telegram ID user: ${deposit.telegramId}\n` +
        `Jumlah saldo: ${formatRupiah(deposit.requestedAmount)}\n` +
        `Nominal QRIS: ${formatRupiah(deposit.payableAmount)}\n` +
        `Kadaluarsa: ${formatIndonesianDateTime(deposit.expiredAt)}\n\n` +
        `Bukti transfer terlampir. Cek mutasi/payment dulu. Jika uang sudah masuk sesuai nominal QRIS, tekan Konfirmasi.`;

    const reply_markup = {
        inline_keyboard: [
            [{ text: '✅ Konfirmasi saldo masuk', callback_data: `pay_ok:${deposit.invoiceId}:${deposit.telegramId}` }],
            [{ text: '❌ Belum masuk', callback_data: `pay_no:${deposit.invoiceId}:${deposit.telegramId}` }],
        ],
    };

    let sentCount = 0;

    for (const adminId of TELEGRAM_ADMIN_IDS) {
        try {
            if (proof.type === 'document') {
                await bot.sendDocument(Number(adminId), proof.fileId, { caption, reply_markup });
            } else {
                await bot.sendPhoto(Number(adminId), proof.fileId, { caption, reply_markup });
            }
            sentCount += 1;
        } catch (err) {
            logger.warn({ err, adminId, invoiceId: deposit.invoiceId }, 'Failed to notify Telegram admin for manual payment');
        }
    }

    return sentCount > 0;
}

async function handleManualPaymentApproval(
    bot: TelegramBot,
    adminChatId: number,
    adminTelegramId: string,
    invoiceId?: string,
    userTelegramId?: string,
    adminMessageId?: number
) {
    if (!isAdminTelegramId(adminTelegramId)) {
        logger.warn({ adminTelegramId, invoiceId }, 'Unauthorized manual payment approval attempt');
        return bot.sendMessage(adminChatId, '❌ Akun Telegram ini tidak berhak mengonfirmasi pembayaran.');
    }

    if (!invoiceId || !userTelegramId) {
        return bot.sendMessage(adminChatId, '❌ Data invoice tidak valid.');
    }

    try {
        const result = await apiPost<{ success: boolean; message?: string }>('/api/payment/webhook', {
            invoiceId,
            secret: config.PAYMENT_WEBHOOK_SECRET,
        });

        await clearManualPaymentButtons(bot, adminChatId, adminMessageId);

        await bot.sendMessage(
            adminChatId,
            `✅ Invoice ${invoiceId} sudah dikonfirmasi.\nStatus: ${result.message ?? 'Payment confirmed'}`
        );

        if (/^\d+$/.test(String(userTelegramId || '').trim())) {
            await bot.sendMessage(
                Number(userTelegramId),
                `✅ Pembayaran deposit Anda sudah dikonfirmasi admin.\n\n` +
                `Invoice ID: \`${invoiceId}\`\n` +
                `Saldo sudah ditambahkan ke akun Anda. Cek saldo dengan /balance.`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (err: any) {
        const errMsg = err?.response?.data?.message ?? err?.response?.data?.error ?? err.message ?? 'Error';
        await bot.sendMessage(adminChatId, `❌ Gagal konfirmasi invoice ${invoiceId}: ${errMsg}`);
    }
}

async function handleManualPaymentReject(
    bot: TelegramBot,
    adminChatId: number,
    adminTelegramId: string,
    invoiceId?: string,
    userTelegramId?: string,
    adminMessageId?: number
) {
    if (!isAdminTelegramId(adminTelegramId)) {
        logger.warn({ adminTelegramId, invoiceId }, 'Unauthorized manual payment reject attempt');
        return bot.sendMessage(adminChatId, '❌ Akun Telegram ini tidak berhak memproses pembayaran.');
    }

    if (!invoiceId || !userTelegramId) {
        return bot.sendMessage(adminChatId, '❌ Data invoice tidak valid.');
    }

    await clearManualPaymentButtons(bot, adminChatId, adminMessageId);
    await bot.sendMessage(
        adminChatId,
        `Invoice ${invoiceId} ditandai belum masuk. Invoice tetap pending dan saldo belum ditambahkan.`
    );

    if (/^\d+$/.test(String(userTelegramId || '').trim())) {
        try {
            await bot.sendMessage(
                Number(userTelegramId),
                `⚠️ Pembayaran untuk invoice \`${invoiceId}\` belum bisa dikonfirmasi admin.\n\n` +
                `Pastikan nominal transfer sesuai QRIS dan bukti transfer jelas. Jika sudah benar, hubungi admin.`,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            logger.warn({ err, invoiceId, userTelegramId }, 'Failed to notify user about rejected manual payment');
        }
    }
}

async function clearManualPaymentButtons(bot: TelegramBot, chatId: number, messageId?: number) {
    if (!messageId) return;

    try {
        await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
        );
    } catch (err) {
        logger.warn({ err, chatId, messageId }, 'Failed to clear manual payment buttons');
    }
}

function formatIndonesianDateTime(value: string | Date): string {
    return new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}

async function handleOrderStatus(
    bot: TelegramBot,
    chatId: number,
    orderId: string,
    sourceMessageId?: number,
    messageId?: number
) {
    try {
        const res = await apiGet(`/api/orders`, { telegramId: String(chatId) });
        const orders: any[] = res.data ?? [];
        const order = orders.find((o: any) => o.id === orderId || o.id.startsWith(orderId));

        if (!order) {
            return upsertTextPanel(
                bot,
                chatId,
                `❌ Order \`${orderId}\` tidak ditemukan.`,
                { parse_mode: 'Markdown' },
                { sourceMessageId, targetMessageId: messageId }
            );
        }

        const statusEmoji: Record<string, string> = {
            PENDING: '⏳', ACTIVE: '🔄', SUCCESS: '✅', FAILED: '❌', CANCELLED: '🚫',
        };

        const emoji = statusEmoji[order.status] ?? '❓';
        const otpLine = order.otpCode ? `\n📟 OTP: \`${order.otpCode}\`` : '';

        await upsertTextPanel(
            bot,
            chatId,
            `📦 *Status Order*\n\n` +
            `${emoji} Status: *${order.status}*\n` +
            `📞 Nomor: \`${order.phoneNumber ?? '-'}\`${otpLine}\n` +
            `🆔 ID: \`${order.id}\``,
            {
                parse_mode: 'Markdown',
                reply_markup:
                    order.status === 'ACTIVE' && !order.otpCode && Date.now() - new Date(order.createdAt).getTime() >= 120000
                        ? {
                            inline_keyboard: [
                                [{ text: '🚫 Batalkan', callback_data: `cancel_order:${order.id}` }],
                                [{ text: '⬅️ Kembali ke Menu', callback_data: 'menu' }],
                            ],
                        }
                        : menuBackKeyboard(),
            }
            ,
            { sourceMessageId, targetMessageId: messageId }
        );
    } catch {
        await upsertTextPanel(bot, chatId, '❌ Gagal mengambil status order.', {}, { sourceMessageId, targetMessageId: messageId });
    }
}

async function handleCancelOrder(
    bot: TelegramBot,
    chatId: number,
    telegramId: string,
    orderId: string,
    messageId?: number
) {
    try {
        const res = await apiPost('/api/order/cancel', { orderId, telegramId });
        if (res.success) {
            await upsertTextPanel(
                bot,
                chatId,
                `✅ Order \`${orderId}\` berhasil dibatalkan.\n\n_Refund telah dikreditkan ke saldo kamu._`,
                { parse_mode: 'Markdown' },
                { targetMessageId: messageId }
            );
        } else {
            await upsertTextPanel(bot, chatId, `❌ Gagal membatalkan: ${res.error ?? 'Unknown error'}`, {}, { targetMessageId: messageId });
        }
    } catch (err: any) {
        const errMsg = err?.response?.data?.error ?? err.message ?? 'Error';
        await upsertTextPanel(bot, chatId, `❌ Gagal membatalkan order: ${errMsg}`, {}, { targetMessageId: messageId });
    }
}
async function getPaymentSettings(): Promise<PaymentSettings> {
    if (paymentSettingsCache && paymentSettingsCache.expiresAt > Date.now()) {
        return paymentSettingsCache.value;
    }

    try {
        const res = await apiGet<{ success: boolean; data?: PaymentSettings }>('/api/settings/payment');
        const settings = {
            minimumDeposit: Number(res.data?.minimumDeposit || 10000),
            maximumDeposit: Number(res.data?.maximumDeposit || 10000000),
        };
        paymentSettingsCache = {
            value: settings,
            expiresAt: Date.now() + 60_000,
        };
        return settings;
    } catch {
        return {
            minimumDeposit: 10000,
            maximumDeposit: 10000000,
        };
    }
}
