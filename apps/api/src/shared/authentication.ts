import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Session } from '@prisma/client';
import { getEnv } from '../config/env.js';
import { forbidden, unauthorized } from './errors.js';
import { loadActor, type AuthenticatedActor } from './actor.js';
import { findUsableSession, touchSession } from '../modules/auth/session-service.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Reachable without a session. Only `POST /auth/login` should set this. */
    isPublic?: boolean;
    /**
     * Reachable by an account that still owes a forced password change. Limited to
     * the handful of routes that flow needs (10-authentication-and-sessions.md).
     */
    allowWhilePasswordChangePending?: boolean;
  }

  interface FastifyRequest {
    actor: AuthenticatedActor | null;
    session: Session | null;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const env = getEnv();
  reply.setCookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_SLIDING_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  const env = getEnv();
  reply.clearCookie(env.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}

/** Narrows the nullable decoration on routes that the auth hook has already gated. */
export function requireActor(request: FastifyRequest): AuthenticatedActor {
  if (!request.actor) {
    throw unauthorized('unauthenticated', 'Sessão inválida ou expirada.');
  }
  return request.actor;
}

export function requireSession(request: FastifyRequest): Session {
  if (!request.session) {
    throw unauthorized('unauthenticated', 'Sessão inválida ou expirada.');
  }
  return request.session;
}

/**
 * Registered once for the whole `/api` scope, so a new route is protected by
 * default and must opt out explicitly — the opposite arrangement would make a
 * forgotten decorator a silent authentication bypass.
 */
export function registerAuthentication(app: FastifyInstance): void {
  app.decorateRequest('actor', null);
  app.decorateRequest('session', null);

  app.addHook('preHandler', async (request, reply) => {
    const routeConfig = request.routeOptions.config;

    if (routeConfig.isPublic) {
      return;
    }

    const env = getEnv();
    const token = request.cookies[env.SESSION_COOKIE_NAME];

    if (!token) {
      throw unauthorized('unauthenticated', 'Sessão inválida ou expirada.');
    }

    const session = await findUsableSession(app.prisma, token);
    if (!session) {
      clearSessionCookie(reply);
      throw unauthorized('unauthenticated', 'Sessão inválida ou expirada.');
    }

    const actor = await loadActor(app.prisma, session.userId, session.id);
    if (!actor) {
      clearSessionCookie(reply);
      throw unauthorized('account_inactive', 'Esta conta não está ativa.');
    }

    if (actor.mustChangePassword && !routeConfig.allowWhilePasswordChangePending) {
      request.actor = actor;
      request.session = session;
      throw forbidden('password_change_required', 'Defina uma nova senha antes de continuar.');
    }

    const touched = await touchSession(app.prisma, session);
    if (touched.lastActiveAt !== session.lastActiveAt) {
      setSessionCookie(reply, token);
    }

    request.actor = actor;
    request.session = touched;
  });
}
