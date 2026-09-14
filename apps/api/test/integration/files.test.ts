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
import { withSystemScope } from '../../src/shared/tenant-scope.js';

const prisma = testPrisma();
let app: FastifyInstance;

interface World {
  companyA: Company;
  companyB: Company;
  admin: User;
  managerA: User;
  deleterA: User;
  clientA: User;
  contributorA: User;
  otherContributorA: User;
  managerB: User;
}

let world: World;

async function buildWorld(): Promise<World> {
  const [companyA, companyB] = await Promise.all([
    createTestCompany('Empresa A'),
    createTestCompany('Empresa B'),
  ]);

  const [admin, managerA, deleterA, clientA, contributorA, otherContributorA, managerB] =
    await Promise.all([
      createTestUser({ email: 'f-admin@example.com', role: 'agency_admin' }),
      createTestUser({ email: 'f-manager-a@example.com', role: 'agency_manager' }),
      createTestUser({ email: 'f-deleter-a@example.com', role: 'agency_manager' }),
      createTestUser({ email: 'f-client-a@example.com', role: 'client_manager' }),
      createTestUser({ email: 'f-contributor-a@example.com', role: 'contributor' }),
      createTestUser({ email: 'f-contributor-a2@example.com', role: 'contributor' }),
      createTestUser({ email: 'f-manager-b@example.com', role: 'agency_manager' }),
    ]);

  await Promise.all([
    grantMembership(managerA.id, companyA.id),
    // The one manager carrying the per-membership override.
    grantMembership(deleterA.id, companyA.id, { canDeleteCompanyFiles: true }),
    grantMembership(clientA.id, companyA.id),
    grantMembership(contributorA.id, companyA.id),
    grantMembership(otherContributorA.id, companyA.id),
    grantMembership(managerB.id, companyB.id),
  ]);

  return {
    companyA,
    companyB,
    admin,
    managerA,
    deleterA,
    clientA,
    contributorA,
    otherContributorA,
    managerB,
  };
}

const sessionFor = (user: User) => loginAs(app, user.email, DEFAULT_TEST_PASSWORD);

let fileCounter = 0;

async function seedFile(options: {
  companyId: string;
  uploadedById?: string;
  originalName?: string;
  status?: 'received' | 'approved';
}) {
  fileCounter += 1;
  return withSystemScope(prisma, (tx) =>
    tx.file.create({
      data: {
        companyId: options.companyId,
        originalName: options.originalName ?? `arquivo-${fileCounter}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: BigInt(1024),
        storageKey: `${options.companyId}/no-project/seed-${fileCounter}/arquivo.jpg`,
        uploadedById: options.uploadedById ?? null,
        status: options.status ?? 'received',
      },
    }),
  );
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

describe('file visibility', () => {
  it('shows every member of a company every file in it, whoever uploaded it', async () => {
    await seedFile({ companyId: world.companyA.id, uploadedById: world.contributorA.id });
    await seedFile({ companyId: world.companyA.id, uploadedById: world.managerA.id });
    await seedFile({ companyId: world.companyB.id });

    const cookie = await sessionFor(world.contributorA);
    const response = await app.inject(authed({ method: 'GET', url: '/api/files' }, cookie));

    expect(response.statusCode).toBe(200);
    expect(response.json().meta.total).toBe(2);
  });

  it('hides another company file behind the same 404 as a made-up id', async () => {
    const foreign = await seedFile({ companyId: world.companyB.id });
    const cookie = await sessionFor(world.contributorA);

    const read = await app.inject(
      authed({ method: 'GET', url: `/api/files/${foreign.id}` }, cookie),
    );
    const madeUp = await app.inject(
      authed({ method: 'GET', url: '/api/files/00000000-0000-4000-8000-000000000000' }, cookie),
    );

    expect(read.statusCode).toBe(404);
    expect(read.json()).toEqual(madeUp.json());
  });

  it('never exposes the storage key', async () => {
    const file = await seedFile({ companyId: world.companyA.id });
    const cookie = await sessionFor(world.contributorA);

    const detail = await app.inject(
      authed({ method: 'GET', url: `/api/files/${file.id}` }, cookie),
    );
    const list = await app.inject(authed({ method: 'GET', url: '/api/files' }, cookie));

    expect(detail.body).not.toContain('storageKey');
    expect(list.body).not.toContain('storageKey');
  });

  it('leaves soft-deleted files out of every listing', async () => {
    const file = await seedFile({ companyId: world.companyA.id });
    await withSystemScope(prisma, (tx) =>
      tx.file.update({ where: { id: file.id }, data: { deletedAt: new Date() } }),
    );

    const cookie = await sessionFor(world.contributorA);
    const list = await app.inject(authed({ method: 'GET', url: '/api/files' }, cookie));
    const detail = await app.inject(
      authed({ method: 'GET', url: `/api/files/${file.id}` }, cookie),
    );

    expect(list.json().meta.total).toBe(0);
    expect(detail.statusCode).toBe(404);
  });
});

describe('download', () => {
  it('mints a short-lived signed URL and records the download', async () => {
    const file = await seedFile({ companyId: world.companyA.id });
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed({ method: 'GET', url: `/api/files/${file.id}/download` }, cookie),
    );

    expect(response.statusCode).toBe(200);
    const url = response.json().data.url as string;
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('X-Amz-Expires');

    const actions = await systemRead(async (tx) =>
      (await tx.auditLog.findMany({ select: { action: true } })).map((entry) => entry.action),
    );
    expect(actions).toContain('file.downloaded');
  });

  it('refuses to sign a URL for another company file', async () => {
    const foreign = await seedFile({ companyId: world.companyB.id });
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed({ method: 'GET', url: `/api/files/${foreign.id}/download` }, cookie),
    );

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('X-Amz-Signature');
  });
});

describe('file status pipeline', () => {
  it('lets an agency_manager move a file through the pipeline', async () => {
    const file = await seedFile({ companyId: world.companyA.id });
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/files/${file.id}`, payload: { status: 'in_review' } },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('in_review');
  });

  it.each([
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses a status change to a %s', async (_role, pick) => {
    const file = await seedFile({ companyId: world.companyA.id });
    const cookie = await sessionFor(pick());

    const response = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/files/${file.id}`, payload: { status: 'approved' } },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });
});

describe('deleting a file directly', () => {
  it('lets anyone remove what they uploaded, as a soft delete', async () => {
    const file = await seedFile({
      companyId: world.companyA.id,
      uploadedById: world.contributorA.id,
    });
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/files/${file.id}` }, cookie),
    );

    expect(response.statusCode).toBe(200);
    const stored = await systemRead((tx) => tx.file.findUniqueOrThrow({ where: { id: file.id } }));
    // The row survives: the record that the file existed is never destroyed.
    expect(stored.deletedAt).not.toBeNull();
  });

  it('refuses to remove someone else upload, and says how to proceed', async () => {
    const file = await seedFile({
      companyId: world.companyA.id,
      uploadedById: world.otherContributorA.id,
    });
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/files/${file.id}` }, cookie),
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('deletion_requires_approval');

    const stored = await systemRead((tx) => tx.file.findUniqueOrThrow({ where: { id: file.id } }));
    expect(stored.deletedAt).toBeNull();
  });

  it('refuses an agency_manager without the per-membership override', async () => {
    const file = await seedFile({
      companyId: world.companyA.id,
      uploadedById: world.contributorA.id,
    });
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/files/${file.id}` }, cookie),
    );

    expect(response.statusCode).toBe(403);
  });

  it('allows an agency_manager who has can_delete_company_files', async () => {
    const file = await seedFile({
      companyId: world.companyA.id,
      uploadedById: world.contributorA.id,
    });
    const cookie = await sessionFor(world.deleterA);

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/files/${file.id}` }, cookie),
    );

    expect(response.statusCode).toBe(200);
  });
});

describe('deletion request workflow', () => {
  async function requestDeletion(cookie: string, targetId: string, reason = 'Enviado por engano.') {
    return app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/deletion-requests',
          payload: { targetType: 'file', targetId, reason },
        },
        cookie,
      ),
    );
  }

  it('takes a request from a contributor and leaves the file untouched until review', async () => {
    const file = await seedFile({
      companyId: world.companyA.id,
      uploadedById: world.otherContributorA.id,
    });
    const cookie = await sessionFor(world.contributorA);

    const created = await requestDeletion(cookie, file.id);

    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      status: 'pending',
      companyId: world.companyA.id,
      targetId: file.id,
    });

    const stored = await systemRead((tx) => tx.file.findUniqueOrThrow({ where: { id: file.id } }));
    expect(stored.deletedAt).toBeNull();
  });

  it('refuses a second pending request for the same item', async () => {
    const file = await seedFile({ companyId: world.companyA.id });
    const cookie = await sessionFor(world.contributorA);

    await requestDeletion(cookie, file.id);
    const duplicate = await requestDeletion(cookie, file.id);

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('deletion_request_pending');
  });

  it('refuses a request against another company file', async () => {
    const foreign = await seedFile({ companyId: world.companyB.id });
    const cookie = await sessionFor(world.contributorA);

    const response = await requestDeletion(cookie, foreign.id);

    expect(response.statusCode).toBe(404);
    expect(await systemRead((tx) => tx.deletionRequest.count())).toBe(0);
  });

  it('soft-deletes the file when an agency_admin approves', async () => {
    const file = await seedFile({ companyId: world.companyA.id });
    const requesterCookie = await sessionFor(world.contributorA);
    const created = await requestDeletion(requesterCookie, file.id);
    const requestId = created.json().data.id as string;

    const adminCookie = await sessionFor(world.admin);
    const approved = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/deletion-requests/${requestId}/approve`,
          payload: { reviewNotes: 'Confere.' },
        },
        adminCookie,
      ),
    );

    expect(approved.statusCode).toBe(200);
    expect(approved.json().data).toMatchObject({
      status: 'approved',
      reviewedById: world.admin.id,
      reviewNotes: 'Confere.',
    });

    const stored = await systemRead((tx) => tx.file.findUniqueOrThrow({ where: { id: file.id } }));
    expect(stored.deletedAt).not.toBeNull();
  });

  it('leaves the file intact when rejected, and keeps the reason on the record', async () => {
    const file = await seedFile({ companyId: world.companyA.id });
    const requesterCookie = await sessionFor(world.contributorA);
    const created = await requestDeletion(requesterCookie, file.id);
    const requestId = created.json().data.id as string;

    const adminCookie = await sessionFor(world.admin);
    const rejected = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/deletion-requests/${requestId}/reject`,
          payload: { reviewNotes: 'Ainda em uso.' },
        },
        adminCookie,
      ),
    );

    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.status).toBe('rejected');
    expect(rejected.json().data.reviewNotes).toBe('Ainda em uso.');

    const stored = await systemRead((tx) => tx.file.findUniqueOrThrow({ where: { id: file.id } }));
    expect(stored.deletedAt).toBeNull();
  });

  it('refuses review to an agency_manager, even one who may delete directly', async () => {
    const file = await seedFile({ companyId: world.companyA.id });
    const requesterCookie = await sessionFor(world.contributorA);
    const created = await requestDeletion(requesterCookie, file.id);
    const requestId = created.json().data.id as string;

    for (const reviewer of [world.managerA, world.deleterA]) {
      const cookie = await sessionFor(reviewer);
      const response = await app.inject(
        authed({ method: 'POST', url: `/api/deletion-requests/${requestId}/approve` }, cookie),
      );
      expect(response.statusCode).toBe(403);
    }

    const stored = await systemRead((tx) => tx.file.findUniqueOrThrow({ where: { id: file.id } }));
    expect(stored.deletedAt).toBeNull();
  });

  it('refuses to review the same request twice', async () => {
    const file = await seedFile({ companyId: world.companyA.id });
    const requesterCookie = await sessionFor(world.contributorA);
    const created = await requestDeletion(requesterCookie, file.id);
    const requestId = created.json().data.id as string;

    const adminCookie = await sessionFor(world.admin);
    await app.inject(
      authed({ method: 'POST', url: `/api/deletion-requests/${requestId}/approve` }, adminCookie),
    );
    const again = await app.inject(
      authed({ method: 'POST', url: `/api/deletion-requests/${requestId}/reject` }, adminCookie),
    );

    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('already_reviewed');
  });

  it('never shows one company requests to another', async () => {
    const file = await seedFile({ companyId: world.companyA.id });
    const requesterCookie = await sessionFor(world.contributorA);
    await requestDeletion(requesterCookie, file.id);

    const outsiderCookie = await sessionFor(world.managerB);
    const response = await app.inject(
      authed({ method: 'GET', url: '/api/deletion-requests' }, outsiderCookie),
    );

    expect(response.json().data).toEqual([]);
  });
});
