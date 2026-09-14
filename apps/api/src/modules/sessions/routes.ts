import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { requireActor } from '../../shared/authentication.js';
import { isAgencyAdmin } from '../../shared/actor.js';
import { forbidden, notFound } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { revokeAllSessionsForUser, revokeSession } from '../auth/session-service.js';

const listQuerySchema = z.object({
  userId: z.string().uuid().optional(),
});

const revokeParamsSchema = z.object({
  id: z.string().uuid(),
});

const revokeAllSchema = z.object({
  userId: z.string().uuid().optional(),
});

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sessions', async (request) => {
    const actor = requireActor(request);
    const query = parseInput(listQuerySchema, request.query);

    if (query.userId && query.userId !== actor.userId && !isAgencyAdmin(actor)) {
      throw forbidden('forbidden', 'Você não tem permissão para ver as sessões deste usuário.');
    }

    const sessions = await app.prisma.session.findMany({
      where: {
        userId: query.userId ?? actor.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastActiveAt: true,
        expiresAt: true,
      },
    });

    return {
      data: sessions.map((session) => ({
        ...session,
        isCurrent: session.id === actor.sessionId,
      })),
    };
  });

  app.delete('/sessions/:id', async (request, reply) => {
    const actor = requireActor(request);
    const params = parseInput(revokeParamsSchema, request.params);

    // Scoped in the query rather than fetched-then-checked, so a non-admin can
    // never learn that another user's session id exists (06, anti-IDOR).
    const session = await app.prisma.session.findFirst({
      where: {
        id: params.id,
        ...(isAgencyAdmin(actor) ? {} : { userId: actor.userId }),
      },
      select: { id: true, userId: true },
    });

    if (!session) {
      throw notFound('not_found', 'Sessão não encontrada.');
    }

    await revokeSession(app.prisma, session.id);
    await writeAuditLog(app.prisma, {
      actorId: actor.userId,
      action: AuditAction.SessionRevoked,
      entityType: 'session',
      entityId: session.id,
      ipAddress: clientIp(request),
      metadata: { targetUserId: session.userId },
    });

    return reply.status(204).send();
  });

  app.post('/sessions/revoke-all', async (request) => {
    const actor = requireActor(request);
    const body = parseInput(revokeAllSchema, request.body ?? {});

    const targetUserId = body.userId ?? actor.userId;
    const isSelf = targetUserId === actor.userId;

    if (!isSelf && !isAgencyAdmin(actor)) {
      throw forbidden(
        'forbidden',
        'Você não tem permissão para encerrar as sessões deste usuário.',
      );
    }

    // Revoking your own sessions keeps you logged in here; revoking someone else's
    // ("log out everywhere") must not spare any of theirs.
    const revoked = await revokeAllSessionsForUser(
      app.prisma,
      targetUserId,
      isSelf ? actor.sessionId : undefined,
    );

    await writeAuditLog(app.prisma, {
      actorId: actor.userId,
      action: AuditAction.AllSessionsRevoked,
      entityType: 'user',
      entityId: targetUserId,
      ipAddress: clientIp(request),
      metadata: { revokedCount: revoked },
    });

    return { data: { revokedCount: revoked } };
  });
}
