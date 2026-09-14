import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { getEnv } from './config/env.js';
import { getPrismaClient } from './shared/db.js';
import { AppError, validationErrorFrom } from './shared/errors.js';
import { registerAuthentication } from './shared/authentication.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './modules/auth/routes.js';
import { sessionRoutes } from './modules/sessions/routes.js';
import { companyRoutes } from './modules/companies/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { membershipRoutes } from './modules/memberships/routes.js';
import { brandingRoutes } from './modules/branding/routes.js';
import { projectRoutes } from './modules/projects/routes.js';
import { folderRoutes } from './modules/folders/routes.js';
import { uploadRoutes } from './modules/uploads/routes.js';
import { fileRoutes } from './modules/files/routes.js';
import { deletionRequestRoutes } from './modules/deletion-requests/routes.js';
import { commentRoutes } from './modules/comments/routes.js';
import { topicRoutes } from './modules/topics/routes.js';
import { calendarRoutes } from './modules/calendar/routes.js';
import { publicationRoutes } from './modules/publications/routes.js';
import { pendingRequestRoutes } from './modules/pending-requests/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export interface BuildAppOptions {
  /** Injected by the integration test suite so tests run against the test database. */
  prisma?: PrismaClient;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const env = getEnv();
  const app = Fastify({
    logger: options.logger ?? true,
    // Caddy terminates TLS and forwards the real client address; without this the
    // per-IP login limit would see one proxy address for every user.
    trustProxy: true,
  });

  app.decorate('prisma', options.prisma ?? getPrismaClient());

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toPayload());
    }

    if (error instanceof ZodError) {
      const appError = validationErrorFrom(error);
      return reply.status(appError.statusCode).send(appError.toPayload());
    }

    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) {
      return reply.status(statusCode).send({
        error: { code: 'bad_request', message: 'Requisição inválida.' },
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Erro interno. Tente novamente.' },
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({
      error: { code: 'not_found', message: 'Recurso não encontrado.' },
    }),
  );

  app.register(cookie);
  // Only the branding-asset route uses this; the media path never sends bytes here, so
  // the ceiling is deliberately small enough to be uninteresting as an attack surface.
  app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024, files: 1 } });

  if (env.corsOrigins.length > 0) {
    app.register(cors, { origin: env.corsOrigins, credentials: true });
  }

  app.register(healthRoutes);

  app.register(
    async (api) => {
      registerAuthentication(api);
      await api.register(authRoutes);
      await api.register(sessionRoutes);
      await api.register(companyRoutes);
      await api.register(userRoutes);
      await api.register(membershipRoutes);
      await api.register(brandingRoutes);
      await api.register(projectRoutes);
      await api.register(folderRoutes);
      await api.register(uploadRoutes);
      await api.register(fileRoutes);
      await api.register(deletionRequestRoutes);
      await api.register(commentRoutes);
      await api.register(topicRoutes);
      await api.register(calendarRoutes);
      await api.register(publicationRoutes);
      await api.register(pendingRequestRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
