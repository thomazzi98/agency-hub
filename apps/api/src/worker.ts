import { loadDotenv } from './config/dotenv.js';
import { getEnv } from './config/env.js';
import { disconnectPrismaClient, getPrismaClient } from './shared/db.js';
import { assertLeastPrivilegeDatabaseRole } from './shared/tenant-scope.js';
import { startQueue, stopQueue } from './jobs/queue.js';
import {
  CLEANUP_ABANDONED_UPLOADS_JOB,
  cleanupAbandonedUploads,
} from './jobs/cleanup-abandoned-uploads.js';

loadDotenv();

/**
 * Background jobs run in their own process so a slow or CPU-heavy job never blocks API
 * request handling (13-technical-architecture.md#background-jobs).
 */
async function main(): Promise<void> {
  const env = getEnv();
  const prisma = getPrismaClient();

  // The same guard the API applies: a job that touched tenant data with an RLS-exempt
  // role would be just as much of a leak.
  await assertLeastPrivilegeDatabaseRole(prisma);

  const boss = await startQueue();

  boss.on('error', (error) => {
    console.error('[worker] queue error', error);
  });

  await boss.createQueue(CLEANUP_ABANDONED_UPLOADS_JOB);

  await boss.work(CLEANUP_ABANDONED_UPLOADS_JOB, { batchSize: 1 }, async () => {
    const result = await cleanupAbandonedUploads(prisma);
    console.log(
      `[worker] ${CLEANUP_ABANDONED_UPLOADS_JOB}: examined ${result.examined}, aborted ${result.aborted}, failed ${result.failed}`,
    );
  });

  // Hourly, per 07-upload-architecture.md. pg-boss keeps one schedule per queue name,
  // so restarting the worker re-registers rather than accumulating duplicates.
  await boss.schedule(CLEANUP_ABANDONED_UPLOADS_JOB, env.UPLOAD_CLEANUP_CRON);

  console.log(
    `[worker] ready; ${CLEANUP_ABANDONED_UPLOADS_JOB} scheduled (${env.UPLOAD_CLEANUP_CRON})`,
  );
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`[worker] ${signal} received, shutting down`);
  try {
    await stopQueue();
    await disconnectPrismaClient();
    process.exit(0);
  } catch (error) {
    console.error('[worker] shutdown failed', error);
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, (received) => {
    void shutdown(received);
  });
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error);
  void disconnectPrismaClient().finally(() => process.exit(1));
});
