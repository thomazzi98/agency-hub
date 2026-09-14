import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/db.js';
import { healthRoutes } from './routes/health.js';

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
  const app = Fastify({ logger: options.logger ?? true });

  app.decorate('prisma', options.prisma ?? getPrismaClient());

  app.register(healthRoutes);

  return app;
}
