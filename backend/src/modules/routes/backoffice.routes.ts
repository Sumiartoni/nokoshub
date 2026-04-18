import { FastifyPluginAsync } from 'fastify';
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

export const backofficeRoutes: FastifyPluginAsync = async (fastify) => {
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
