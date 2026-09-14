import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { User } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TEST_PASSWORD,
  authed,
  buildTestApp,
  createTestCompany,
  createTestUser,
  grantMembership,
  loginAs,
} from '../helpers/app.js';
import { closeTestPrisma, resetDatabase, systemRead, testPrisma } from '../helpers/prisma.js';
import { withSystemScope } from '../../src/shared/tenant-scope.js';
import { resetEnvCache } from '../../src/config/env.js';
import {
  backupFileName,
  runDatabaseBackup,
  type DumpSource,
} from '../../src/jobs/run-database-backup.js';
import { cleanupExpiredBackups } from '../../src/jobs/cleanup-expired-backups.js';

const prisma = testPrisma();
let app: FastifyInstance;
let backupDirectory: string;

interface World {
  admin: User;
  otherAdmin: User;
  manager: User;
}

let world: World;

const sessionFor = (user: User) => loginAs(app, user.email, DEFAULT_TEST_PASSWORD);

/**
 * Stands in for `pg_dump`. Everything the job does with the bytes — streaming them to
 * disk without buffering, encrypting them, recording the size, cleaning up a failure —
 * is on this side of the seam and is what these tests are about; whether the Postgres
 * client happens to be installed on the machine running them is not.
 *
 * The magic bytes are the real ones, so the download assertions read the same as they
 * would against a genuine dump.
 */
const DUMP_BODY = Buffer.concat([
  Buffer.from('PGDMP', 'latin1'),
  Buffer.from('conteudo-de-teste-do-dump'.repeat(100), 'utf8'),
]);

function fakeDump(): DumpSource {
  return { stdout: Readable.from([DUMP_BODY]), completed: Promise.resolve() };
}

function failingDump(): DumpSource {
  const stdout = Readable.from([]);
  return {
    stdout,
    completed: Promise.reject(new Error('pg_dump exited with code 1: could not connect')),
  };
}

beforeAll(async () => {
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeTestPrisma();
});

beforeEach(async () => {
  await resetDatabase();
  backupDirectory = await mkdtemp(path.join(tmpdir(), 'agency-hub-backups-'));
  process.env.BACKUP_DIRECTORY = backupDirectory;
  resetEnvCache();

  const company = await createTestCompany('Empresa A');
  const [admin, otherAdmin, manager] = await Promise.all([
    createTestUser({ email: 'backup-admin@example.com', role: 'agency_admin' }),
    createTestUser({ email: 'backup-admin-2@example.com', role: 'agency_admin' }),
    createTestUser({ email: 'backup-manager@example.com', role: 'agency_manager' }),
  ]);
  await grantMembership(manager.id, company.id);

  world = { admin, otherAdmin, manager };
});

afterEach(async () => {
  await rm(backupDirectory, { recursive: true, force: true });
  delete process.env.BACKUP_DIRECTORY;
  delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.PG_DUMP_PATH;
  delete process.env.BACKUP_STALE_MINUTES;
  resetEnvCache();
});

/** Pushes a session's last password verification back beyond the step-up window. */
async function staleReauthentication(userId: string) {
  await withSystemScope(prisma, (tx) =>
    tx.session.updateMany({
      where: { userId },
      data: { passwordVerifiedAt: new Date(Date.now() - 60 * 60 * 1000) },
    }),
  );
}

describe('requesting a backup', () => {
  it('accepts an admin whose password was just verified', async () => {
    const cookie = await sessionFor(world.admin);

    const response = await app.inject(
      authed({ method: 'POST', url: '/api/admin/backups' }, cookie),
    );

    expect(response.statusCode).toBe(202);
    expect(response.json().data).toMatchObject({
      status: 'queued',
      requestedById: world.admin.id,
    });
  });

  it('refuses when the password verification has gone stale', async () => {
    const cookie = await sessionFor(world.admin);
    await staleReauthentication(world.admin.id);

    const response = await app.inject(
      authed({ method: 'POST', url: '/api/admin/backups' }, cookie),
    );

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('reauthentication_required');
    expect(await systemRead((tx) => tx.backupJob.count())).toBe(0);
  });

  it('proceeds once the password is re-entered', async () => {
    const cookie = await sessionFor(world.admin);
    await staleReauthentication(world.admin.id);

    const reauth = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/auth/reauthenticate',
          payload: { password: DEFAULT_TEST_PASSWORD },
        },
        cookie,
      ),
    );
    // 204: reauthentication proves something rather than returning anything.
    expect(reauth.statusCode).toBe(204);

    const response = await app.inject(
      authed({ method: 'POST', url: '/api/admin/backups' }, cookie),
    );
    expect(response.statusCode).toBe(202);
  });

  it('records the stale attempt in the audit log', async () => {
    const cookie = await sessionFor(world.admin);
    await staleReauthentication(world.admin.id);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));

    const audits = await systemRead((tx) =>
      tx.auditLog.findMany({ where: { action: 'auth.reauthentication_failed' } }),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.entityType).toBe('backup_job');
  });

  it('refuses a second request while one is in flight', async () => {
    const cookie = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));

    const second = await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('backup_already_running');
  });

  it('refuses a second request from a different admin too', async () => {
    const first = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, first));

    const second = await sessionFor(world.otherAdmin);
    const response = await app.inject(
      authed({ method: 'POST', url: '/api/admin/backups' }, second),
    );

    expect(response.statusCode).toBe(409);
  });

  it('supersedes a job the worker never finished, instead of locking backups out', async () => {
    process.env.BACKUP_STALE_MINUTES = '0';
    resetEnvCache();

    const cookie = await sessionFor(world.admin);
    const first = await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));

    const second = await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));

    expect(second.statusCode).toBe(202);
    const abandoned = await systemRead((tx) =>
      tx.backupJob.findUnique({ where: { id: first.json().data.id } }),
    );
    expect(abandoned?.status).toBe('failed');
    expect(abandoned?.errorMessage).toContain('Interrompido');

    delete process.env.BACKUP_STALE_MINUTES;
    resetEnvCache();
  });

  it('lets a new request through once the previous one finished', async () => {
    const cookie = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));
    await withSystemScope(prisma, (tx) =>
      tx.backupJob.updateMany({ data: { status: 'completed', completedAt: new Date() } }),
    );

    const response = await app.inject(
      authed({ method: 'POST', url: '/api/admin/backups' }, cookie),
    );
    expect(response.statusCode).toBe(202);
  });

  it.each([['agency_manager', () => world.manager]])(
    'refuses a %s outright',
    async (_role, pick) => {
      const cookie = await sessionFor(pick());

      const response = await app.inject(
        authed({ method: 'POST', url: '/api/admin/backups' }, cookie),
      );

      expect(response.statusCode).toBe(403);
    },
  );

  it('never lets a non-admin even list backups', async () => {
    const cookie = await sessionFor(world.manager);

    const response = await app.inject(authed({ method: 'GET', url: '/api/admin/backups' }, cookie));

    expect(response.statusCode).toBe(403);
  });
});

describe('the file name', () => {
  it('carries the moment it was taken', () => {
    const name = backupFileName(new Date('2026-09-13T23:00:00.000Z'));
    expect(name).toBe('database-backup-2026-09-13-230000.dump');
  });
});

describe('running the job', () => {
  it('produces a dump, records its size, and sets an expiry', async () => {
    const cookie = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));

    const result = await runDatabaseBackup(prisma, fakeDump);

    expect(result.status).toBe('completed');
    const job = await systemRead((tx) => tx.backupJob.findFirst());
    expect(job?.status).toBe('completed');
    expect(Number(job?.fileSizeBytes)).toBeGreaterThan(0);
    expect(job?.expiresAt).not.toBeNull();

    const written = await stat(job!.storagePath!);
    expect(written.size).toBe(Number(job!.fileSizeBytes));

    // Written through untouched: the dump on disk is exactly what came off the pipe.
    expect(await readFile(job!.storagePath!)).toEqual(DUMP_BODY);
  });

  it('does nothing when no job is waiting', async () => {
    expect((await runDatabaseBackup(prisma, fakeDump)).status).toBe('skipped');
  });

  it('encrypts at rest when a key is configured, and the download decrypts it', async () => {
    process.env.BACKUP_ENCRYPTION_KEY = 'a'.repeat(64);
    resetEnvCache();

    const cookie = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));
    expect((await runDatabaseBackup(prisma, fakeDump)).status).toBe('completed');

    const job = await systemRead((tx) => tx.backupJob.findFirst());
    const onDisk = await readFile(job!.storagePath!);
    expect(onDisk.subarray(0, 5).toString('latin1')).not.toBe('PGDMP');

    const download = await app.inject(
      authed({ method: 'GET', url: `/api/admin/backups/${job!.id}/download` }, cookie),
    );

    expect(download.statusCode).toBe(200);
    // Round-tripped: what comes back is byte-for-byte what went in.
    expect(download.rawPayload).toEqual(DUMP_BODY);
    expect(download.headers['content-disposition']).toContain(job!.fileName);
  });

  it('marks the job failed and leaves no half-written file behind', async () => {
    const cookie = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));

    const result = await runDatabaseBackup(prisma, failingDump);

    expect(result.status).toBe('failed');
    const job = await systemRead((tx) => tx.backupJob.findFirst());
    expect(job?.status).toBe('failed');
    expect(job?.errorMessage).toContain('could not connect');
    expect(job?.storagePath).toBeNull();

    // Nothing left in the directory to be mistaken for a usable dump.
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(backupDirectory)).toEqual([]);
  });
});

describe('downloading', () => {
  it('streams the dump and audits who took it', async () => {
    const cookie = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));
    await runDatabaseBackup(prisma, fakeDump);
    const job = await systemRead((tx) => tx.backupJob.findFirst());

    const response = await app.inject(
      authed({ method: 'GET', url: `/api/admin/backups/${job!.id}/download` }, cookie),
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.rawPayload).toEqual(DUMP_BODY);

    const audits = await systemRead((tx) =>
      tx.auditLog.findMany({ where: { action: 'backup.downloaded' } }),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(world.admin.id);
  });

  it('checks the role again at download time, not only at trigger time', async () => {
    const adminCookie = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, adminCookie));
    await runDatabaseBackup(prisma, fakeDump);
    const job = await systemRead((tx) => tx.backupJob.findFirst());

    const managerCookie = await sessionFor(world.manager);
    const response = await app.inject(
      authed({ method: 'GET', url: `/api/admin/backups/${job!.id}/download` }, managerCookie),
    );

    expect(response.statusCode).toBe(403);
  });

  it('refuses a job that never produced a file', async () => {
    const cookie = await sessionFor(world.admin);
    const created = await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));

    const response = await app.inject(
      authed(
        { method: 'GET', url: `/api/admin/backups/${created.json().data.id}/download` },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(404);
  });

  it('refuses one whose retention window has passed', async () => {
    const cookie = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));
    await runDatabaseBackup(prisma, fakeDump);

    await withSystemScope(prisma, (tx) =>
      tx.backupJob.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } }),
    );
    const job = await systemRead((tx) => tx.backupJob.findFirst());

    const response = await app.inject(
      authed({ method: 'GET', url: `/api/admin/backups/${job!.id}/download` }, cookie),
    );

    expect(response.statusCode).toBe(404);
  });
});

describe('cleanup', () => {
  it('deletes an expired dump even though nobody downloaded it', async () => {
    const cookie = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));
    await runDatabaseBackup(prisma, fakeDump);

    await withSystemScope(prisma, (tx) =>
      tx.backupJob.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } }),
    );
    const before = await systemRead((tx) => tx.backupJob.findFirst());

    const result = await cleanupExpiredBackups(prisma);

    expect(result.deleted).toBe(1);
    await expect(stat(before!.storagePath!)).rejects.toThrow();

    // The record of who took a backup and when outlives the file itself.
    const after = await systemRead((tx) => tx.backupJob.findFirst());
    expect(after?.status).toBe('completed');
    expect(after?.storagePath).toBeNull();
    expect(after?.downloadedAt).toBeNull();
  });

  it('leaves a dump inside its window alone', async () => {
    const cookie = await sessionFor(world.admin);
    await app.inject(authed({ method: 'POST', url: '/api/admin/backups' }, cookie));
    await runDatabaseBackup(prisma, fakeDump);

    const result = await cleanupExpiredBackups(prisma);

    expect(result.deleted).toBe(0);
    const job = await systemRead((tx) => tx.backupJob.findFirst());
    expect(job?.storagePath).not.toBeNull();
  });
});
