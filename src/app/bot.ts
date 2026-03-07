import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import QRCode from 'qrcode';
import { config } from './config';
import { setNotifyHandler } from '../modules/routes/webhook.routes';
import logger from '../utils/logger';
import { formatRupiah } from '../utils/helpers';

const BASE_URL = `http://127.0.0.1:${config.PORT}`;

// ─── API Helpers ──────────────────────────────────────────────────────────────

async function apiGet<T = any>(path: string, params?: object): Promise<T> {
    const res = await axios.get(`${BASE_URL}${path}`, { params });
    return res.data;
}

async function apiPost<T = any>(path: string, data?: object): Promise<T> {
    const res = await axios.post(`${BASE_URL}${path}`, data);
    return res.data;
}

// ─── Session Storage (in-memory) ─────────────────────────────────────────────
// Holds transient state between bot steps per chat

interface Session {
    step?: string;
    selectedServiceId?: string;
    selectedServiceName?: string;
    selectedCountryId?: string;
    selectedCountryName?: string;
    prices?: Array<{ id: string; sellPrice: number }>;
    depositAmount?: number;
}

const sessions = new Map<number, Session>();

function getSession(chatId: number): Session {
    if (!sessions.has(chatId)) sessions.set(chatId, {});
    return sessions.get(chatId)!;
}

function clearSession(chatId: number) {
    sessions.set(chatId, {});
}

// ─── Bot Factory ──────────────────────────────────────────────────────────────

export function createBot(): TelegramBot {
    const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });

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
                `SMS tidak masuk dalam 2 menit.\n` +
                `📦 Order ID: \`${orderId}\`\n\n` +
                `Silakan hubungi admin jika ada masalah.`,
                { parse_mode: 'Markdown' }
            );
        }
    });

    // ─── /start ───────────────────────────────────────────────────────────────
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const firstName = msg.from?.first_name ?? 'Pengguna';
        clearSession(chatId);

        await bot.sendMessage(
            chatId,
            `🎉 *Selamat datang di NOKOS!*\n\n` +
            `Halo, *${firstName}*! 👋\n\n` +
            `NOKOS adalah layanan pembelian nomor virtual untuk kebutuhan verifikasi OTP.\n\n` +
            `Ketuk tombol di bawah untuk mulai:`,
            {
                parse_mode: 'Markdown',
                reply_markup: mainMenuKeyboard(),
            }
        );
    });

    // ─── /menu ────────────────────────────────────────────────────────────────
    bot.onText(/\/menu/, async (msg) => {
        clearSession(msg.chat.id);
        await sendMainMenu(bot, msg.chat.id);
    });

    // ─── /balance ─────────────────────────────────────────────────────────────
    bot.onText(/\/balance/, async (msg) => {
        await handleBalance(bot, msg.chat.id, String(msg.from?.id));
    });

    // ─── /history ─────────────────────────────────────────────────────────────
    bot.onText(/\/history/, async (msg) => {
        await handleHistory(bot, msg.chat.id, String(msg.from?.id));
    });

    // ─── /buy ─────────────────────────────────────────────────────────────────
    bot.onText(/\/buy/, async (msg) => {
        await handleBuyStart(bot, msg.chat.id);
    });

    // ─── /deposit ─────────────────────────────────────────────────────────────
    bot.onText(/\/deposit(?:\s+(\d+))?/, async (msg, match) => {
        const amountStr = match?.[1];
        if (amountStr) {
            await handleDepositWithAmount(bot, msg.chat.id, String(msg.from?.id), parseInt(amountStr));
        } else {
            await askDepositAmount(bot, msg.chat.id);
        }
    });

    // ─── /status ──────────────────────────────────────────────────────────────
    bot.onText(/\/status(?:\s+(.+))?/, async (msg, match) => {
        const orderId = match?.[1];
        if (!orderId) {
            return bot.sendMessage(msg.chat.id, 'Gunakan: /status <orderId>');
        }
        await handleOrderStatus(bot, msg.chat.id, orderId);
    });

    // ─── /help ────────────────────────────────────────────────────────────────
    bot.onText(/\/help/, async (msg) => {
        await bot.sendMessage(
            msg.chat.id,
            `📖 *Panduan NOKOS*\n\n` +
            `1️⃣ *Beli Nomor*\n` +
            `• Ketuk "Beli Nomor" → pilih aplikasi → pilih negara → pilih harga\n` +
            `• Sistem akan memberikan nomor virtual siap pakai\n` +
            `• OTP akan otomatis dikirim ke sini\n\n` +
            `2️⃣ *Deposit Saldo*\n` +
            `• Ketuk "Deposit Saldo" atau ketik /deposit 50000\n` +
            `• Scan QR QRIS yang tampil\n` +
            `• Saldo masuk otomatis setelah pembayaran\n\n` +
            `3️⃣ *Perintah*\n` +
            `/start - Mulai bot\n` +
            `/menu - Menu utama\n` +
            `/buy - Beli nomor\n` +
            `/deposit [jumlah] - Deposit saldo\n` +
            `/balance - Lihat saldo\n` +
            `/history - Riwayat order\n` +
            `/status [orderId] - Status order\n\n` +
            `📞 *Butuh bantuan?*\n` +
            `Hubungi admin @nokosadmin`,
            { parse_mode: 'Markdown' }
        );
    });

    // ─── Text message handler (for deposit amount input) ──────────────────────
    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/')) return;
        const chatId = msg.chat.id;
        const telegramId = String(msg.from?.id);
        const session = getSession(chatId);

        if (session.step === 'AWAIT_DEPOSIT_AMOUNT') {
            const amount = parseInt(msg.text.replace(/[^\d]/g, ''));
            if (isNaN(amount) || amount < 10000) {
                await bot.sendMessage(chatId, '❗ Masukkan jumlah minimal Rp10.000\nContoh: 50000');
                return;
            }
            session.step = undefined;
            await handleDepositWithAmount(bot, chatId, telegramId, amount);
        }
    });

    // ─── Callback query handler ───────────────────────────────────────────────
    bot.on('callback_query', async (query) => {
        const chatId = query.message?.chat.id;
        const telegramId = String(query.from.id);
        const data = query.data ?? '';

        if (!chatId) return;
        await bot.answerCallbackQuery(query.id);

        if (data === 'menu') {
            clearSession(chatId);
            return sendMainMenu(bot, chatId);
        }

        if (data === 'buy') return handleBuyStart(bot, chatId);
        if (data === 'balance') return handleBalance(bot, chatId, telegramId);
        if (data === 'history') return handleHistory(bot, chatId, telegramId);
        if (data === 'deposit') return askDepositAmount(bot, chatId);
        if (data === 'help') return bot.sendMessage(chatId, '/help');

        // Quick deposit amount buttons
        if (data.startsWith('DEPOSIT_')) {
            const amount = parseInt(data.replace('DEPOSIT_', ''));
            if (!isNaN(amount) && amount >= 10000) {
                return handleDepositWithAmount(bot, chatId, telegramId, amount);
            }
        }

        // Pagination for services
        if (data.startsWith('page_svc:')) {
            const [, pageStr] = data.split(':');
            return handleBuyStart(bot, chatId, parseInt(pageStr), query.message?.message_id);
        }

        // Pagination for countries
        if (data.startsWith('page_ctr:')) {
            const [, pageStr] = data.split(':');
            const session = getSession(chatId);
            if (!session.selectedServiceId || !session.selectedServiceName) {
                return bot.sendMessage(chatId, '❌ Sesi kadaluarsa. Mulai ulang dari /buy');
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

        if (data.startsWith('service:')) {
            const [, serviceId, ...nameParts] = data.split(':');
            const serviceName = nameParts.join(':');
            return handleServiceSelected(bot, chatId, serviceId, serviceName);
        }

        if (data.startsWith('country:')) {
            const [, countryId, ...nameParts] = data.split(':');
            const countryName = nameParts.join(':');
            return handleCountrySelected(bot, chatId, telegramId, countryId, countryName);
        }

        if (data.startsWith('price:')) {
            const [, priceId] = data.split(':');
            return handlePriceSelected(bot, chatId, telegramId, priceId);
        }

        if (data.startsWith('cancel_order:')) {
            const [, orderId] = data.split(':');
            return handleCancelOrder(bot, chatId, telegramId, orderId);
        }
    });

    logger.info('🤖 Telegram bot started');
    return bot;
}

// ─── Helper UI Functions ──────────────────────────────────────────────────────

function mainMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '1️⃣ Beli Nomor', callback_data: 'buy' },
                { text: '2️⃣ Deposit Saldo', callback_data: 'deposit' },
            ],
            [
                { text: '3️⃣ Riwayat Order', callback_data: 'history' },
                { text: '4️⃣ Bantuan', callback_data: 'help' },
            ],
            [
                { text: '💰 Cek Saldo', callback_data: 'balance' },
            ],
        ],
    };
}

async function sendMainMenu(bot: TelegramBot, chatId: number) {
    await bot.sendMessage(
        chatId,
        `📱 *Menu Utama NOKOS*\n\nPilih layanan yang kamu butuhkan:`,
        {
            parse_mode: 'Markdown',
            reply_markup: mainMenuKeyboard(),
        }
    );
}

// ─── Flow Handlers ────────────────────────────────────────────────────────────

async function handleBalance(bot: TelegramBot, chatId: number, telegramId: string) {
    try {
        const res = await apiGet('/api/user/balance', { telegramId });
        const balance = res.data?.balance ?? 0;
        await bot.sendMessage(
            chatId,
            `💰 *Saldo Anda*\n\n${formatRupiah(balance)}\n\nGunakan /deposit untuk menambah saldo.`,
            { parse_mode: 'Markdown' }
        );
    } catch {
        await bot.sendMessage(chatId, '❌ Gagal mengambil saldo. Coba lagi.');
    }
}

async function handleHistory(bot: TelegramBot, chatId: number, telegramId: string) {
    try {
        const res = await apiGet('/api/orders', { telegramId });
        const orders: any[] = res.data ?? [];

        if (!orders.length) {
            return bot.sendMessage(chatId, 'Belum ada riwayat order.');
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

        await bot.sendMessage(
            chatId,
            `📋 *Riwayat 5 Order Terakhir*\n\n${lines.join('\n\n')}`,
            { parse_mode: 'Markdown' }
        );
    } catch {
        await bot.sendMessage(chatId, '❌ Gagal mengambil riwayat. Coba lagi.');
    }
}

async function handleBuyStart(bot: TelegramBot, chatId: number, page: number = 0, messageId?: number) {
    try {
        const res = await apiGet('/api/services');
        const services: any[] = res.data ?? [];

        if (!services.length) {
            return bot.sendMessage(chatId, '❌ Tidak ada layanan tersedia saat ini.');
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

        const text = `📲 *Pilih Aplikasi*\n\nPilih aplikasi yang ingin kamu verifikasi:\n\n_Halaman ${page + 1} dari ${totalPages}_`;
        const options: any = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } };

        if (messageId) {
            options.chat_id = chatId;
            options.message_id = messageId;
            await bot.editMessageText(text, options);
        } else {
            await bot.sendMessage(chatId, text, options);
        }
    } catch {
        await bot.sendMessage(chatId, '❌ Gagal memuat daftar layanan. Coba lagi.');
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

    try {
        const res = await apiGet('/api/countries', { serviceId });
        const countries: any[] = res.data ?? [];

        if (!countries.length) {
            return bot.sendMessage(chatId, `❌ Tidak ada negara tersedia untuk ${serviceName}.`);
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

        const text = `🌍 *Pilih Negara*\n\nLayanan: *${serviceName}*\n_Halaman ${page + 1} dari ${totalPages}_\n\nPilih negara yang tersedia:`;
        const options: any = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } };

        if (messageId) {
            options.chat_id = chatId;
            options.message_id = messageId;
            await bot.editMessageText(text, options);
        } else {
            await bot.sendMessage(chatId, text, options);
        }
    } catch {
        await bot.sendMessage(chatId, '❌ Gagal memuat daftar negara. Coba lagi.');
    }
}

async function handleCountrySelected(
    bot: TelegramBot,
    chatId: number,
    telegramId: string,
    countryId: string,
    countryName: string
) {
    const session = getSession(chatId);
    const serviceId = session.selectedServiceId;
    const serviceName = session.selectedServiceName;

    if (!serviceId) {
        return bot.sendMessage(chatId, '❌ Sesi tidak valid. Mulai ulang dari /buy');
    }

    session.selectedCountryId = countryId;
    session.selectedCountryName = countryName;

    try {
        const res = await apiGet('/api/prices', { serviceId, countryId });
        const prices: Array<{ id: string; sellPrice: number }> = res.data ?? [];

        if (!prices.length) {
            return bot.sendMessage(chatId, `❌ Tidak ada harga tersedia untuk ${serviceName} di ${countryName}.`);
        }

        // Store prices in session (so callback can map index → priceId)
        session.prices = prices;

        // Build buttons (sorted by sellPrice ascending, already sorted from API)
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

        const buttons = prices.map((p, i) => ({
            text: `${emojis[i] ?? `${i + 1}.`} ${formatRupiah(p.sellPrice)}`,
            callback_data: `price:${p.id}`,
        }));

        // Check user balance
        const balRes = await apiGet('/api/user/balance', { telegramId });
        const balance = balRes.data?.balance ?? 0;

        const rows = buttons.map((b) => [b]); // one per row for readability

        await bot.sendMessage(
            chatId,
            `💳 *${serviceName} ${countryName}*\n\n` +
            `Saldo kamu: *${formatRupiah(balance)}*\n\n` +
            `Pilih harga nomor (termurah ke termahal):`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: rows },
            }
        );
    } catch {
        await bot.sendMessage(chatId, '❌ Gagal memuat harga. Coba lagi.');
    }
}

async function handlePriceSelected(
    bot: TelegramBot,
    chatId: number,
    telegramId: string,
    priceId: string
) {
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Memproses pesanan...');

    try {
        const res = await apiPost('/api/order', { priceId, telegramId });

        if (!res.success) {
            await bot.deleteMessage(chatId, loadingMsg.message_id);
            return bot.sendMessage(chatId, `❌ Gagal memesan: ${res.error}`);
        }

        const { orderId, phoneNumber } = res.data;
        await bot.deleteMessage(chatId, loadingMsg.message_id);

        clearSession(chatId);

        await bot.sendMessage(
            chatId,
            `✅ *Nomor berhasil dipesan!*\n\n` +
            `📞 Nomor Anda:\n\`${phoneNumber}\`\n\n` +
            `🆔 Order ID: \`${orderId}\`\n\n` +
            `⏳ Sistem sedang menunggu OTP. Kode akan dikirim otomatis ke sini.\n` +
            `_Maksimal menunggu 2 menit._\n\n` +
            `Untuk membatalkan: /status ${orderId}`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚫 Batalkan Order', callback_data: `cancel_order:${orderId}` }],
                        [{ text: '🏠 Menu Utama', callback_data: 'menu' }],
                    ],
                },
            }
        );
    } catch (err: any) {
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        const errMsg = err?.response?.data?.error ?? err.message ?? 'Error tidak diketahui';
        await bot.sendMessage(chatId, `❌ Gagal: ${errMsg}`);
    }
}

async function askDepositAmount(bot: TelegramBot, chatId: number) {
    const session = getSession(chatId);
    session.step = 'AWAIT_DEPOSIT_AMOUNT';

    await bot.sendMessage(
        chatId,
        `💳 *Deposit Saldo*\n\n` +
        `Masukkan jumlah deposit (min. Rp10.000):\n\n` +
        `Contoh: \`50000\``,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Rp10.000', callback_data: 'DEPOSIT_10000' },
                        { text: 'Rp20.000', callback_data: 'DEPOSIT_20000' },
                    ],
                    [
                        { text: 'Rp50.000', callback_data: 'DEPOSIT_50000' },
                        { text: 'Rp100.000', callback_data: 'DEPOSIT_100000' },
                    ],
                ],
            },
        }
    );
}

async function handleDepositWithAmount(
    bot: TelegramBot,
    chatId: number,
    telegramId: string,
    amount: number
) {
    const loadingMsg = await bot.sendMessage(chatId, `⏳ Membuat invoice ${formatRupiah(amount)}...`);

    try {
        const res = await apiPost('/api/deposit', { amount, telegramId });

        await bot.deleteMessage(chatId, loadingMsg.message_id);

        if (!res.success) {
            return bot.sendMessage(chatId, `❌ Gagal membuat invoice: ${res.error}`);
        }

        const { invoiceId, qrisPayload, expiredAt } = res.data;

        // Generate QR code image
        const qrBuffer = await QRCode.toBuffer(qrisPayload, {
            type: 'png',
            width: 400,
            margin: 2,
        });

        await bot.sendPhoto(chatId, qrBuffer as any, {
            caption:
                `💳 *Invoice Deposit*\n\n` +
                `Jumlah: *${formatRupiah(amount)}*\n` +
                `Invoice ID: \`${invoiceId}\`\n` +
                `Expires: ${new Date(expiredAt).toLocaleString('id-ID')}\n\n` +
                `📌 Scan QR di atas dengan aplikasi dompet digital apapun yang mendukung QRIS.\n\n` +
                `_Saldo akan masuk otomatis setelah pembayaran dikonfirmasi._`,
            parse_mode: 'Markdown',
        });

        // Also send QRIS string as text backup
        await bot.sendMessage(
            chatId,
            `📋 *QRIS String (backup)*:\n\n\`${qrisPayload}\``,
            { parse_mode: 'Markdown' }
        );
    } catch (err: any) {
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        const errMsg = err?.response?.data?.error ?? err.message ?? 'Error';
        await bot.sendMessage(chatId, `❌ Gagal: ${errMsg}`);
    }
}

async function handleOrderStatus(bot: TelegramBot, chatId: number, orderId: string) {
    try {
        const res = await apiGet(`/api/orders`);
        const orders: any[] = res.data ?? [];
        const order = orders.find((o: any) => o.id === orderId || o.id.startsWith(orderId));

        if (!order) {
            return bot.sendMessage(chatId, `❌ Order \`${orderId}\` tidak ditemukan.`, {
                parse_mode: 'Markdown',
            });
        }

        const statusEmoji: Record<string, string> = {
            PENDING: '⏳', ACTIVE: '🔄', SUCCESS: '✅', FAILED: '❌', CANCELLED: '🚫',
        };

        const emoji = statusEmoji[order.status] ?? '❓';
        const otpLine = order.otpCode ? `\n📟 OTP: \`${order.otpCode}\`` : '';

        await bot.sendMessage(
            chatId,
            `📦 *Status Order*\n\n` +
            `${emoji} Status: *${order.status}*\n` +
            `📞 Nomor: \`${order.phoneNumber ?? '-'}\`${otpLine}\n` +
            `🆔 ID: \`${order.id}\``,
            {
                parse_mode: 'Markdown',
                reply_markup:
                    order.status === 'ACTIVE'
                        ? {
                            inline_keyboard: [
                                [{ text: '🚫 Batalkan', callback_data: `cancel_order:${order.id}` }],
                            ],
                        }
                        : undefined,
            }
        );
    } catch {
        await bot.sendMessage(chatId, '❌ Gagal mengambil status order.');
    }
}

async function handleCancelOrder(
    bot: TelegramBot,
    chatId: number,
    telegramId: string,
    orderId: string
) {
    try {
        const res = await apiPost('/api/order/cancel', { orderId, telegramId });
        if (res.success) {
            await bot.sendMessage(
                chatId,
                `✅ Order \`${orderId}\` berhasil dibatalkan.\n\n_Refund telah dikreditkan ke saldo kamu._`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await bot.sendMessage(chatId, `❌ Gagal membatalkan: ${res.error ?? 'Unknown error'}`);
        }
    } catch (err: any) {
        const errMsg = err?.response?.data?.error ?? err.message ?? 'Error';
        await bot.sendMessage(chatId, `❌ Gagal membatalkan order: ${errMsg}`);
    }
}
