import type { FastifyInstance } from 'fastify';
import type { Company, Content, User } from '@prisma/client';
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
  contentA: Content;
  contentB: Content;
}

let world: World;

const DAY = 24 * 60 * 60 * 1000;
const isoDaysFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString();

let seedCounter = 0;

async function seedContent(companyId: string, scheduledAt = new Date()) {
  seedCounter += 1;
  return withSystemScope(prisma, (tx) =>
    tx.content.create({
      data: { companyId, title: `Conteúdo ${seedCounter}`, scheduledAt },
    }),
  );
}

async function buildWorld(): Promise<World> {
  const [companyA, companyB] = await Promise.all([
    createTestCompany('Empresa A'),
    createTestCompany('Empresa B'),
  ]);

  const [admin, managerA, clientA, contributorA, managerB] = await Promise.all([
    createTestUser({ email: 'pub-admin@example.com', role: 'agency_admin' }),
    createTestUser({ email: 'pub-manager-a@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'pub-client-a@example.com', role: 'client_manager' }),
    createTestUser({ email: 'pub-contributor-a@example.com', role: 'contributor' }),
    createTestUser({ email: 'pub-manager-b@example.com', role: 'agency_manager' }),
  ]);

  await Promise.all([
    grantMembership(managerA.id, companyA.id),
    grantMembership(clientA.id, companyA.id),
    grantMembership(contributorA.id, companyA.id),
    grantMembership(managerB.id, companyB.id),
  ]);

  const [contentA, contentB] = await Promise.all([
    seedContent(companyA.id),
    seedContent(companyB.id),
  ]);

  return {
    companyA,
    companyB,
    admin,
    managerA,
    clientA,
    contributorA,
    managerB,
    contentA,
    contentB,
  };
}

const sessionFor = (user: User) => loginAs(app, user.email, DEFAULT_TEST_PASSWORD);

function register(
  cookie: string,
  contentId: string,
  network: string,
  payload: Record<string, unknown>,
) {
  return app.inject(
    authed(
      { method: 'PUT', url: `/api/content/${contentId}/publications/${network}`, payload },
      cookie,
    ),
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

describe('registering a publication', () => {
  it('creates the network record and reports 201', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await register(cookie, world.contentA.id, 'instagram', {
      status: 'scheduled',
      publishedAt: isoDaysFromNow(2),
      notes: 'Feed + stories',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      contentId: world.contentA.id,
      network: 'instagram',
      status: 'scheduled',
      notes: 'Feed + stories',
    });
  });

  it('updates the same row on a second write instead of creating a second one', async () => {
    const cookie = await sessionFor(world.managerA);

    const created = await register(cookie, world.contentA.id, 'instagram', { status: 'planned' });
    const updated = await register(cookie, world.contentA.id, 'instagram', {
      status: 'published',
      link: 'https://instagram.com/p/abc123',
    });

    expect(created.statusCode).toBe(201);
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.id).toBe(created.json().data.id);

    const rows = await systemRead((tx) =>
      tx.publication.findMany({ where: { contentId: world.contentA.id } }),
    );
    expect(rows).toHaveLength(1);
  });

  it('keeps each network independent', async () => {
    const cookie = await sessionFor(world.managerA);

    await register(cookie, world.contentA.id, 'instagram', {
      status: 'published',
      link: 'https://instagram.com/p/abc123',
    });
    await register(cookie, world.contentA.id, 'tiktok', { status: 'planned' });

    const response = await app.inject(
      authed({ method: 'GET', url: `/api/content/${world.contentA.id}/publications` }, cookie),
    );

    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .data.map((row: { network: string; status: string }) => [row.network, row.status]),
    ).toEqual([
      ['instagram', 'published'],
      ['tiktok', 'planned'],
    ]);
  });

  it('stamps the publication date when a post is marked published without one', async () => {
    const cookie = await sessionFor(world.managerA);
    const before = Date.now();

    const response = await register(cookie, world.contentA.id, 'facebook', {
      status: 'published',
    });

    const publishedAt = Date.parse(response.json().data.publishedAt);
    expect(publishedAt).toBeGreaterThanOrEqual(before - 1_000);
    expect(publishedAt).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it('keeps the date the user typed when they give one', async () => {
    const cookie = await sessionFor(world.managerA);
    const when = new Date('2026-03-01T12:00:00.000Z').toISOString();

    const response = await register(cookie, world.contentA.id, 'facebook', {
      status: 'published',
      publishedAt: when,
    });

    expect(response.json().data.publishedAt).toBe(when);
  });

  it('refuses a link that is not a URL', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await register(cookie, world.contentA.id, 'instagram', {
      status: 'published',
      link: 'instagram/p/abc',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_error');
  });

  it('refuses a link that is a URL but not a web address', async () => {
    const cookie = await sessionFor(world.managerA);

    // Rendered as an <a href> for everyone in the company - and a valid URL all the same.
    const response = await register(cookie, world.contentA.id, 'instagram', {
      status: 'published',
      link: 'javascript:alert(document.cookie)',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].field).toBe('link');
  });

  it('refuses an unknown network', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await register(cookie, world.contentA.id, 'threads', { status: 'planned' });

    expect(response.statusCode).toBe(400);
  });

  it('refuses details on a network marked as not planned', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await register(cookie, world.contentA.id, 'youtube_shorts', {
      status: 'not_planned',
      link: 'https://youtube.com/shorts/abc',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('not_planned_with_details');
  });

  it('refuses a responsible user without access to the company', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await register(cookie, world.contentA.id, 'instagram', {
      status: 'planned',
      responsibleUserId: world.managerB.id,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('responsible_without_access');
  });
});

describe('publication permissions', () => {
  it.each([
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses registration to a %s', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const response = await register(cookie, world.contentA.id, 'instagram', { status: 'planned' });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden');
  });

  it('still lets a client_manager read their company publications', async () => {
    const managerCookie = await sessionFor(world.managerA);
    await register(managerCookie, world.contentA.id, 'instagram', { status: 'planned' });

    const clientCookie = await sessionFor(world.clientA);
    const response = await app.inject(
      authed(
        { method: 'GET', url: `/api/content/${world.contentA.id}/publications` },
        clientCookie,
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
  });
});

describe('tenant isolation', () => {
  it('reports another company content as missing when registering', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await register(cookie, world.contentB.id, 'instagram', { status: 'planned' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });

  it('answers a foreign content id exactly like an id that never existed', async () => {
    const cookie = await sessionFor(world.managerA);

    const [foreign, absent] = await Promise.all([
      app.inject(
        authed({ method: 'GET', url: `/api/content/${world.contentB.id}/publications` }, cookie),
      ),
      app.inject(
        authed({ method: 'GET', url: `/api/content/${crypto.randomUUID()}/publications` }, cookie),
      ),
    ]);

    expect(foreign.statusCode).toBe(absent.statusCode);
    expect(foreign.body).toBe(absent.body);
  });

  it('never lists another company publications', async () => {
    const cookieB = await sessionFor(world.managerB);
    await register(cookieB, world.contentB.id, 'instagram', { status: 'planned' });

    const cookieA = await sessionFor(world.managerA);
    const response = await app.inject(authed({ method: 'GET', url: '/api/publications' }, cookieA));

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
  });

  it('lets an agency_admin see both companies', async () => {
    const cookieA = await sessionFor(world.managerA);
    const cookieB = await sessionFor(world.managerB);
    await register(cookieA, world.contentA.id, 'instagram', { status: 'planned' });
    await register(cookieB, world.contentB.id, 'tiktok', { status: 'planned' });

    const adminCookie = await sessionFor(world.admin);
    const response = await app.inject(
      authed({ method: 'GET', url: '/api/publications' }, adminCookie),
    );

    expect(response.json().meta.total).toBe(2);
  });

  it('refuses a companyId filter outside the actor scope', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: `/api/publications?companyId=${world.companyB.id}` }, cookie),
    );

    expect(response.statusCode).toBe(404);
  });
});

describe('listing publications', () => {
  beforeEach(async () => {
    const cookie = await sessionFor(world.managerA);
    const second = await seedContent(world.companyA.id);
    await register(cookie, world.contentA.id, 'instagram', {
      status: 'scheduled',
      publishedAt: isoDaysFromNow(1),
    });
    await register(cookie, world.contentA.id, 'tiktok', {
      status: 'published',
      publishedAt: isoDaysFromNow(-1),
      link: 'https://tiktok.com/@ag/video/1',
    });
    await register(cookie, second.id, 'facebook', { status: 'failed' });
  });

  it('filters down to what is still owed', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/publications?pending=true' }, cookie),
    );

    expect(response.json().data.map((row: { network: string }) => row.network)).toEqual([
      'instagram',
    ]);
  });

  it('treats pending=false as the opt-out it reads like', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/publications?pending=false' }, cookie),
    );

    expect(response.json().meta.total).toBe(3);
  });

  it('filters by network and by status', async () => {
    const cookie = await sessionFor(world.managerA);

    const [byNetwork, byStatus] = await Promise.all([
      app.inject(authed({ method: 'GET', url: '/api/publications?network=tiktok' }, cookie)),
      app.inject(authed({ method: 'GET', url: '/api/publications?status=failed' }, cookie)),
    ]);

    expect(byNetwork.json().meta.total).toBe(1);
    expect(byStatus.json().data[0].network).toBe('facebook');
  });

  it('carries the parent content so a list can name what is pending', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/publications?pending=true' }, cookie),
    );

    expect(response.json().data[0].content).toMatchObject({
      id: world.contentA.id,
      companyId: world.companyA.id,
    });
  });
});

describe('content carries its networks', () => {
  it('embeds the publication records in the calendar window', async () => {
    const cookie = await sessionFor(world.managerA);
    await register(cookie, world.contentA.id, 'instagram', { status: 'published' });

    const response = await app.inject(
      authed(
        {
          method: 'GET',
          url: `/api/content/calendar?from=${isoDaysFromNow(-2)}&to=${isoDaysFromNow(2)}`,
        },
        cookie,
      ),
    );

    const row = response.json().data.find((item: { id: string }) => item.id === world.contentA.id);
    expect(row.publications).toHaveLength(1);
    expect(row.publications[0]).toMatchObject({ network: 'instagram', status: 'published' });
  });

  it('counts pending and failed publications in the production summary', async () => {
    const cookie = await sessionFor(world.managerA);
    const second = await seedContent(world.companyA.id);

    await register(cookie, world.contentA.id, 'instagram', { status: 'planned' });
    await register(cookie, world.contentA.id, 'tiktok', { status: 'scheduled' });
    await register(cookie, world.contentA.id, 'facebook', { status: 'published' });
    await register(cookie, second.id, 'youtube_shorts', { status: 'failed' });

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/content/summary' }, cookie),
    );

    expect(response.json().data).toMatchObject({ pendingPublication: 2, failedPublication: 1 });
  });

  it('leaves soft-deleted content out of the pending count', async () => {
    const cookie = await sessionFor(world.managerA);
    await register(cookie, world.contentA.id, 'instagram', { status: 'planned' });

    const adminCookie = await sessionFor(world.admin);
    const deleted = await app.inject(
      authed({ method: 'DELETE', url: `/api/content/${world.contentA.id}` }, adminCookie),
    );
    expect(deleted.statusCode).toBe(200);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/content/summary' }, cookie),
    );

    expect(response.json().data.pendingPublication).toBe(0);
  });
});

describe('removing a publication record', () => {
  it('deletes the row and audits it', async () => {
    const cookie = await sessionFor(world.managerA);
    await register(cookie, world.contentA.id, 'instagram', { status: 'planned' });

    const response = await app.inject(
      authed(
        { method: 'DELETE', url: `/api/content/${world.contentA.id}/publications/instagram` },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(200);

    const rows = await systemRead((tx) =>
      tx.publication.findMany({ where: { contentId: world.contentA.id } }),
    );
    expect(rows).toEqual([]);

    const audits = await systemRead((tx) =>
      tx.auditLog.findMany({ where: { action: 'publication.removed' } }),
    );
    expect(audits).toHaveLength(1);
  });

  it('reports a network that was never registered as missing', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        { method: 'DELETE', url: `/api/content/${world.contentA.id}/publications/tiktok` },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(404);
  });
});

describe('audit trail', () => {
  it('separates a first registration from an edit and from a status change', async () => {
    const cookie = await sessionFor(world.managerA);

    await register(cookie, world.contentA.id, 'instagram', { status: 'planned' });
    await register(cookie, world.contentA.id, 'instagram', { status: 'planned', notes: 'oi' });
    await register(cookie, world.contentA.id, 'instagram', { status: 'published' });

    const audits = await systemRead((tx) =>
      tx.auditLog.findMany({
        where: { entityType: 'publication' },
        orderBy: { createdAt: 'asc' },
      }),
    );

    expect(audits.map((entry) => entry.action)).toEqual([
      'publication.registered',
      'publication.updated',
      'publication.status_changed',
    ]);
    expect(audits[2]?.companyId).toBe(world.companyA.id);
  });
});
