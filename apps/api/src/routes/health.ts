import type { FastifyInstance } from 'fastify';

/**
 * Operational probes, deliberately outside the `/api` response envelope
 * (docs/sdd/15-api-conventions.md) — they are consumed by Docker/Caddy, not the SPA.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    } catch (error) {
      app.log.error({ err: error }, 'readiness probe failed');
      return reply.status(503).send({ status: 'degraded', database: 'unreachable' });
    }
  });
}
