import worker from './workers/otp.worker';
import { config } from './app/config';
import logger from './utils/logger';

logger.info('🔧 OTP Worker started');
logger.info({ interval: config.OTP_POLL_INTERVAL_MS, maxDuration: config.OTP_POLL_MAX_MS }, 'Worker config');

process.on('SIGINT', async () => {
    logger.info('Worker shutting down...');
    await worker.close();
    process.exit(0);
});
