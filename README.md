# NokosHUB

Struktur deploy sekarang dipisah:

- `backend/` berisi API, worker OTP, bot Telegram, Prisma, dan provider HeroSMS.
- `frontend/` berisi konfigurasi Nginx untuk menyajikan landing page dan dashboard user dalam satu service.
- `landing page/` berisi halaman publik, login, dan register.
- `user/` berisi dashboard user yang terhubung ke backend.
- `backoffice/` berisi halaman super admin static yang berjalan sebagai service terpisah.
- `docker-compose.yml` di root menjalankan `frontend`, `backend`, `worker`, `backoffice`, `postgres`, dan `redis`.

## VPS Quick Start

```bash
cp .env.example .env
nano .env
docker compose up -d --build
```

`COMPOSE_PROJECT_NAME=backend` dipakai agar VPS yang sebelumnya deploy dari folder `backend/` tetap memakai volume database lama.

Service Docker hanya dipublish ke `127.0.0.1`, jadi akses langsung via IP:port tidak dibuka untuk publik. Gunakan Caddy/Nginx sebagai reverse proxy untuk domain.

Backoffice test dari dalam VPS:

```text
curl http://127.0.0.1:8080
```

Landing page dan dashboard user:

```text
curl http://127.0.0.1:8081
curl http://127.0.0.1:8081/user/
```

Backend API test dari dalam VPS:

```text
curl http://127.0.0.1:3000/api/health
```

Untuk domain production, arahkan:

- `domainanda.com` ke service frontend port `8081`
- `admin.domainanda.com` ke service backoffice port `8080`
- `api.domainanda.com` ke service backend port `3000`

Saat sudah memakai HTTPS untuk backoffice, ubah:

```env
BACKOFFICE_COOKIE_SECURE=true
```

## Security Checklist

Sebelum domain dibuka ke publik:

- Isi `INTERNAL_API_SECRET`, `JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `ADMIN_API_KEY`, dan `BACKOFFICE_SESSION_SECRET` dengan string acak panjang.
- Jangan buka port `3000`, `8080`, `8081`, `5432`, atau `6379` ke publik. Publik cukup lewat port `80` dan `443` milik reverse proxy.
- Set `BACKOFFICE_COOKIE_SECURE=true` setelah memakai HTTPS.
- Isi `CORS_ALLOWED_ORIGINS` dengan domain resmi saja, contoh:

```env
CORS_ALLOWED_ORIGINS=https://domainanda.com,https://www.domainanda.com,https://admin.domainanda.com,https://api.domainanda.com
```

- Biarkan `BACKEND_DASHBOARD_ENABLED=false` di production agar halaman root backend tidak menampilkan daftar endpoint.

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

## Auth User dan Link Telegram

Dashboard user memakai auth email/password melalui endpoint:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`
- `GET /api/auth/me`

Untuk mengaktifkan login Google:

```env
GOOGLE_CLIENT_ID=isi_dengan_web_client_id_google
```

Di Google Cloud Console, buat OAuth 2.0 Client type `Web application`, lalu tambahkan `Authorized JavaScript origins` sesuai domain frontend Anda, misalnya:

- `https://nokoshub.store`
- `https://www.nokoshub.store`

Untuk menghubungkan akun web dengan bot Telegram:

1. User login ke dashboard web.
2. Buka menu `Profil`.
3. Klik `Buat Kode Link`.
4. Buka bot Telegram dan ketik `/linked`.
5. Kirim kode 6 digit dari web ke bot.

Setelah berhasil, saldo, order, deposit, dan riwayat Telegram akan terbaca di dashboard web.
