import type { Company, User } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCompany, createTestUser, grantMembership } from '../helpers/app.js';
import { closeTestPrisma, resetDatabase, systemRead, testPrisma } from '../helpers/prisma.js';
import { withSystemScope } from '../../src/shared/tenant-scope.js';
import {
  createMultipartUpload,
  listCommittedParts,
  presignUploadPart,
} from '../../src/shared/storage.js';
import { putPart, syntheticBytes } from '../helpers/storage.js';
import { cleanupAbandonedUploads } from '../../src/jobs/cleanup-abandoned-uploads.js';

const prisma = testPrisma();

let company: Company;
let uploader: User;
let counter = 0;

/** Creates a real multipart upload at the provider, so the abort has something to release. */
async function seedSession(options: { lastActivityAt: Date; status?: 'pending' | 'in_progress' }) {
  counter += 1;
  const storageKey = `${company.id}/no-project/cleanup-${counter}/arquivo.mp4`;
  const providerUploadId = await createMultipartUpload({ storageKey, mimeType: 'video/mp4' });

  const session = await withSystemScope(prisma, (tx) =>
    tx.uploadSession.create({
      data: {
        companyId: company.id,
        initiatedById: uploader.id,
        storageKey,
        originalName: `arquivo-${counter}.mp4`,
        mimeType: 'video/mp4',
        declaredSizeBytes: BigInt(10 * 1024 * 1024),
        maxAllowedSizeBytes: BigInt(32 * 1024 * 1024 * 1024),
        partSizeBytes: 5 * 1024 * 1024,
        providerUploadId,
        status: options.status ?? 'in_progress',
        lastActivityAt: options.lastActivityAt,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    }),
  );

  return { session, storageKey, providerUploadId };
}

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeTestPrisma();
});

beforeEach(async () => {
  await resetDatabase();
  company = await createTestCompany('Empresa Limpeza');
  uploader = await createTestUser({ email: 'cleanup@example.com', role: 'contributor' });
  await grantMembership(uploader.id, company.id);
});

describe('cleanup-abandoned-uploads', () => {
  it('leaves a session that has been active recently alone', async () => {
    await seedSession({ lastActivityAt: new Date() });

    const result = await cleanupAbandonedUploads(prisma);

    expect(result.examined).toBe(0);
    const stored = await systemRead((tx) => tx.uploadSession.findFirstOrThrow());
    expect(stored.status).toBe('in_progress');
  }, 60_000);

  it('aborts the provider-side upload and expires a session idle past the TTL', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const { storageKey, providerUploadId } = await seedSession({ lastActivityAt: twoDaysAgo });

    // A real part, so the abort has actual provider-side storage to release — which is
    // the whole reason this job is a hard requirement rather than tidiness.
    const url = await presignUploadPart({
      storageKey,
      providerUploadId,
      partNumber: 1,
      expiresInSeconds: 600,
    });
    await putPart(url, syntheticBytes(5 * 1024 * 1024));
    expect(await listCommittedParts({ storageKey, providerUploadId })).toHaveLength(1);

    const result = await cleanupAbandonedUploads(prisma);

    expect(result).toMatchObject({ examined: 1, aborted: 1, failed: 0 });

    const stored = await systemRead((tx) => tx.uploadSession.findFirstOrThrow());
    expect(stored.status).toBe('expired');

    // The multipart upload no longer exists at the provider.
    await expect(listCommittedParts({ storageKey, providerUploadId })).rejects.toThrow();
  }, 120_000);

  it('clears the part bookkeeping and records why the session ended', async () => {
    const { session } = await seedSession({
      lastActivityAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    await withSystemScope(prisma, (tx) =>
      tx.uploadPart.create({
        data: {
          uploadSessionId: session.id,
          partNumber: 1,
          etag: '"abc"',
          sizeBytes: BigInt(5 * 1024 * 1024),
        },
      }),
    );

    await cleanupAbandonedUploads(prisma);

    expect(await systemRead((tx) => tx.uploadPart.count())).toBe(0);
    const actions = await systemRead(async (tx) =>
      (await tx.auditLog.findMany({ select: { action: true } })).map((entry) => entry.action),
    );
    expect(actions).toContain('upload.expired');
  }, 60_000);

  it('does not touch completed or already aborted sessions', async () => {
    const { session } = await seedSession({
      lastActivityAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    await withSystemScope(prisma, (tx) =>
      tx.uploadSession.update({ where: { id: session.id }, data: { status: 'completed' } }),
    );

    const result = await cleanupAbandonedUploads(prisma);

    expect(result.examined).toBe(0);
    const stored = await systemRead((tx) => tx.uploadSession.findFirstOrThrow());
    expect(stored.status).toBe('completed');
  }, 60_000);

  it('still expires the session when the provider upload is already gone', async () => {
    const { session, storageKey, providerUploadId } = await seedSession({
      lastActivityAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    // Simulates the bucket lifecycle rule having aborted it first, or a partial
    // previous run: the row must still be reconciled rather than retried forever.
    const { abortMultipartUpload } = await import('../../src/shared/storage.js');
    await abortMultipartUpload({ storageKey, providerUploadId });

    const result = await cleanupAbandonedUploads(prisma);

    expect(result).toMatchObject({ examined: 1, aborted: 1, failed: 0 });
    const stored = await systemRead((tx) =>
      tx.uploadSession.findUniqueOrThrow({ where: { id: session.id } }),
    );
    expect(stored.status).toBe('expired');
  }, 60_000);
});
