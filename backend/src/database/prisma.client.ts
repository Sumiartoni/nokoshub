import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from '../app/config';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
    const pool = new Pool({ connectionString: config.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({
        adapter,
        log: config.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (config.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function connectDatabase(): Promise<void> {
    await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
    await prisma.$disconnect();
}
