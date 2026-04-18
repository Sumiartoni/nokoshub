# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install ALL deps (including dev for build). Prisma is generated explicitly
# after install so Docker builds do not depend on npm postinstall ordering.
RUN npm ci --ignore-scripts

# Generate Prisma client
ENV DATABASE_URL=postgresql://nokos:nokos_password@localhost:5432/nokos_db
RUN npx prisma generate

# Copy source
COPY src ./src
COPY ["bot tele", "./bot tele"]

# Compile TypeScript
RUN npx tsc --project tsconfig.json

# ─── Production stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Install production deps only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy Prisma schema and generated client
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy compiled JS
COPY --from=builder /app/dist ./dist

EXPOSE 8000

# Default: run main server + bot
CMD ["node", "dist/src/index.js"]
