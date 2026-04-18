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
