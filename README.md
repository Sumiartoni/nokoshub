# NOKOS HUB - Virtual Number / OTP Sales System

## Environment Variables

Copy `.env.example` to `.env` and fill in all values.

```bash
cp .env.example .env
```

## Quick Start (Docker)

```bash
docker compose up -d
```

## Development

```bash
npm run dev:server   # Start API server
npm run dev:bot      # Start Telegram bot
npm run dev:worker   # Start OTP worker
```

## Database

```bash
npm run db:migrate   # Run migrations
npm run db:generate  # Generate Prisma client
npm run db:studio    # Open Prisma Studio
```
