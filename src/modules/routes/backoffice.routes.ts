import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../../app/config';
import {
    clearBackofficeSessionCookie,
    createBackofficeSession,
    getBackofficeSession,
    setBackofficeSessionCookie,
    verifyBackofficePassword,
} from '../../utils/backoffice-auth';

const loginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

const backofficeDir = join(process.cwd(), 'backoffice');

export const backofficeRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/backoffice/assets/styles.css', async (_req, reply) =>
        sendBackofficeFile(reply, 'assets/styles.css', 'text/css; charset=utf-8')
    );

    fastify.get('/backoffice/assets/app.js', async (_req, reply) =>
        sendBackofficeFile(reply, 'assets/app.js', 'application/javascript; charset=utf-8')
    );

    fastify.get('/backoffice/login', async (req, reply) => {
        if (getBackofficeSession(req)) {
            return reply.redirect('/backoffice');
        }

        return sendBackofficeFile(reply, 'login.html', 'text/html; charset=utf-8');
    });

    fastify.get('/backoffice', async (req, reply) => {
        const session = getBackofficeSession(req);
        if (!session) {
            return reply.redirect('/backoffice/login');
        }

        return sendBackofficeFile(reply, 'index.html', 'text/html; charset=utf-8');
    });

    fastify.get('/api/backoffice/me', async (req) => {
        const session = getBackofficeSession(req);
        return { success: true, authenticated: Boolean(session), user: session };
    });

    fastify.post(
        '/api/backoffice/login',
        { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
        async (req, reply) => {
            const parsed = loginSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.status(400).send({ success: false, error: 'Username dan password wajib diisi' });
            }

            if (!config.BACKOFFICE_PASSWORD_HASH) {
                return reply.status(503).send({ success: false, error: 'Backoffice login belum dikonfigurasi' });
            }

            const usernameOk = parsed.data.username === config.BACKOFFICE_USERNAME;
            const passwordOk = verifyBackofficePassword(parsed.data.password, config.BACKOFFICE_PASSWORD_HASH);

            if (!usernameOk || !passwordOk) {
                return reply.status(401).send({ success: false, error: 'Login tidak valid' });
            }

            const token = createBackofficeSession(parsed.data.username);
            setBackofficeSessionCookie(reply, token);

            return { success: true };
        }
    );

    fastify.post('/api/backoffice/logout', async (_req, reply) => {
        clearBackofficeSessionCookie(reply);
        return { success: true };
    });
};

async function sendBackofficeFile(reply: FastifyReply, file: string, contentType: string) {
    try {
        const body = await readFile(join(backofficeDir, file), 'utf8');
        return reply
            .header('Cache-Control', file.endsWith('.html') ? 'no-store' : 'public, max-age=300')
            .type(contentType)
            .send(body);
    } catch {
        return reply.status(500).type('text/plain').send('Backoffice assets are missing. Rebuild the deployment image.');
    }
}
