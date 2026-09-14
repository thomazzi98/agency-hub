import PgBoss from 'pg-boss';
import { getEnv } from '../config/env.js';

/**
 * pg-boss owns and migrates its own schema, which the least-privilege application role
 * deliberately cannot do (it has no DDL). The queue therefore connects with the owner
 * credentials, exactly like migrations — while every *application* query a job makes
 * still goes through the app-role Prisma client, so RLS keeps applying to tenant data.
 */
function queueConnectionString(): string {
  const env = getEnv();
  const url = new URL(env.DATABASE_URL);

  url.username = encodeURIComponent(env.DB_OWNER_USER);
  url.password = env.DB_OWNER_PASSWORD ? encodeURIComponent(env.DB_OWNER_PASSWORD) : '';
  // Prisma-only parameters mean nothing to pg-boss's own pool.
  url.search = '';

  return url.toString();
}

let boss: PgBoss | undefined;

export async function startQueue(): Promise<PgBoss> {
  if (boss) return boss;

  const env = getEnv();
  boss = new PgBoss({
    connectionString: queueConnectionString(),
    schema: 'pgboss',
    // On a 2-vCPU box, unbounded job concurrency starves the API of CPU exactly when a
    // heavy job runs (ADR-0011).
    max: env.WORKER_DATABASE_POOL_SIZE,
  });

  await boss.start();
  return boss;
}

export async function stopQueue(): Promise<void> {
  if (!boss) return;
  const current = boss;
  boss = undefined;
  await current.stop({ graceful: true });
}
