import type { FastifyInstance } from 'fastify';
import type { Company, User } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { putPart, syntheticBytes } from '../helpers/storage.js';
import { withSystemScope } from '../../src/shared/tenant-scope.js';
import { headObject, listCommittedParts } from '../../src/shared/storage.js';

const prisma = testPrisma();
let app: FastifyInstance;

const PART_SIZE = 5 * 1024 * 1024;

interface World {
  companyA: Company;
  companyB: Company;
  contributorA: User;
  managerB: User;
}

let world: World;

async function buildWorld(): Promise<World> {
  const [companyA, companyB] = await Promise.all([
    createTestCompany('Empresa A'),
    createTestCompany('Empresa B'),
  ]);
  const [contributorA, managerB] = await Promise.all([
    createTestUser({ email: 'up-contributor-a@example.com', role: 'contributor' }),
    createTestUser({ email: 'up-manager-b@example.com', role: 'agency_manager' }),
  ]);

  await Promise.all([
    grantMembership(contributorA.id, companyA.id),
    grantMembership(managerB.id, companyB.id),
  ]);

  return { companyA, companyB, contributorA, managerB };
}

const sessionFor = (user: User) => loginAs(app, user.email, DEFAULT_TEST_PASSWORD);

interface CreatedSession {
  id: string;
  partSizeBytes: number;
  partCount: number;
  status: string;
}

async function createSession(
  cookie: string,
  overrides: Partial<{
    companyId: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    folderId: string | null;
    projectId: string | null;
  }> = {},
) {
  return app.inject(
    authed(
      {
        method: 'POST',
        url: '/api/uploads',
        payload: {
          companyId: overrides.companyId ?? world.companyA.id,
          originalName: overrides.originalName ?? 'foto.jpg',
          mimeType: overrides.mimeType ?? 'image/jpeg',
          sizeBytes: overrides.sizeBytes ?? 1024,
          ...(overrides.folderId !== undefined ? { folderId: overrides.folderId } : {}),
          ...(overrides.projectId !== undefined ? { projectId: overrides.projectId } : {}),
        },
      },
      cookie,
    ),
  );
}

async function presignParts(cookie: string, sessionId: string, partNumbers: number[]) {
  const response = await app.inject(
    authed(
      {
        method: 'GET',
        url: `/api/uploads/${sessionId}/parts?partNumbers=${partNumbers.join(',')}`,
      },
      cookie,
    ),
  );
  return response;
}

/** Drives a whole upload the way the browser does: PUT to storage, then register. */
async function uploadAllParts(cookie: string, session: CreatedSession, body: Buffer) {
  for (let partNumber = 1; partNumber <= session.partCount; partNumber += 1) {
    const chunk = body.subarray(
      (partNumber - 1) * session.partSizeBytes,
      partNumber * session.partSizeBytes,
    );

    const presigned = await presignParts(cookie, session.id, [partNumber]);
    const url = presigned.json().data.parts[0].url as string;

    const etag = await putPart(url, chunk);

    const registered = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/uploads/${session.id}/parts/${partNumber}`,
          payload: { etag, sizeBytes: chunk.byteLength },
        },
        cookie,
      ),
    );
    expect(registered.statusCode).toBe(200);
  }
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
  world = await buildWorld();
});

describe('POST /api/uploads (create session)', () => {
  it('creates a session and reports the chunking the client must use', async () => {
    const cookie = await sessionFor(world.contributorA);

    const response = await createSession(cookie, { sizeBytes: PART_SIZE + 1024 });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      status: 'pending',
      partSizeBytes: PART_SIZE,
      partCount: 2,
      sizeBytes: PART_SIZE + 1024,
    });
  });

  it('rejects a file larger than the configured maximum before any bytes move', async () => {
    const cookie = await sessionFor(world.contributorA);

    const response = await createSession(cookie, { sizeBytes: 40 * 1024 * 1024 * 1024 });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('file_too_large');
    expect(await systemRead((tx) => tx.uploadSession.count())).toBe(0);
  });

  it('rejects a disallowed content type', async () => {
    const cookie = await sessionFor(world.contributorA);

    const response = await createSession(cookie, {
      originalName: 'script.sh',
      mimeType: 'application/x-sh',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('file_type_not_allowed');
  });

  it('refuses to start an upload into another company', async () => {
    const cookie = await sessionFor(world.contributorA);

    const response = await createSession(cookie, { companyId: world.companyB.id });

    expect(response.statusCode).toBe(404);
    expect(await systemRead((tx) => tx.uploadSession.count())).toBe(0);
  });

  it('refuses a folder belonging to another company', async () => {
    const foreignFolder = await withSystemScope(prisma, (tx) =>
      tx.folder.create({ data: { companyId: world.companyB.id, name: 'Alheia' } }),
    );
    const cookie = await sessionFor(world.contributorA);

    const response = await createSession(cookie, { folderId: foreignFolder.id });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unknown_folder');
  });

  it('caps how many uploads one company may have in flight', async () => {
    const cookie = await sessionFor(world.contributorA);

    for (let index = 0; index < 5; index += 1) {
      const created = await createSession(cookie, { originalName: `arquivo-${index}.jpg` });
      expect(created.statusCode).toBe(201);
    }

    const blocked = await createSession(cookie, { originalName: 'excedente.jpg' });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('too_many_active_uploads');
  });

  it('puts the file id in the storage key so the object is not guessable', async () => {
    const cookie = await sessionFor(world.contributorA);
    await createSession(cookie, {
      originalName: 'relatório final.pdf',
      mimeType: 'application/pdf',
    });

    const session = await systemRead((tx) => tx.uploadSession.findFirstOrThrow());

    expect(session.storageKey.startsWith(`${world.companyA.id}/no-project/`)).toBe(true);
    expect(session.storageKey).toMatch(
      /^[0-9a-f-]{36}\/no-project\/[0-9a-f-]{36}\/relat.*final\.pdf$/,
    );
  });
});

describe('full upload lifecycle against real storage', () => {
  it('uploads a single-part file and creates the File row', async () => {
    const cookie = await sessionFor(world.contributorA);
    const body = syntheticBytes(64 * 1024);

    const created = await createSession(cookie, {
      originalName: 'pequeno.jpg',
      sizeBytes: body.byteLength,
    });
    const session = created.json().data as CreatedSession;
    expect(session.partCount).toBe(1);

    await uploadAllParts(cookie, session, body);

    const completed = await app.inject(
      authed({ method: 'POST', url: `/api/uploads/${session.id}/complete` }, cookie),
    );

    expect(completed.statusCode).toBe(200);
    expect(completed.json().data).toMatchObject({
      originalName: 'pequeno.jpg',
      sizeBytes: body.byteLength,
      status: 'received',
      companyId: world.companyA.id,
    });

    const stored = await systemRead((tx) => tx.uploadSession.findFirstOrThrow());
    expect(stored.status).toBe('completed');
    expect(stored.fileId).toBe(completed.json().data.id);

    const object = await headObject(stored.storageKey);
    expect(object?.sizeBytes).toBe(body.byteLength);
  }, 60_000);

  it('uploads a multi-part file and assembles it at the right size', async () => {
    const cookie = await sessionFor(world.contributorA);
    const body = syntheticBytes(PART_SIZE + 128 * 1024);

    const created = await createSession(cookie, {
      originalName: 'video.mp4',
      mimeType: 'video/mp4',
      sizeBytes: body.byteLength,
    });
    const session = created.json().data as CreatedSession;
    expect(session.partCount).toBe(2);

    await uploadAllParts(cookie, session, body);

    const completed = await app.inject(
      authed({ method: 'POST', url: `/api/uploads/${session.id}/complete` }, cookie),
    );

    expect(completed.statusCode).toBe(200);
    expect(completed.json().data.sizeBytes).toBe(body.byteLength);

    const stored = await systemRead((tx) => tx.uploadSession.findFirstOrThrow());
    const object = await headObject(stored.storageKey);
    expect(object?.sizeBytes).toBe(body.byteLength);
  }, 120_000);

  it('is idempotent when completion is called twice', async () => {
    const cookie = await sessionFor(world.contributorA);
    const body = syntheticBytes(32 * 1024);

    const created = await createSession(cookie, { sizeBytes: body.byteLength });
    const session = created.json().data as CreatedSession;
    await uploadAllParts(cookie, session, body);

    const first = await app.inject(
      authed({ method: 'POST', url: `/api/uploads/${session.id}/complete` }, cookie),
    );
    const second = await app.inject(
      authed({ method: 'POST', url: `/api/uploads/${session.id}/complete` }, cookie),
    );

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.id).toBe(first.json().data.id);
    expect(await systemRead((tx) => tx.file.count())).toBe(1);
  }, 60_000);

  it('refuses completion while parts are still missing', async () => {
    const cookie = await sessionFor(world.contributorA);
    const body = syntheticBytes(PART_SIZE + 64 * 1024);

    const created = await createSession(cookie, {
      originalName: 'incompleto.mp4',
      mimeType: 'video/mp4',
      sizeBytes: body.byteLength,
    });
    const session = created.json().data as CreatedSession;

    // Only the first of two parts.
    const presigned = await presignParts(cookie, session.id, [1]);
    const etag = await putPart(
      presigned.json().data.parts[0].url as string,
      body.subarray(0, PART_SIZE),
    );
    await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/uploads/${session.id}/parts/1`,
          payload: { etag, sizeBytes: PART_SIZE },
        },
        cookie,
      ),
    );

    const completed = await app.inject(
      authed({ method: 'POST', url: `/api/uploads/${session.id}/complete` }, cookie),
    );

    expect(completed.statusCode).toBe(422);
    expect(completed.json().error.code).toBe('upload_incomplete');
    expect(await systemRead((tx) => tx.file.count())).toBe(0);
  }, 60_000);
});

describe('resume', () => {
  it('reports parts the storage provider holds even when the register call never arrived', async () => {
    const cookie = await sessionFor(world.contributorA);
    const body = syntheticBytes(PART_SIZE + 64 * 1024);

    const created = await createSession(cookie, {
      originalName: 'retomado.mp4',
      mimeType: 'video/mp4',
      sizeBytes: body.byteLength,
    });
    const session = created.json().data as CreatedSession;

    // PUT the part but deliberately skip registering it — the exact failure the
    // reconciliation exists for (a network drop right after the PUT succeeded).
    const presigned = await presignParts(cookie, session.id, [1]);
    await putPart(presigned.json().data.parts[0].url as string, body.subarray(0, PART_SIZE));

    expect(await systemRead((tx) => tx.uploadPart.count())).toBe(0);

    const resumed = await app.inject(
      authed({ method: 'GET', url: `/api/uploads/${session.id}` }, cookie),
    );

    expect(resumed.statusCode).toBe(200);
    const parts = resumed.json().data.committedParts as { partNumber: number }[];
    expect(parts.map((part) => part.partNumber)).toEqual([1]);
    // The mirror is repaired from the provider's answer.
    expect(await systemRead((tx) => tx.uploadPart.count())).toBe(1);
  }, 60_000);

  it('refuses to resume an expired session', async () => {
    const cookie = await sessionFor(world.contributorA);
    const created = await createSession(cookie);
    const session = created.json().data as CreatedSession;

    await systemRead((tx) =>
      tx.uploadSession.update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );

    const resumed = await app.inject(
      authed({ method: 'GET', url: `/api/uploads/${session.id}` }, cookie),
    );

    expect(resumed.statusCode).toBe(409);
    expect(resumed.json().error.code).toBe('upload_not_resumable');
  });
});

describe('abort', () => {
  it('releases the provider-side parts and marks the session aborted', async () => {
    const cookie = await sessionFor(world.contributorA);
    const body = syntheticBytes(PART_SIZE + 32 * 1024);

    const created = await createSession(cookie, {
      originalName: 'cancelado.mp4',
      mimeType: 'video/mp4',
      sizeBytes: body.byteLength,
    });
    const session = created.json().data as CreatedSession;

    const presigned = await presignParts(cookie, session.id, [1]);
    await putPart(presigned.json().data.parts[0].url as string, body.subarray(0, PART_SIZE));

    const stored = await systemRead((tx) => tx.uploadSession.findFirstOrThrow());
    expect(
      await listCommittedParts({
        storageKey: stored.storageKey,
        providerUploadId: stored.providerUploadId,
      }),
    ).toHaveLength(1);

    const aborted = await app.inject(
      authed({ method: 'POST', url: `/api/uploads/${session.id}/abort` }, cookie),
    );
    expect(aborted.statusCode).toBe(200);

    const after = await systemRead((tx) => tx.uploadSession.findFirstOrThrow());
    expect(after.status).toBe('aborted');
    expect(await systemRead((tx) => tx.uploadPart.count())).toBe(0);

    // The multipart upload no longer exists at the provider, so listing it fails.
    await expect(
      listCommittedParts({
        storageKey: stored.storageKey,
        providerUploadId: stored.providerUploadId,
      }),
    ).rejects.toThrow();
  }, 60_000);

  it('refuses to abort an already completed upload', async () => {
    const cookie = await sessionFor(world.contributorA);
    const body = syntheticBytes(16 * 1024);

    const created = await createSession(cookie, { sizeBytes: body.byteLength });
    const session = created.json().data as CreatedSession;
    await uploadAllParts(cookie, session, body);
    await app.inject(
      authed({ method: 'POST', url: `/api/uploads/${session.id}/complete` }, cookie),
    );

    const aborted = await app.inject(
      authed({ method: 'POST', url: `/api/uploads/${session.id}/abort` }, cookie),
    );

    expect(aborted.statusCode).toBe(409);
  }, 60_000);
});

describe('cross-tenant access to an upload session', () => {
  it('hides another company session behind the same 404 as a made-up id', async () => {
    const ownerCookie = await sessionFor(world.contributorA);
    const created = await createSession(ownerCookie);
    const sessionId = created.json().data.id as string;

    const intruderCookie = await sessionFor(world.managerB);

    const read = await app.inject(
      authed({ method: 'GET', url: `/api/uploads/${sessionId}` }, intruderCookie),
    );
    const parts = await app.inject(
      authed(
        { method: 'GET', url: `/api/uploads/${sessionId}/parts?partNumbers=1` },
        intruderCookie,
      ),
    );
    const completed = await app.inject(
      authed({ method: 'POST', url: `/api/uploads/${sessionId}/complete` }, intruderCookie),
    );
    const aborted = await app.inject(
      authed({ method: 'POST', url: `/api/uploads/${sessionId}/abort` }, intruderCookie),
    );

    expect([read.statusCode, parts.statusCode, completed.statusCode, aborted.statusCode]).toEqual([
      404, 404, 404, 404,
    ]);

    const survivor = await systemRead((tx) => tx.uploadSession.findFirstOrThrow());
    expect(survivor.status).toBe('pending');
  });

  it('never mints a presigned URL for a session outside the actor scope', async () => {
    const ownerCookie = await sessionFor(world.contributorA);
    const created = await createSession(ownerCookie);
    const sessionId = created.json().data.id as string;

    const intruderCookie = await sessionFor(world.managerB);
    const response = await presignParts(intruderCookie, sessionId, [1]);

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('X-Amz-Signature');
  });
});

describe('presigned part URLs', () => {
  it('issues at most one batch at a time', async () => {
    const cookie = await sessionFor(world.contributorA);
    const created = await createSession(cookie, { sizeBytes: PART_SIZE * 20 });
    const session = created.json().data as CreatedSession;

    const response = await presignParts(
      cookie,
      session.id,
      Array.from({ length: 20 }, (_, index) => index + 1),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.parts).toHaveLength(10);
  });

  it('refuses a part number beyond what the declared size needs', async () => {
    const cookie = await sessionFor(world.contributorA);
    const created = await createSession(cookie, { sizeBytes: 1024 });
    const session = created.json().data as CreatedSession;

    const response = await presignParts(cookie, session.id, [2]);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('invalid_part_number');
  });
});
