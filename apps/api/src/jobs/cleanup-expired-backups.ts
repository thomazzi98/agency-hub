import { unlink } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { withSystemScope } from '../shared/tenant-scope.js';

export const CLEANUP_EXPIRED_BACKUPS_JOB = 'cleanup-expired-backups';

export interface BackupCleanupResult {
  examined: number;
  deleted: number;
}

/**
 * Deletes the dump files whose retention window has passed, **whether or not anyone
 * downloaded them** (11-backup-and-recovery.md). A copy of the entire database sitting
 * on the same VPS is a liability the moment it stops being useful, and the one thing
 * that must not be trusted here is that the admin remembered.
 *
 * The row stays: it is the record that a backup was taken and by whom. Only the file
 * goes, and clearing `storage_path` is what marks it as no longer downloadable.
 */
export async function cleanupExpiredBackups(
  prisma: PrismaClient,
  now = new Date(),
): Promise<BackupCleanupResult> {
  const expired = await withSystemScope(prisma, (tx) =>
    tx.backupJob.findMany({
      where: { storagePath: { not: null }, expiresAt: { lt: now } },
      select: { id: true, storagePath: true },
      take: 100,
    }),
  );

  let deleted = 0;
  for (const job of expired) {
    // A file that is already gone is the outcome we wanted, so it is not a failure.
    await unlink(job.storagePath!).catch(() => undefined);

    await withSystemScope(prisma, (tx) =>
      tx.backupJob.update({ where: { id: job.id }, data: { storagePath: null } }),
    );
    deleted += 1;
  }

  return { examined: expired.length, deleted };
}
