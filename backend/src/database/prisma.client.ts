import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from '../app/config';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

function buildDatabaseConnectionConfig() {
    const url = new URL(config.DATABASE_URL);
    url.searchParams.delete('sslmode');
    url.searchParams.delete('sslcert');
    url.searchParams.delete('sslkey');
    url.searchParams.delete('sslrootcert');
    url.searchParams.delete('sslaccept');
    url.searchParams.delete('use_libpq_compat');

    const ssl = config.DATABASE_SSL_CA_B64
        ? {
            ca: Buffer.from(config.DATABASE_SSL_CA_B64, 'base64').toString('utf8'),
            rejectUnauthorized: true,
        }
        : {
            rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED,
        };

    return {
        connectionString: url.toString(),
        ssl,
    };
}

function createPrismaClient(): PrismaClient {
    const pool = new Pool(buildDatabaseConnectionConfig());
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
