import { startServer } from './app/server';
import { createBot } from './app/bot';
import './worker'; // Import worker so it runs in the same process for free-tier deployments

async function main() {
    // Start bot in the same process as the server so the notify handler works
    createBot();

    // Start Fastify server (also boots DB, syncs provider)
    await startServer();
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
