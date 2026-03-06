import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { connectDatabase } from '../database/prisma.client';
import { redisConnection } from '../queue/queue';
import { apiRoutes } from '../modules/routes/api.routes';
import { adminRoutes } from '../modules/routes/admin.routes';
import { webhookRoutes, internalRoutes } from '../modules/routes/webhook.routes';
import { serviceService } from '../modules/services/service.service';
import logger from '../utils/logger';

export async function buildServer() {
    const app = Fastify({
        logger: false, // we use our own pino logger
        trustProxy: true,
    });

    // ─── Plugins ──────────────────────────────────────────────────────────────
    await app.register(cors, {
        origin: config.NODE_ENV === 'production' ? false : true,
    });

    await app.register(helmet, {
        contentSecurityPolicy: false,
    });

    await app.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute',
        redis: redisConnection,
        keyGenerator: (req) =>
            req.headers['x-forwarded-for']?.toString() || req.ip,
    });

    // ─── Routes ───────────────────────────────────────────────────────────────
    await app.register(apiRoutes, { prefix: '/api' });
    await app.register(adminRoutes, { prefix: '/api/admin' });
    await app.register(webhookRoutes, { prefix: '/api/payment' });
    await app.register(internalRoutes, { prefix: '/api/internal' });

    // ─── Error handler ────────────────────────────────────────────────────────
    app.setErrorHandler((err: any, req, reply) => {
        logger.error({ err, method: req.method, url: req.url }, 'Unhandled error');
        reply.status(err.statusCode ?? 500).send({
            success: false,
            error: config.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        });
    });

    return app;
}

export async function startServer() {
    try {
        await connectDatabase();
        logger.info('✅ Database connected');

        const app = await buildServer();

        await app.listen({ port: config.PORT, host: '0.0.0.0' });
        logger.info(`🚀 Server running on port ${config.PORT}`);

        // Auto-sync services from provider on startup
        try {
            const result = await serviceService.syncFromProvider();
            logger.info(result, '✅ Provider sync complete');
        } catch (err) {
            logger.warn({ err }, '⚠️ Provider sync failed on startup (non-fatal)');
        }

        // Graceful shutdown
        const shutdown = async () => {
            logger.info('Shutting down...');
            await app.close();
            await redisConnection.quit();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    } catch (err) {
        logger.error({ err }, 'Failed to start server');
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}
