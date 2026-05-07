import { Worker, Job } from 'bullmq';
import { config } from '../app/config';
import logger from '../utils/logger';
import { runOtpPollingJob, type OtpJobData } from './otp-poll-runner';

// BullMQ bundles its own ioredis — pass URL string to avoid type conflicts
const workerConnection = { url: config.REDIS_URL, maxRetriesPerRequest: null as any };

const worker = new Worker<OtpJobData>(
    'otp-polling',
    async (job: Job<OtpJobData>) => runOtpPollingJob(job.data),
    {
        connection: workerConnection,
        concurrency: 20,
    }
);

worker.on('completed', (job: Job) => {
    logger.info({ jobId: job.id }, 'OTP job completed');
});

worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err }, 'OTP job failed');
});

export default worker;
