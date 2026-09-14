import PgBoss from 'pg-boss';
import { getEnv } from '../config/env.js';
import { withOwnerCredentials } from '../shared/database-credentials.js';

let boss: PgBoss | undefined;

export async function startQueue(): Promise<PgBoss> {
  if (boss) return boss;

  const env = getEnv();
  boss = new PgBoss({
    // pg-boss owns and migrates its own schema, which the least-privilege application
    // role deliberately cannot do. Every *application* query a job makes still goes
    // through the app-role Prisma client, so RLS keeps applying to tenant data.
    connectionString: withOwnerCredentials(),
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
