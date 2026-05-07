import { prisma } from '../../database/prisma.client';

const SEO_PAGES_KEY = 'seo_pages_registry_v1';

export interface SeoPageRecord {
    id: string;
    slug: string;
    title: string;
    metaDescription: string;
    heroBadge: string;
    heroTitle: string;
    intro: string;
    content: string;
    primaryCtaLabel: string;
    primaryCtaHref: string;
    secondaryCtaLabel: string;
    secondaryCtaHref: string;
    isPublished: boolean;
    createdAt: string;
    updatedAt: string;
}

type SeoPageInput = Partial<SeoPageRecord> & { slug: string };

const DEFAULT_SEO_PAGES: SeoPageRecord[] = [
    {
        id: 'seo-nokos-whatsapp',
        slug: 'nokos-whatsapp',
        title: 'Nokos WhatsApp dan Nomor Virtual WA | NokosHUB',
        metaDescription: 'Cari nokos WhatsApp, nomor virtual WA, atau OTP WhatsApp? NokosHUB menyediakan nomor virtual WhatsApp otomatis, cepat, dan mudah untuk verifikasi akun.',
        heroBadge: 'Nokos WhatsApp',
        heroTitle: 'Nokos WhatsApp untuk Verifikasi Akun WA dengan Nomor Virtual',
        intro: 'Nokos WhatsApp adalah nomor virtual yang digunakan untuk menerima OTP WhatsApp tanpa memakai nomor pribadi. Di NokosHUB, pengguna bisa memilih layanan WhatsApp, negara, lalu menerima kode verifikasi secara otomatis di dashboard.',
        content: [
            '## Apa itu nokos WA?',
            'Nokos WA, nomor kosong WhatsApp, atau nomor virtual WhatsApp adalah istilah yang biasa dipakai pengguna ketika mencari nomor sementara untuk menerima SMS OTP WhatsApp. Dalam praktiknya, Anda memilih layanan WhatsApp, menentukan negara, lalu sistem menampilkan nomor yang siap dipakai untuk proses verifikasi.',
            '',
            '## Cara membeli nokos WhatsApp di NokosHUB',
            '- Daftar atau login ke dashboard NokosHUB.',
            '- Top up saldo sesuai kebutuhan.',
            '- Pilih layanan WhatsApp dan negara yang tersedia.',
            '- Buat order dan tunggu OTP masuk ke dashboard.',
            '- Jika order gagal sesuai status sistem, saldo akan mengikuti mekanisme refund yang berlaku.',
            '',
            '## Kenapa memakai nomor virtual WhatsApp?',
            '- Memisahkan kebutuhan verifikasi dari nomor pribadi.',
            '- Lebih praktis untuk kebutuhan operasional yang membutuhkan banyak verifikasi akun.',
            '- Memudahkan monitoring OTP karena semua status order tersimpan di dashboard.',
        ].join('\n'),
        primaryCtaLabel: 'Daftar Gratis',
        primaryCtaHref: '/register/',
        secondaryCtaLabel: 'Top Up Saldo',
        secondaryCtaHref: '/user/#topup',
        isPublished: true,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
    },
    {
        id: 'seo-nokos-telegram',
        slug: 'nokos-telegram',
        title: 'Nokos Telegram dan Nomor Virtual Telegram | NokosHUB',
        metaDescription: 'Butuh nokos Telegram atau nomor virtual Telegram? NokosHUB menyediakan layanan nomor virtual Telegram untuk verifikasi akun dengan proses cepat dan dashboard otomatis.',
        heroBadge: 'Nokos Telegram',
        heroTitle: 'Nokos Telegram dengan Nomor Virtual Telegram yang Praktis',
        intro: 'Nokos Telegram adalah nomor virtual yang digunakan untuk menerima OTP Telegram tanpa memakai nomor utama. Halaman ini dibuat untuk pengguna yang mencari istilah nokos Telegram, nomor kosong Telegram, atau nomor virtual Telegram.',
        content: [
            '## Apa itu nokos Telegram?',
            'Nokos Telegram adalah istilah yang biasa dipakai user Indonesia saat mencari nomor virtual untuk verifikasi akun Telegram. Secara fungsi, layanan ini menyediakan nomor sementara yang dapat menerima SMS OTP Telegram dan menampilkan hasilnya di dashboard NokosHUB.',
            '',
            '## Alur pembelian nokos Telegram',
            '- Login ke NokosHUB dan isi saldo akun.',
            '- Pilih layanan Telegram dari daftar layanan yang tersedia.',
            '- Tentukan negara dan opsi provider yang sesuai.',
            '- Lakukan order lalu tunggu OTP Telegram masuk ke dashboard.',
            '',
            '## Kenapa user mencari nomor virtual Telegram?',
            '- Memisahkan verifikasi Telegram dari nomor pribadi.',
            '- Memudahkan monitoring OTP dalam satu dashboard.',
            '- Praktis untuk kebutuhan operasional yang butuh verifikasi cepat.',
        ].join('\n'),
        primaryCtaLabel: 'Buat Akun',
        primaryCtaHref: '/register/',
        secondaryCtaLabel: 'Lihat FAQ',
        secondaryCtaHref: '/#faq',
        isPublished: true,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
    },
    {
        id: 'seo-otp-google',
        slug: 'otp-google',
        title: 'OTP Google dan Nomor Virtual Google | NokosHUB',
        metaDescription: 'Cari OTP Google atau nomor virtual untuk verifikasi akun Google? NokosHUB menyediakan layanan nomor virtual dan SMS OTP otomatis untuk proses verifikasi yang lebih praktis.',
        heroBadge: 'OTP Google',
        heroTitle: 'OTP Google dengan Nomor Virtual untuk Verifikasi Akun',
        intro: 'Halaman ini dibuat untuk kebutuhan pencarian OTP Google, nomor virtual Google, dan verifikasi akun Google menggunakan layanan nomor virtual dari NokosHUB.',
        content: [
            '## Kenapa user mencari OTP Google?',
            'Biasanya pengguna membutuhkan OTP Google untuk verifikasi akun, pendaftaran baru, atau proses autentikasi lain yang memerlukan SMS. Dengan nomor virtual, proses bisa dilakukan tanpa menggunakan nomor telepon pribadi.',
            '',
            '## Hal yang perlu diperhatikan',
            '- Ketersediaan nomor mengikuti stok provider dan negara.',
            '- Harga dapat berubah sesuai provider.',
            '- Jika order gagal sesuai mekanisme sistem, saldo mengikuti kebijakan refund yang berlaku.',
        ].join('\n'),
        primaryCtaLabel: 'Mulai Sekarang',
        primaryCtaHref: '/register/',
        secondaryCtaLabel: 'Baca FAQ',
        secondaryCtaHref: '/#faq',
        isPublished: true,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
    },
    {
        id: 'seo-otp-shopee',
        slug: 'otp-shopee',
        title: 'OTP Shopee dan Nokos Shopee | NokosHUB',
        metaDescription: 'Butuh OTP Shopee atau nokos Shopee? NokosHUB menyediakan layanan nomor virtual untuk verifikasi akun Shopee dengan proses cepat dan dashboard otomatis.',
        heroBadge: 'OTP Shopee',
        heroTitle: 'OTP Shopee dan Nokos Shopee untuk Verifikasi Akun',
        intro: 'OTP Shopee dan nokos Shopee adalah istilah yang lebih tepat untuk intent verifikasi akun dibanding istilah nomor virtual account. Halaman ini ditujukan untuk user yang mencari layanan OTP Shopee di NokosHUB.',
        content: [
            '## Apa itu OTP Shopee?',
            'OTP Shopee adalah kode verifikasi yang dikirim ke nomor yang digunakan saat registrasi atau login Shopee. Dengan nomor virtual, proses verifikasi bisa dilakukan tanpa memakai nomor utama.',
            '',
            '## Kelebihan memakai NokosHUB',
            '- Proses order otomatis.',
            '- Pantauan OTP langsung di dashboard.',
            '- Riwayat order dan transaksi tercatat rapi.',
        ].join('\n'),
        primaryCtaLabel: 'Daftar Gratis',
        primaryCtaHref: '/register/',
        secondaryCtaLabel: 'Login Dashboard',
        secondaryCtaHref: '/login/',
        isPublished: true,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
    },
];

export const seoPagesService = {
    async list(): Promise<SeoPageRecord[]> {
        const pages = await loadSeoPages();
        return pages.sort((a, b) => a.slug.localeCompare(b.slug));
    },

    async getBySlug(rawSlug: string): Promise<SeoPageRecord | null> {
        const slug = normalizeSlug(rawSlug);
        if (!slug) return null;
        const pages = await loadSeoPages();
        return pages.find((page) => page.slug === slug) ?? null;
    },

    async save(input: SeoPageInput & { id?: string | null }): Promise<SeoPageRecord> {
        const pages = await loadSeoPages();
        const now = new Date().toISOString();
        const slug = normalizeSlug(input.slug);
        if (!slug) throw new Error('Slug wajib diisi');

        const duplicate = pages.find((page) => page.slug === slug && page.id !== input.id);
        if (duplicate) throw new Error('Slug sudah digunakan halaman lain');

        const existingIndex = input.id ? pages.findIndex((page) => page.id === input.id) : -1;
        const existing = existingIndex >= 0 ? pages[existingIndex] : null;
        const page = normalizeSeoPage({
            ...existing,
            ...input,
            id: existing?.id ?? input.id ?? `seo-${slug}-${Date.now()}`,
            slug,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });

        if (existingIndex >= 0) pages[existingIndex] = page;
        else pages.push(page);

        await persistSeoPages(pages);
        return page;
    },

    async remove(id: string): Promise<boolean> {
        const pages = await loadSeoPages();
        const next = pages.filter((page) => page.id !== id);
        if (next.length === pages.length) return false;
        await persistSeoPages(next);
        return true;
    },
};

export function normalizeSlug(raw: string): string {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/^\/+|\/+$/g, '')
        .replace(/[^a-z0-9\s/-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/\/+/g, '-')
        .replace(/-+/g, '-');
}

async function loadSeoPages(): Promise<SeoPageRecord[]> {
    const row = await prisma.appSetting.findUnique({ where: { key: SEO_PAGES_KEY } });
    if (!row) return DEFAULT_SEO_PAGES.map((page) => ({ ...page }));

    try {
        const parsed = JSON.parse(row.value);
        if (!Array.isArray(parsed)) return DEFAULT_SEO_PAGES.map((page) => ({ ...page }));
        return parsed.map((page) => normalizeSeoPage(page));
    } catch {
        return DEFAULT_SEO_PAGES.map((page) => ({ ...page }));
    }
}

async function persistSeoPages(pages: SeoPageRecord[]) {
    await prisma.appSetting.upsert({
        where: { key: SEO_PAGES_KEY },
        update: { value: JSON.stringify(pages) },
        create: { key: SEO_PAGES_KEY, value: JSON.stringify(pages) },
    });
}

function normalizeSeoPage(input: Partial<SeoPageRecord>): SeoPageRecord {
    const now = new Date().toISOString();
    const slug = normalizeSlug(String(input.slug || ''));
    return {
        id: String(input.id || `seo-${slug || 'page'}`),
        slug,
        title: String(input.title || 'Halaman SEO | NokosHUB').trim(),
        metaDescription: String(input.metaDescription || '').trim(),
        heroBadge: String(input.heroBadge || 'Halaman SEO').trim(),
        heroTitle: String(input.heroTitle || input.title || 'Halaman SEO').trim(),
        intro: String(input.intro || '').trim(),
        content: String(input.content || '').trim(),
        primaryCtaLabel: String(input.primaryCtaLabel || 'Daftar Gratis').trim(),
        primaryCtaHref: String(input.primaryCtaHref || '/register/').trim(),
        secondaryCtaLabel: String(input.secondaryCtaLabel || 'Lihat FAQ').trim(),
        secondaryCtaHref: String(input.secondaryCtaHref || '/#faq').trim(),
        isPublished: input.isPublished !== false,
        createdAt: String(input.createdAt || now),
        updatedAt: String(input.updatedAt || now),
    };
}
