import { spawn } from 'node:child_process';
import { createCipheriv, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PrismaClient } from '@prisma/client';
import { getEnv } from '../config/env.js';
import { withSystemScope } from '../shared/tenant-scope.js';
import { withOwnerCredentials } from '../shared/database-credentials.js';

export const RUN_DATABASE_BACKUP_JOB = 'run-database-backup';

export interface BackupResult {
  status: 'completed' | 'failed' | 'skipped';
  fileName?: string;
  sizeBytes?: number;
  error?: string;
}

/** `database-backup-2026-09-13-230000.dump` (11-backup-and-recovery.md). */
export function backupFileName(now = new Date()): string {
  const [date, rest] = now.toISOString().split('T');
  const time = rest!.slice(0, 8).replace(/:/g, '');
  return `database-backup-${date}-${time}.dump`;
}

/**
 * Where the dump bytes come from. The seam exists because `pg_dump` is an external
 * binary: the tests need to prove the streaming, the encryption and the failure
 * handling without depending on a Postgres client being installed, and everything on
 * this side of the seam is the part worth proving.
 */
export interface DumpSource {
  stdout: Readable;
  /** Resolves when the dump finished cleanly; rejects with something worth logging. */
  completed: Promise<void>;
}

export type DumpRunner = () => DumpSource;

/**
 * The real thing: `pg_dump --format=custom`, which is compressed already, streamed on
 * stdout so the database is never held in memory.
 *
 * Connects with the owner credentials, exactly like migrations — the least-privilege
 * application role deliberately cannot read every table, which is the whole point of
 * it, and a dump taken through it would be quietly incomplete.
 */
export function spawnPgDump(): DumpSource {
  const env = getEnv();
  const child = spawn(
    env.PG_DUMP_PATH,
    ['--format=custom', '--no-owner', '--no-acl', '--dbname', withOwnerCredentials()],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    // Bounded: a dump that fails in a loop must not fill memory with its complaints.
    stderr = `${stderr}${chunk}`.slice(-4000);
  });

  const completed = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}: ${stderr.trim()}`));
    });
  });

  return { stdout: child.stdout, completed };
}

/**
 * Runs `pg_dump` for one queued job.
 *
 * The dump is streamed straight to disk and never held in application memory: on the
 * 2 vCPU / 8 GB box this runs on (ADR-0011), buffering a database would be the thing
 * that takes the site down while trying to protect it.
 *
 * `pg_dump -Fc` is already compressed. When a key is configured the bytes are then
 * encrypted with AES-256-GCM on the way to the file — IV first, authentication tag
 * last, so the download can verify it decrypted the file it was given rather than
 * whatever happened to be at that path.
 */
export async function runDatabaseBackup(
  prisma: PrismaClient,
  runDump: DumpRunner = spawnPgDump,
): Promise<BackupResult> {
  const env = getEnv();

  const job = await withSystemScope(prisma, (tx) =>
    tx.backupJob.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } }),
  );
  if (!job) return { status: 'skipped' };

  await withSystemScope(prisma, (tx) =>
    tx.backupJob.update({
      where: { id: job.id },
      data: { status: 'processing', startedAt: new Date() },
    }),
  );

  const fileName = backupFileName();
  const directory = path.resolve(env.BACKUP_DIRECTORY);
  const filePath = path.join(directory, `${job.id}-${fileName}`);

  let output: ReturnType<typeof createWriteStream> | undefined;
  let written: Promise<void> | undefined;

  try {
    await mkdir(directory, { recursive: true });

    const dump = runDump();
    output = createWriteStream(filePath, { mode: 0o600 });
    const sink = output;

    written = (async () => {
      if (!env.backupEncryptionKey) {
        await pipeline(dump.stdout, sink);
        return;
      }

      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', env.backupEncryptionKey, iv);
      sink.write(iv);
      // `end: false` so the tag can still be appended after the cipher finishes.
      await pipeline(dump.stdout, cipher, sink, { end: false });
      sink.end(cipher.getAuthTag());
      await new Promise<void>((resolve, reject) => {
        sink.once('finish', resolve);
        sink.once('error', reject);
      });
    })();

    // Awaited together: when the binary is missing, `exited` rejects before the pipe
    // does, and awaiting them in sequence would leave that rejection unhandled for a
    // tick — which Node reports as a crash rather than as this job failing.
    await Promise.all([written, dump.completed]);

    const { size } = await stat(filePath);
    const completedAt = new Date();

    await withSystemScope(prisma, (tx) =>
      tx.backupJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          fileName,
          storagePath: filePath,
          fileSizeBytes: BigInt(size),
          completedAt,
          expiresAt: new Date(completedAt.getTime() + env.BACKUP_RETENTION_MINUTES * 60 * 1000),
        },
      }),
    );

    return { status: 'completed', fileName, sizeBytes: size };
  } catch (error) {
    // A half-written dump is worse than none: it looks downloadable and is not.
    //
    // The write has to be stopped and settled *before* the file is removed. Deleting
    // while the stream is still open leaves the stream to recreate it a moment later —
    // an empty file nothing references and the cleanup job would never find, which is
    // exactly what happened the first time this path was exercised.
    output?.destroy();
    await written?.catch(() => undefined);
    await unlink(filePath).catch(() => undefined);

    const message = error instanceof Error ? error.message : String(error);
    await withSystemScope(prisma, (tx) =>
      tx.backupJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: message.slice(0, 2000),
        },
      }),
    );

    return { status: 'failed', error: message };
  }
}
