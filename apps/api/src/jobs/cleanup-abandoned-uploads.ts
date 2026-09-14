import type { PrismaClient } from '@prisma/client';
import { getEnv } from '../config/env.js';
import { withSystemScope } from '../shared/tenant-scope.js';
import { AuditAction, writeAuditLog } from '../shared/audit.js';
import { abortMultipartUpload } from '../shared/storage.js';

export const CLEANUP_ABANDONED_UPLOADS_JOB = 'cleanup-abandoned-uploads';

export interface CleanupResult {
  examined: number;
  aborted: number;
  failed: number;
}

/**
 * A hard requirement, not an optimization: an incomplete multipart upload keeps its
 * already-transferred parts in the bucket, and the provider bills for them until the
 * upload is aborted (07-upload-architecture.md#abandoned-upload-cleanup).
 *
 * The R2 bucket also carries a lifecycle rule aborting incomplete uploads after seven
 * days, so a broken or stopped worker costs money slowly rather than indefinitely.
 *
 * Runs in the system scope: it acts for the platform, across every tenant, with no
 * user behind it.
 */
export async function cleanupAbandonedUploads(
  prisma: PrismaClient,
  now = new Date(),
): Promise<CleanupResult> {
  const inactiveSince = new Date(
    now.getTime() - getEnv().UPLOAD_SESSION_TTL_HOURS * 60 * 60 * 1000,
  );

  const stale = await withSystemScope(prisma, (tx) =>
    tx.uploadSession.findMany({
      where: {
        status: { in: ['pending', 'in_progress'] },
        lastActivityAt: { lt: inactiveSince },
      },
      select: {
        id: true,
        companyId: true,
        storageKey: true,
        providerUploadId: true,
        originalName: true,
      },
    }),
  );

  let aborted = 0;
  let failed = 0;

  for (const session of stale) {
    try {
      await abortMultipartUpload({
        storageKey: session.storageKey,
        providerUploadId: session.providerUploadId,
      });
    } catch {
      // Already gone at the provider (a previous partial run, or a lifecycle rule) is
      // not a failure — the session still needs marking. Anything else is retried on
      // the next run rather than leaving the row in limbo.
    }

    try {
      await withSystemScope(prisma, async (tx) => {
        await tx.uploadPart.deleteMany({ where: { uploadSessionId: session.id } });
        await tx.uploadSession.updateMany({
          where: { id: session.id, status: { in: ['pending', 'in_progress'] } },
          data: { status: 'expired' },
        });
        await writeAuditLog(tx, {
          companyId: session.companyId,
          action: AuditAction.UploadExpired,
          entityType: 'upload_session',
          entityId: session.id,
          metadata: { originalName: session.originalName },
        });
      });
      aborted += 1;
    } catch {
      failed += 1;
    }
  }

  return { examined: stale.length, aborted, failed };
}
