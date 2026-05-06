import axios from 'axios';
import { config } from '../src/app/config';
import logger from '../src/utils/logger';
import { csBotSettingsService } from '../src/modules/settings/cs-bot-settings.service';

export interface HistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface AiDecision {
    answer: string;
    escalate: boolean;
    reason: string;
}

const DEFAULT_SYSTEM_PROMPT = [
    'Anda adalah Customer Service AI untuk NokosHUB.',
    'Jawab dalam Bahasa Indonesia yang singkat, jelas, sopan, dan enak dibaca.',
    'Gunakan gaya CS yang natural, tidak kaku, dan tidak terlalu formal.',
    'Hindari jawaban panjang yang hanya dipisahkan koma.',
    'Utamakan kalimat pendek.',
    'Jika menjelaskan langkah, pisahkan menjadi baris-baris singkat atau daftar sederhana.',
    'Maksimal 2 kalimat per paragraf bila memungkinkan.',
    'Fokus hanya pada pertanyaan umum seputar layanan NokosHUB, OTP, top up, refund otomatis, penggunaan dashboard, dan penautan Telegram.',
    'Jangan mengarang jawaban. Jika informasi tidak cukup, pertanyaan butuh pengecekan manual, menyangkut komplain spesifik user, bukti transfer, status order tertentu, atau Anda tidak yakin, maka eskalasi ke admin manusia.',
    'Jika menjawab, berikan jawaban final yang langsung bisa dibaca user.',
    'Anda wajib mengembalikan JSON valid dengan format persis: {"answer":"...","escalate":false,"reason":""}.',
    'Jika perlu dialihkan ke admin, gunakan format: {"answer":"","escalate":true,"reason":"alasan singkat"}',
    'Jangan keluarkan markdown code block.',
].join(' ');

export async function generateCsReply(input: {
    userMessage: string;
    displayName: string;
    username?: string;
    history: HistoryMessage[];
}): Promise<AiDecision> {
    const settings = await csBotSettingsService.getRuntimeSettings();

    if (!settings.apiKey.trim()) {
        return {
            answer: '',
            escalate: true,
            reason: 'OpenRouter API key belum dikonfigurasi',
        };
    }

    const systemPrompt = settings.knowledgePrompt.trim()
        ? `${DEFAULT_SYSTEM_PROMPT}\n\nKnowledge internal NokosHUB:\n${settings.knowledgePrompt.trim()}`
        : DEFAULT_SYSTEM_PROMPT;
    const messages = [
        {
            role: 'system',
            content: [
                systemPrompt,
                '',
                'Konteks user:',
                `- Nama: ${input.displayName}`,
                `- Username Telegram: ${input.username || '-'}`,
            ].join('\n'),
        },
        ...input.history.map((item) => ({
            role: item.role,
            content: item.content,
        })),
        {
            role: 'user',
            content: input.userMessage,
        },
    ];

    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: settings.model,
                temperature: 0.2,
                messages,
            },
            {
                headers: {
                    Authorization: `Bearer ${settings.apiKey}`,
                    'Content-Type': 'application/json',
                    ...(settings.siteUrl.trim() ? { 'HTTP-Referer': settings.siteUrl.trim() } : {}),
                    ...(settings.siteName.trim() ? { 'X-Title': settings.siteName.trim() } : {}),
                },
                timeout: Math.max(10000, config.CS_TELEGRAM_REQUEST_TIMEOUT_MS),
            }
        );

        const raw = String(response.data?.choices?.[0]?.message?.content || '').trim();
        const parsed = parseDecision(raw);

        if (!parsed.answer && !parsed.escalate) {
            return {
                answer: '',
                escalate: true,
                reason: 'AI tidak memberikan jawaban yang valid',
            };
        }

        return parsed;
    } catch (err: any) {
        logger.warn(
            {
                err: err?.response?.data || err,
                model: settings.model,
            },
            'OpenRouter CS request failed'
        );
        return {
            answer: '',
            escalate: true,
            reason: 'AI sedang tidak tersedia',
        };
    }
}

function parseDecision(raw: string): AiDecision {
    const fallback: AiDecision = {
        answer: '',
        escalate: true,
        reason: 'AI tidak dapat menentukan jawaban',
    };

    if (!raw) return fallback;

    const candidates = [raw, extractFirstJsonObject(raw)].filter(Boolean) as string[];

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as Record<string, unknown>;
            const answer = formatReadableAnswer(String(parsed.answer || '').trim());
            const escalate = Boolean(parsed.escalate);
            const reason = String(parsed.reason || '').trim();
            return {
                answer,
                escalate,
                reason,
            };
        } catch {
            // Try next candidate.
        }
    }

    if (/escalate/i.test(raw) || /tidak yakin|tidak tahu|tidak dapat/i.test(raw)) {
        return {
            answer: '',
            escalate: true,
            reason: 'AI meminta eskalasi ke admin',
        };
    }

    return {
        answer: formatReadableAnswer(raw),
        escalate: false,
        reason: '',
    };
}

function extractFirstJsonObject(value: string) {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return '';
    return value.slice(start, end + 1);
}

function formatReadableAnswer(value: string) {
    const normalized = String(value || '')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    if (!normalized) return '';

    if (/\n/.test(normalized)) {
        return normalized;
    }

    const sentenceSplit = normalized
        .replace(/([.!?])\s+/g, '$1\n')
        .replace(/:\s+/g, ':\n')
        .trim();

    if (sentenceSplit.length !== normalized.length) {
        return sentenceSplit.replace(/\n{3,}/g, '\n\n').trim();
    }

    return normalized
        .replace(/, lalu /gi, ',\nLalu ')
        .replace(/, setelah itu /gi, ',\nSetelah itu ')
        .replace(/, kemudian /gi, ',\nKemudian ')
        .replace(/, jadi /gi, ',\nJadi ')
        .trim();
}
