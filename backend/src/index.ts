import { startServer } from './app/server';
import { createBot } from '../bot tele/bot';
import { createCsBot } from '../bot cs/bot';
import { config } from './app/config';
import logger from './utils/logger';

async function main() {
    // Start Fastify server first so the API remains available even if
    // Telegram or other auxiliary services fail during boot.
    await startServer();

    try {
        createBot();
        logger.info('Telegram bot started inside backend process');
    } catch (err) {
        logger.error({ err }, 'Telegram bot failed to start, API will stay online');
    }

    if (config.CS_TELEGRAM_BOT_TOKEN.trim()) {
        try {
            createCsBot();
            logger.info('CS bot started inside backend process');
        } catch (err) {
            logger.error({ err }, 'CS bot failed to start, API will stay online');
        }
    } else {
        logger.info('CS bot disabled because CS_TELEGRAM_BOT_TOKEN is empty');
    }
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
