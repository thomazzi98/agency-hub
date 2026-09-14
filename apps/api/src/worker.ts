import { loadDotenv } from './config/dotenv.js';
import { getEnv } from './config/env.js';
import { disconnectPrismaClient, getPrismaClient } from './shared/db.js';
import { assertLeastPrivilegeDatabaseRole } from './shared/tenant-scope.js';
import { startQueue, stopQueue } from './jobs/queue.js';
import {
  CLEANUP_ABANDONED_UPLOADS_JOB,
  cleanupAbandonedUploads,
} from './jobs/cleanup-abandoned-uploads.js';
import {
  DISPATCH_PUSH_NOTIFICATIONS_JOB,
  dispatchPushNotifications,
} from './jobs/dispatch-push-notifications.js';
import { NOTIFY_OVERDUE_CONTENT_JOB, notifyOverdueContent } from './jobs/notify-overdue-content.js';
import { RUN_DATABASE_BACKUP_JOB, runDatabaseBackup } from './jobs/run-database-backup.js';
import {
  CLEANUP_EXPIRED_BACKUPS_JOB,
  cleanupExpiredBackups,
} from './jobs/cleanup-expired-backups.js';

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
  await boss.createQueue(DISPATCH_PUSH_NOTIFICATIONS_JOB);
  await boss.createQueue(NOTIFY_OVERDUE_CONTENT_JOB);
  await boss.createQueue(RUN_DATABASE_BACKUP_JOB);
  await boss.createQueue(CLEANUP_EXPIRED_BACKUPS_JOB);

  await boss.work(CLEANUP_ABANDONED_UPLOADS_JOB, { batchSize: 1 }, async () => {
    const result = await cleanupAbandonedUploads(prisma);
    console.log(
      `[worker] ${CLEANUP_ABANDONED_UPLOADS_JOB}: examined ${result.examined}, aborted ${result.aborted}, failed ${result.failed}`,
    );
  });

  await boss.work(DISPATCH_PUSH_NOTIFICATIONS_JOB, { batchSize: 1 }, async () => {
    const result = await dispatchPushNotifications(prisma);
    if (result.considered > 0) {
      console.log(
        `[worker] ${DISPATCH_PUSH_NOTIFICATIONS_JOB}: considered ${result.considered}, sent ${result.sent}, suppressed ${result.suppressed}, failed ${result.failed}, revoked ${result.revokedDevices}`,
      );
    }
  });

  await boss.work(NOTIFY_OVERDUE_CONTENT_JOB, { batchSize: 1 }, async () => {
    const result = await notifyOverdueContent(prisma);
    console.log(
      `[worker] ${NOTIFY_OVERDUE_CONTENT_JOB}: ${result.overdue} overdue, ${result.notified} notified`,
    );
  });

  // One at a time, and polled rather than pushed: the API cannot enqueue (pg-boss owns
  // its schema with owner credentials the API process deliberately does not use), and
  // a dump is heavy enough that a minute of latency costs nothing next to running two.
  await boss.work(RUN_DATABASE_BACKUP_JOB, { batchSize: 1 }, async () => {
    const result = await runDatabaseBackup(prisma);
    if (result.status !== 'skipped') {
      console.log(`[worker] ${RUN_DATABASE_BACKUP_JOB}: ${result.status} ${result.fileName ?? ''}`);
    }
  });

  await boss.work(CLEANUP_EXPIRED_BACKUPS_JOB, { batchSize: 1 }, async () => {
    const result = await cleanupExpiredBackups(prisma);
    if (result.examined > 0) {
      console.log(`[worker] ${CLEANUP_EXPIRED_BACKUPS_JOB}: deleted ${result.deleted}`);
    }
  });

  // Hourly, per 07-upload-architecture.md. pg-boss keeps one schedule per queue name,
  // so restarting the worker re-registers rather than accumulating duplicates.
  await boss.schedule(CLEANUP_ABANDONED_UPLOADS_JOB, env.UPLOAD_CLEANUP_CRON);
  await boss.schedule(NOTIFY_OVERDUE_CONTENT_JOB, env.CONTENT_OVERDUE_CRON);
  await boss.schedule(CLEANUP_EXPIRED_BACKUPS_JOB, env.BACKUP_CLEANUP_CRON);
  await boss.schedule(RUN_DATABASE_BACKUP_JOB, '* * * * *');

  // Every minute: the in-app centre is already real-time, so this only decides how
  // soon a phone buzzes — and a tighter loop would fight the 5-minute per-resource
  // window rather than help it (08-notifications-and-push.md).
  await boss.schedule(DISPATCH_PUSH_NOTIFICATIONS_JOB, '* * * * *');

  console.log(
    `[worker] ready; uploads cleanup (${env.UPLOAD_CLEANUP_CRON}), overdue content (${env.CONTENT_OVERDUE_CRON}), push dispatch (every minute, ${
      env.pushEnabled ? 'enabled' : 'no VAPID keys — in-app only'
    })`,
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
