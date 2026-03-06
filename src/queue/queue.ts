import { Queue } from 'bullmq';
import { config } from '../app/config';

// BullMQ bundles its own ioredis, so pass the connection URL string
// instead of an external IORedis instance to avoid type conflicts.
const connection = { url: config.REDIS_URL, maxRetriesPerRequest: null as any };

export const otpQueue = new Queue('otp-polling', {
    connection,
    defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
    },
});

// Export a plain IORedis client for use by Fastify rate-limit et al.
import IORedis from 'ioredis';
export const redisConnection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
});
