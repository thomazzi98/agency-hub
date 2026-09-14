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
  clientA: User;
  contributorA: User;
  managerB: User;
}

let world: World;

async function buildWorld(): Promise<World> {
  const [companyA, companyB] = await Promise.all([
    createTestCompany('Empresa A'),
    createTestCompany('Empresa B'),
  ]);

  const [admin, managerA, clientA, contributorA, managerB] = await Promise.all([
    createTestUser({ email: 'cal-admin@example.com', role: 'agency_admin' }),
    createTestUser({ email: 'cal-manager-a@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'cal-client-a@example.com', role: 'client_manager' }),
    createTestUser({ email: 'cal-contributor-a@example.com', role: 'contributor' }),
    createTestUser({ email: 'cal-manager-b@example.com', role: 'agency_manager' }),
  ]);

  await Promise.all([
    grantMembership(managerA.id, companyA.id),
    grantMembership(clientA.id, companyA.id),
    grantMembership(contributorA.id, companyA.id),
    grantMembership(managerB.id, companyB.id),
  ]);

  return { companyA, companyB, admin, managerA, clientA, contributorA, managerB };
}

const sessionFor = (user: User) => loginAs(app, user.email, DEFAULT_TEST_PASSWORD);

const DAY = 24 * 60 * 60 * 1000;
const isoDaysFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString();

let seedCounter = 0;

async function seedContent(options: {
  companyId: string;
  scheduledAt: Date;
  productionStatus?:
    | 'planned'
    | 'awaiting_material'
    | 'in_production'
    | 'in_review'
    | 'approved'
    | 'completed'
    | 'cancelled';
  title?: string;
  createdById?: string;
}) {
  seedCounter += 1;
  return withSystemScope(prisma, (tx) =>
    tx.content.create({
      data: {
        companyId: options.companyId,
        title: options.title ?? `Conteúdo ${seedCounter}`,
        scheduledAt: options.scheduledAt,
        productionStatus: options.productionStatus ?? 'planned',
        createdById: options.createdById ?? null,
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

describe('content management permissions', () => {
  const payload = () => ({
    companyId: world.companyA.id,
    title: 'Post de lançamento',
    type: 'reels',
    scheduledAt: isoDaysFromNow(3),
  });

  it('lets an agency_manager plan content in their company', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'POST', url: '/api/content', payload: payload() }, cookie),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      title: 'Post de lançamento',
      type: 'reels',
      productionStatus: 'planned',
      priority: 'medium',
    });
  });

  it.each([
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses content creation to a %s', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const response = await app.inject(
      authed({ method: 'POST', url: '/api/content', payload: payload() }, cookie),
    );

    expect(response.statusCode).toBe(403);
  });

  it('refuses to plan content in a company the actor cannot reach', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/content',
          payload: { ...payload(), companyId: world.companyB.id },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(404);
    expect(await systemRead((tx) => tx.content.count())).toBe(0);
  });

  it('refuses a responsible user without access to the company', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/content',
          payload: { ...payload(), responsibleUserId: world.managerB.id },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('responsible_without_access');
  });

  it('refuses a related file from another company', async () => {
    const foreignFile = await withSystemScope(prisma, (tx) =>
      tx.file.create({
        data: {
          companyId: world.companyB.id,
          originalName: 'alheio.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: BigInt(10),
          storageKey: `${world.companyB.id}/no-project/x/alheio.jpg`,
        },
      }),
    );
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/content',
          payload: { ...payload(), relatedFileId: foreignFile.id },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unknown_file');
  });
});

describe('calendar range queries', () => {
  beforeEach(async () => {
    await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + 2 * DAY),
    });
    await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + 40 * DAY),
    });
    await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + 200 * DAY),
    });
    await seedContent({
      companyId: world.companyB.id,
      scheduledAt: new Date(Date.now() + 2 * DAY),
    });
  });

  it('returns only what falls inside the window', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'GET',
          url: `/api/content/calendar?from=${isoDaysFromNow(0)}&to=${isoDaysFromNow(30)}`,
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
  });

  it('supports planning months ahead', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'GET',
          url: `/api/content/calendar?from=${isoDaysFromNow(0)}&to=${isoDaysFromNow(365)}`,
        },
        cookie,
      ),
    );

    expect(response.json().data).toHaveLength(3);
  });

  it('refuses a window too large to be bounded', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'GET',
          url: `/api/content/calendar?from=${isoDaysFromNow(0)}&to=${isoDaysFromNow(500)}`,
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('range_too_large');
  });

  it('never shows one company calendar to another', async () => {
    const cookie = await sessionFor(world.managerB);

    const response = await app.inject(
      authed(
        {
          method: 'GET',
          url: `/api/content/calendar?from=${isoDaysFromNow(0)}&to=${isoDaysFromNow(365)}`,
        },
        cookie,
      ),
    );

    // Company B has exactly one item; none of company A's three leak in.
    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0].companyId).toBe(world.companyB.id);
  });
});

describe('calendar flags', () => {
  it('marks an item scheduled for today', async () => {
    // The end of today, not midday: a fixed hour makes this pass or fail depending on
    // what time of day the suite happens to run, because anything already past is
    // also overdue. Found when a run after 12:00 UTC failed.
    const lateToday = new Date();
    lateToday.setUTCHours(23, 59, 59, 0);
    await seedContent({ companyId: world.companyA.id, scheduledAt: lateToday });
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(authed({ method: 'GET', url: '/api/content' }, cookie));

    expect(response.json().data[0]).toMatchObject({ isToday: true, isOverdue: false });
  });

  it('marks an unfinished item past its date as overdue, but not a finished one', async () => {
    await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() - 3 * DAY),
      productionStatus: 'in_production',
      title: 'Atrasado',
    });
    await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() - 3 * DAY),
      productionStatus: 'completed',
      title: 'Publicado',
    });
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(authed({ method: 'GET', url: '/api/content' }, cookie));
    const rows = response.json().data as { title: string; isOverdue: boolean }[];

    expect(rows.find((row) => row.title === 'Atrasado')?.isOverdue).toBe(true);
    expect(rows.find((row) => row.title === 'Publicado')?.isOverdue).toBe(false);
  });

  it('marks an item waiting on the client as blocked', async () => {
    await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + DAY),
      productionStatus: 'awaiting_material',
    });
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/content?flag=blocked' }, cookie),
    );

    expect(response.json().meta.total).toBe(1);
    expect(response.json().data[0].isBlockedOnClient).toBe(true);
  });

  it('filters by the overdue flag', async () => {
    await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() - DAY),
      productionStatus: 'planned',
    });
    await seedContent({ companyId: world.companyA.id, scheduledAt: new Date(Date.now() + DAY) });
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/content?flag=overdue' }, cookie),
    );

    expect(response.json().meta.total).toBe(1);
  });
});

describe('production tracking summary', () => {
  it('counts each stage and the overdue items', async () => {
    await seedContent({ companyId: world.companyA.id, scheduledAt: new Date(Date.now() + DAY) });
    await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + DAY),
      productionStatus: 'in_production',
    });
    await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() - DAY),
      productionStatus: 'awaiting_material',
    });
    await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() - DAY),
      productionStatus: 'completed',
    });
    // Another company's items must not be counted here.
    await seedContent({ companyId: world.companyB.id, scheduledAt: new Date(Date.now() + DAY) });

    const cookie = await sessionFor(world.managerA);
    const response = await app.inject(
      authed({ method: 'GET', url: '/api/content/summary' }, cookie),
    );

    expect(response.json().data).toMatchObject({
      planned: 1,
      inProduction: 1,
      awaitingMaterial: 1,
      completed: 1,
      overdue: 1,
      total: 4,
    });
  });
});

describe('rescheduling and duplicating', () => {
  it('moves an item to a new date', async () => {
    const content = await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + DAY),
    });
    const cookie = await sessionFor(world.managerA);
    const newDate = isoDaysFromNow(10);

    const response = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/content/${content.id}`, payload: { scheduledAt: newDate } },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(new Date(response.json().data.scheduledAt).toISOString()).toBe(
      new Date(newDate).toISOString(),
    );
  });

  it('duplicates an item to another date and restarts its pipeline', async () => {
    const content = await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + DAY),
      productionStatus: 'approved',
      title: 'Campanha de verão',
    });
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/content/${content.id}/duplicate`,
          payload: { scheduledAt: isoDaysFromNow(20) },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      title: 'Campanha de verão',
      // The copy has not been approved; carrying that over would claim work not done.
      productionStatus: 'planned',
    });
    expect(response.json().data.id).not.toBe(content.id);
    expect(await systemRead((tx) => tx.content.count())).toBe(2);
  });
});

describe('deleting content', () => {
  it('soft-deletes and removes it from the calendar', async () => {
    const content = await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + DAY),
      createdById: world.managerA.id,
    });
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/content/${content.id}` }, cookie),
    );

    expect(response.statusCode).toBe(200);
    const stored = await systemRead((tx) =>
      tx.content.findUniqueOrThrow({ where: { id: content.id } }),
    );
    expect(stored.deletedAt).not.toBeNull();

    const listed = await app.inject(authed({ method: 'GET', url: '/api/content' }, cookie));
    expect(listed.json().meta.total).toBe(0);
  });

  it('routes a contributor to the request flow instead', async () => {
    const content = await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + DAY),
      createdById: world.managerA.id,
    });
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/content/${content.id}` }, cookie),
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('deletion_requires_approval');
  });
});

describe('content joins the flows built before it', () => {
  it('accepts comments now that the table exists', async () => {
    const content = await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + DAY),
    });
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'content',
            commentableId: content.id,
            body: 'Podemos antecipar?',
          },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().data.companyId).toBe(world.companyA.id);
  });

  it('can be the target of a deletion request, and approval removes it', async () => {
    const content = await seedContent({
      companyId: world.companyA.id,
      scheduledAt: new Date(Date.now() + DAY),
      createdById: world.managerA.id,
    });

    const requesterCookie = await sessionFor(world.contributorA);
    const created = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/deletion-requests',
          payload: {
            targetType: 'content',
            targetId: content.id,
            reason: 'Conteúdo duplicado na agenda.',
          },
        },
        requesterCookie,
      ),
    );
    expect(created.statusCode).toBe(201);

    const adminCookie = await sessionFor(world.admin);
    const approved = await app.inject(
      authed(
        { method: 'POST', url: `/api/deletion-requests/${created.json().data.id}/approve` },
        adminCookie,
      ),
    );

    expect(approved.statusCode).toBe(200);
    const stored = await systemRead((tx) =>
      tx.content.findUniqueOrThrow({ where: { id: content.id } }),
    );
    expect(stored.deletedAt).not.toBeNull();
  });

  it('refuses a deletion request against another company content', async () => {
    const foreign = await seedContent({
      companyId: world.companyB.id,
      scheduledAt: new Date(Date.now() + DAY),
    });
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/deletion-requests',
          payload: { targetType: 'content', targetId: foreign.id, reason: 'Não deveria ver isso.' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(404);
  });
});
