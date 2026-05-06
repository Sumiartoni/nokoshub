import { startServer } from './app/server';
import { createBot } from '../bot tele/bot';
import { createCsBot } from '../bot cs/bot';
import { config } from './app/config';
import logger from './utils/logger';
import './worker'; // Import worker so it runs in the same process for free-tier deployments

async function main() {
    // Start bot in the same process as the server so the notify handler works
    createBot();

    // Start CS bot in the same container/process when configured.
    if (config.CS_TELEGRAM_BOT_TOKEN.trim()) {
        createCsBot();
    } else {
        logger.info('CS bot disabled because CS_TELEGRAM_BOT_TOKEN is empty');
    }

    // Start Fastify server (also boots DB, syncs provider)
    await startServer();
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
