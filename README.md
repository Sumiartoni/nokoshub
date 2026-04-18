# NokosHUB

Struktur deploy sekarang dipisah:

- `backend/` berisi API, worker OTP, bot Telegram, Prisma, dan provider HeroSMS.
- `backoffice/` berisi halaman super admin static yang berjalan sebagai service terpisah.
- `docker-compose.yml` di root menjalankan `backend`, `worker`, `backoffice`, `postgres`, dan `redis`.

## VPS Quick Start

```bash
cp .env.example .env
nano .env
docker compose up -d --build
```

`COMPOSE_PROJECT_NAME=backend` dipakai agar VPS yang sebelumnya deploy dari folder `backend/` tetap memakai volume database lama.

Backoffice test via IP:

```text
http://IP-VPS:8080
```

Backend API test via IP:

```text
http://IP-VPS:3000/api/health
```

Untuk domain production, arahkan:

- `admin.domainanda.com` ke service backoffice port `8080`
- `api.domainanda.com` ke service backend port `3000`

Saat sudah memakai HTTPS untuk backoffice, ubah:

```env
BACKOFFICE_COOKIE_SECURE=true
```

## Pricing

Harga modal HeroSMS tetap dihitung dari USD, lalu dikonversi ke Rupiah memakai kurs otomatis USD/IDR. Sistem menambahkan buffer kurs 3% sebagai kurs aman.

```env
USD_IDR_RATE_AUTO_ENABLED=true
USD_IDR_RATE_API_URL=https://api.frankfurter.dev/v2/rate/USD/IDR
USD_IDR_RATE_BUFFER_PERCENT=3
USD_IDR_RATE_REFRESH_MINUTES=360
HERO_SMS_PRICE_TO_IDR_RATE=17000
```

`HERO_SMS_PRICE_TO_IDR_RATE` dipakai sebagai fallback kalau API kurs sedang gagal. Margin keuntungan bisa diubah dari halaman super admin bagian `Layanan > Pricing & Kurs`.
