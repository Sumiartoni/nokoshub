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

    // ─── Dashboard + Health check at root for Koyeb ──────────────────────────
    app.get('/', async (req, reply) => {
        const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NokosHUB - Backend Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;padding:24px}
.container{max-width:900px;margin:0 auto}
h1{font-size:2rem;background:linear-gradient(90deg,#58a6ff,#3fb950);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px}
.subtitle{color:#8b949e;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px;margin-bottom:16px}
.card h2{font-size:1.1rem;margin-bottom:12px;color:#58a6ff}
.status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.status-item{background:#0d1117;border-radius:8px;padding:14px;display:flex;align-items:center;gap:10px}
.dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.dot.green{background:#3fb950;box-shadow:0 0 8px #3fb950}
.dot.yellow{background:#d29922;box-shadow:0 0 8px #d29922}
.label{font-size:.85rem;color:#8b949e}
.value{font-weight:600;font-size:.95rem}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #21262d;font-size:.9rem}
th{color:#8b949e;font-weight:500}
.method{padding:3px 8px;border-radius:4px;font-size:.75rem;font-weight:700;color:#fff}
.get{background:#1f6feb}.post{background:#3fb950}
.try-btn{background:#21262d;color:#58a6ff;border:1px solid #30363d;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:.8rem}
.try-btn:hover{background:#30363d}
#result{margin-top:12px;background:#0d1117;border-radius:8px;padding:14px;font-family:monospace;font-size:.85rem;white-space:pre-wrap;display:none;max-height:300px;overflow:auto}
footer{text-align:center;margin-top:24px;color:#484f58;font-size:.8rem}
</style></head>
<body><div class="container">
<h1>🚀 NokosHUB Backend</h1>
<p class="subtitle">Production Dashboard — v1.0.0</p>
<div class="card"><h2>⚡ System Status</h2>
<div class="status-grid">
<div class="status-item"><div class="dot green"></div><div><div class="label">Server</div><div class="value">Online</div></div></div>
<div class="status-item"><div class="dot green"></div><div><div class="label">Database</div><div class="value">Connected</div></div></div>
<div class="status-item"><div class="dot green"></div><div><div class="label">Redis</div><div class="value">Connected</div></div></div>
<div class="status-item"><div class="dot green"></div><div><div class="label">Bot Telegram</div><div class="value">Active</div></div></div>
</div></div>
<div class="card"><h2>📡 API Endpoints</h2>
<table>
<tr><th>Method</th><th>Endpoint</th><th>Description</th><th></th></tr>
<tr><td><span class="method get">GET</span></td><td>/api/health</td><td>Health check</td><td><button class="try-btn" onclick="tryApi('/api/health')">Try</button></td></tr>
<tr><td><span class="method get">GET</span></td><td>/api/services</td><td>List layanan OTP</td><td><button class="try-btn" onclick="tryApi('/api/services')">Try</button></td></tr>
<tr><td><span class="method get">GET</span></td><td>/api/countries</td><td>List negara</td><td><button class="try-btn" onclick="tryApi('/api/countries')">Try</button></td></tr>
<tr><td><span class="method post">POST</span></td><td>/api/deposit</td><td>Buat invoice deposit</td><td></td></tr>
<tr><td><span class="method post">POST</span></td><td>/api/order</td><td>Beli nomor virtual</td><td></td></tr>
<tr><td><span class="method get">GET</span></td><td>/api/invoices</td><td>Riwayat invoice</td><td></td></tr>
<tr><td><span class="method get">GET</span></td><td>/api/orders</td><td>Riwayat order</td><td></td></tr>
<tr><td><span class="method post">POST</span></td><td>/api/payment/webhook</td><td>Payment webhook</td><td></td></tr>
</table>
<div id="result"></div>
</div>
<footer>NokosHUB © 2026 — Powered by Fastify + Prisma + Telegram</footer>
</div>
<script>
async function tryApi(url){
  const el=document.getElementById('result');
  el.style.display='block';el.textContent='Loading...';
  try{const r=await fetch(url);const j=await r.json();el.textContent=JSON.stringify(j,null,2)}
  catch(e){el.textContent='Error: '+e.message}
}
</script></body></html>`;
        reply.type('text/html').send(html);
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
