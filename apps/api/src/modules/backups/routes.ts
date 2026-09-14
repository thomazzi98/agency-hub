import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createDecipheriv } from 'node:crypto';
import { Transform } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../../config/env.js';
import { parseInput } from '../../shared/validation.js';
import { conflict, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { requireAgencyAdmin } from '../../shared/permissions.js';
import { requireActor, requireSession } from '../../shared/authentication.js';
import { isPasswordVerificationFresh } from '../auth/session-service.js';
import { withSystemScope } from '../../shared/tenant-scope.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

const backupSelect = {
  id: true,
  status: true,
  fileName: true,
  fileSizeBytes: true,
  errorMessage: true,
  requestedById: true,
  startedAt: true,
  completedAt: true,
  expiresAt: true,
  downloadedAt: true,
  createdAt: true,
} as const;

/**
 * `storage_path` is stripped here rather than merely left out of a select: a path on
 * the server is the one field on this row that must never reach a browser, and it is
 * selected internally for the download. `fileSizeBytes` is a `bigint`, which JSON
 * cannot carry — a dump is measured in megabytes, far inside what a number holds.
 */
function serialize<T extends { fileSizeBytes: bigint | null; storagePath?: string | null }>(
  job: T,
): Omit<T, 'storagePath' | 'fileSizeBytes'> & { fileSizeBytes: number | null } {
  const rest = { ...job };
  delete rest.storagePath;
  return {
    ...rest,
    fileSizeBytes: job.fileSizeBytes === null ? null : Number(job.fileSizeBytes),
  };
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Triggering a backup needs a fresh password, whatever the role
   * (10-authentication-and-sessions.md#reauthentication-for-sensitive-operations).
   * A session alone proves somebody logged in at some point; this proves they are the
   * person sitting there now.
   */
  app.post('/admin/backups', async (request, reply) => {
    const actor = requireActor(request);
    requireAgencyAdmin(actor);

    const session = requireSession(request);
    if (!isPasswordVerificationFresh(session)) {
      await writeAuditLog(app.prisma, {
        actorId: actor.userId,
        action: AuditAction.ReauthenticationFailed,
        entityType: 'backup_job',
        ipAddress: clientIp(request),
        metadata: { reason: 'stale' },
      });

      return reply.status(401).send({
        error: {
          code: 'reauthentication_required',
          message: 'Confirme sua senha para gerar um backup.',
        },
      });
    }

    // Single-flight, system-wide. The unique partial index is the real guarantee —
    // this check only exists to answer with a sentence rather than a constraint name.
    const job = await withSystemScope(app.prisma, async (tx) => {
      // A job the worker never finished must not block every future backup. Anything
      // still in flight past the threshold is written off as interrupted first.
      const staleBefore = new Date(Date.now() - getEnv().BACKUP_STALE_MINUTES * 60 * 1000);
      await tx.backupJob.updateMany({
        where: { status: { in: ['queued', 'processing'] }, createdAt: { lte: staleBefore } },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: 'Interrompido: o processamento não terminou no tempo esperado.',
        },
      });

      const running = await tx.backupJob.findFirst({
        where: { status: { in: ['queued', 'processing'] } },
        select: { id: true },
      });
      if (running) {
        throw conflict(
          'backup_already_running',
          'Já existe um backup em andamento. Aguarde ele terminar.',
        );
      }

      return tx.backupJob.create({
        data: { requestedById: actor.userId, status: 'queued' },
        select: backupSelect,
      });
    }).catch((error: unknown) => {
      // Two admins pressing the button at the same moment: the index rejects the
      // second, and it should read the same as losing the check above.
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw conflict(
          'backup_already_running',
          'Já existe um backup em andamento. Aguarde ele terminar.',
        );
      }
      throw error;
    });

    await writeAuditLog(app.prisma, {
      actorId: actor.userId,
      action: AuditAction.BackupRequested,
      entityType: 'backup_job',
      entityId: job.id,
      ipAddress: clientIp(request),
    });

    reply.code(202);
    return { data: serialize(job) };
  });

  app.get('/admin/backups', async (request) => {
    const actor = requireActor(request);
    requireAgencyAdmin(actor);

    const jobs = await withSystemScope(app.prisma, (tx) =>
      tx.backupJob.findMany({
        select: { ...backupSelect, storagePath: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );

    return {
      data: jobs.map((job) => ({
        ...serialize(job),
        // Whether the button should be there at all, answered by the server.
        downloadable: job.status === 'completed' && job.storagePath !== null,
      })),
    };
  });

  /**
   * The download re-checks the role independently of the trigger
   * (11-backup-and-recovery.md): the two endpoints are separate doors, and a role
   * change between pressing the button and clicking the link must close this one.
   *
   * The file is streamed, and decrypted on the way past when a key is configured —
   * a dump of the whole database is never read into memory at either end.
   */
  app.get('/admin/backups/:id/download', async (request, reply) => {
    const actor = requireActor(request);
    requireAgencyAdmin(actor);
    const params = parseInput(idParamsSchema, request.params);

    const job = await withSystemScope(app.prisma, (tx) =>
      tx.backupJob.findUnique({
        where: { id: params.id },
        select: { ...backupSelect, storagePath: true },
      }),
    );

    if (!job || job.status !== 'completed' || !job.storagePath) {
      throw notFound('not_found', 'Backup não encontrado ou já expirado.');
    }
    if (job.expiresAt && job.expiresAt < new Date()) {
      throw notFound('not_found', 'Backup não encontrado ou já expirado.');
    }

    const env = getEnv();
    let size: number;
    try {
      ({ size } = await stat(job.storagePath));
    } catch {
      throw notFound('not_found', 'Backup não encontrado ou já expirado.');
    }

    await withSystemScope(app.prisma, (tx) =>
      tx.backupJob.update({ where: { id: job.id }, data: { downloadedAt: new Date() } }),
    );
    await writeAuditLog(app.prisma, {
      actorId: actor.userId,
      action: AuditAction.BackupDownloaded,
      entityType: 'backup_job',
      entityId: job.id,
      ipAddress: clientIp(request),
    });

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${job.fileName}"`);
    // No caching anywhere: this is a copy of the entire database.
    reply.header('Cache-Control', 'no-store');

    if (!env.backupEncryptionKey) {
      reply.header('Content-Length', String(size));
      return reply.send(createReadStream(job.storagePath));
    }

    // Layout written by the job: 12-byte IV, ciphertext, 16-byte GCM tag. The tag is
    // read first — it has to be set before the last chunk is decrypted — and then the
    // body streams past without either side holding the dump in memory.
    const IV_BYTES = 12;
    const TAG_BYTES = 16;
    if (size <= IV_BYTES + TAG_BYTES) {
      throw unprocessable('backup_corrupt', 'O arquivo de backup está incompleto.');
    }

    const handle = await open(job.storagePath, 'r');
    try {
      const iv = Buffer.alloc(IV_BYTES);
      await handle.read(iv, 0, IV_BYTES, 0);
      const tag = Buffer.alloc(TAG_BYTES);
      await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);

      const decipher = createDecipheriv('aes-256-gcm', env.backupEncryptionKey, iv);
      decipher.setAuthTag(tag);

      const body = createReadStream(job.storagePath, {
        start: IV_BYTES,
        end: size - TAG_BYTES - 1,
      });

      // `Transform` only to keep the pipe readable; the decipher does the work.
      const passthrough = new Transform({
        transform(chunk, _encoding, callback) {
          callback(null, chunk);
        },
      });

      body.on('error', (error) => passthrough.destroy(error));
      body.pipe(decipher).pipe(passthrough);

      return reply.send(passthrough);
    } finally {
      await handle.close();
    }
  });
}
