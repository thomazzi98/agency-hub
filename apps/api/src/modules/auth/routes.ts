import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { clientIp, clientUserAgent } from '../../shared/request-context.js';
import {
  clearSessionCookie,
  requireActor,
  requireSession,
  setSessionCookie,
} from '../../shared/authentication.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import type { AuthenticatedActor } from '../../shared/actor.js';
import { changeOwnPassword, login, reauthenticate } from './auth-service.js';
import { revokeSession } from './session-service.js';

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});

const reauthenticateSchema = z.object({
  password: z.string().min(1).max(256),
});

function serializeActor(actor: AuthenticatedActor) {
  return {
    id: actor.userId,
    name: actor.name,
    email: actor.email,
    role: actor.role,
    mustChangePassword: actor.mustChangePassword,
    memberships: actor.memberships,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', { config: { isPublic: true } }, async (request, reply) => {
    const body = parseInput(loginSchema, request.body);

    const result = await login(app.prisma, {
      email: body.email,
      password: body.password,
      ipAddress: clientIp(request),
      userAgent: clientUserAgent(request),
    });

    setSessionCookie(reply, result.token);
    return { data: serializeActor(result.actor) };
  });

  app.post(
    '/auth/logout',
    { config: { allowWhilePasswordChangePending: true } },
    async (request, reply) => {
      const actor = requireActor(request);

      await revokeSession(app.prisma, actor.sessionId);
      await writeAuditLog(app.prisma, {
        actorId: actor.userId,
        action: AuditAction.Logout,
        entityType: 'session',
        entityId: actor.sessionId,
        ipAddress: clientIp(request),
      });

      clearSessionCookie(reply);
      return reply.status(204).send();
    },
  );

  app.get('/auth/me', { config: { allowWhilePasswordChangePending: true } }, async (request) => {
    const actor = requireActor(request);
    const session = requireSession(request);

    return {
      data: {
        ...serializeActor(actor),
        session: {
          id: session.id,
          expiresAt: session.expiresAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
          passwordVerifiedAt: session.passwordVerifiedAt,
        },
      },
    };
  });

  app.post(
    '/auth/change-password',
    { config: { allowWhilePasswordChangePending: true } },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = parseInput(changePasswordSchema, request.body);

      await changeOwnPassword(app.prisma, {
        actor,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        ipAddress: clientIp(request),
      });

      return reply.status(204).send();
    },
  );

  app.post('/auth/reauthenticate', async (request, reply) => {
    const actor = requireActor(request);
    const body = parseInput(reauthenticateSchema, request.body);

    await reauthenticate(app.prisma, actor, body.password, clientIp(request));

    return reply.status(204).send();
  });
}
