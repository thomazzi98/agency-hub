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
import { closeTestPrisma, resetDatabase, testPrisma } from '../helpers/prisma.js';
import { withSystemScope } from '../../src/shared/tenant-scope.js';
import { businessDayBounds } from '../../src/shared/business-day.js';

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

const DAY = 24 * 60 * 60 * 1000;

async function buildWorld(): Promise<World> {
  const [companyA, companyB] = await Promise.all([
    createTestCompany('Empresa A'),
    createTestCompany('Empresa B'),
  ]);

  const [admin, managerA, clientA, contributorA, managerB] = await Promise.all([
    createTestUser({ email: 'dash-admin@example.com', role: 'agency_admin' }),
    createTestUser({ email: 'dash-manager-a@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'dash-client-a@example.com', role: 'client_manager' }),
    createTestUser({ email: 'dash-contributor-a@example.com', role: 'contributor' }),
    createTestUser({ email: 'dash-manager-b@example.com', role: 'agency_manager' }),
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

/** A company with one of nearly everything, so every panel has something to show. */
async function seedWorkload(companyId: string, responsibleUserId: string) {
  return withSystemScope(prisma, async (tx) => {
    // Late today rather than midday: anything already past is also overdue, so a
    // fixed hour would make these assertions depend on the time the suite runs. "Today"
    // is the agency's day (APP_TIMEZONE), the same one the endpoint measures.
    const lateToday = new Date(businessDayBounds().startOfTomorrow.getTime() - 60 * 1000);

    const [today, overdue, producing] = await Promise.all([
      tx.content.create({
        data: { companyId, title: 'Post de hoje', scheduledAt: lateToday, responsibleUserId },
      }),
      tx.content.create({
        data: {
          companyId,
          title: 'Post atrasado',
          scheduledAt: new Date(Date.now() - 3 * DAY),
          productionStatus: 'in_production',
          responsibleUserId,
        },
      }),
      tx.content.create({
        data: {
          companyId,
          title: 'Em produção',
          scheduledAt: new Date(Date.now() + 3 * DAY),
          productionStatus: 'in_production',
        },
      }),
    ]);

    await tx.content.create({
      data: {
        companyId,
        title: 'Aguardando aprovação',
        scheduledAt: new Date(Date.now() + 4 * DAY),
        productionStatus: 'in_review',
      },
    });

    await tx.publication.createMany({
      data: [
        { contentId: today.id, network: 'instagram', status: 'planned' },
        { contentId: producing.id, network: 'tiktok', status: 'scheduled' },
        { contentId: overdue.id, network: 'facebook', status: 'published' },
      ],
    });

    await tx.file.create({
      data: {
        companyId,
        originalName: 'briefing.pdf',
        storageKey: `test/${crypto.randomUUID()}`,
        mimeType: 'application/pdf',
        sizeBytes: BigInt(2048),
        uploadedById: responsibleUserId,
      },
    });

    await tx.project.create({ data: { companyId, name: 'Projeto ativo', status: 'active' } });

    await tx.pendingRequest.createMany({
      data: [
        {
          companyId,
          title: 'Aguardando cliente',
          description: 'Precisamos do material.',
          responsibleUserId,
          status: 'awaiting_client',
        },
        {
          companyId,
          title: 'Vencida',
          description: 'Já passou do prazo.',
          responsibleUserId,
          status: 'open',
          dueDate: new Date(Date.now() - 5 * DAY),
        },
      ],
    });

    return { today, overdue, producing };
  });
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

describe('the agency dashboard', () => {
  beforeEach(async () => {
    await seedWorkload(world.companyA.id, world.clientA.id);
    await seedWorkload(world.companyB.id, world.managerB.id);
  });

  it('answers what needs doing, across the companies the actor can reach', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/dashboard/agency' }, cookie),
    );

    expect(response.statusCode).toBe(200);
    const data = response.json().data;

    // Only company A: the manager has no membership in B.
    expect(data.activeCompanies).toBe(1);
    expect(data.counts).toMatchObject({
      inProduction: 2,
      awaitingApproval: 1,
      requestsAwaitingClient: 1,
      requestsOverdue: 1,
      pendingPublications: 2,
      campaignsNeedingAttention: 0,
    });
    expect(data.todayContent).toHaveLength(1);
    expect(data.overdueContent[0].title).toBe('Post atrasado');
    expect(data.recentFiles[0].originalName).toBe('briefing.pdf');
  });

  it('counts every late item on its tile, not just the five its panel lists', async () => {
    await withSystemScope(prisma, async (tx) => {
      for (let index = 0; index < 7; index += 1) {
        await tx.content.create({
          data: {
            companyId: world.companyA.id,
            title: `Atrasado ${index}`,
            scheduledAt: new Date(Date.now() - (index + 2) * DAY),
            productionStatus: 'planned',
          },
        });
        await tx.pendingRequest.create({
          data: {
            companyId: world.companyA.id,
            title: `Vencida ${index}`,
            description: 'Sem resposta.',
            responsibleUserId: world.clientA.id,
            status: 'open',
            dueDate: new Date(Date.now() - (index + 2) * DAY),
          },
        });
      }
    });
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/dashboard/agency' }, cookie),
    );

    const data = response.json().data;
    // The seed's one of each, plus seven more.
    expect(data.counts.overdue).toBe(8);
    expect(data.counts.requestsOverdue).toBe(8);
    // The panels still show only the first few.
    expect(data.overdueContent).toHaveLength(5);
    expect(data.requestsOverdueItems).toHaveLength(5);
  });

  it("measures today in the agency's time zone, so an evening post is today's", async () => {
    const { startOfToday, startOfTomorrow } = businessDayBounds();
    await withSystemScope(prisma, (tx) =>
      tx.content.createMany({
        data: [
          {
            // 22:30 in São Paulo - already tomorrow in UTC, which is where it used to land.
            companyId: world.companyA.id,
            title: 'Horário nobre',
            scheduledAt: new Date(startOfToday.getTime() + 22.5 * 60 * 60 * 1000),
          },
          {
            companyId: world.companyA.id,
            title: 'Madrugada de amanhã',
            scheduledAt: new Date(startOfTomorrow.getTime() + 60 * 60 * 1000),
          },
        ],
      }),
    );
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/dashboard/agency' }, cookie),
    );

    const titles = response.json().data.todayContent.map((row: { title: string }) => row.title);
    expect(titles).toContain('Horário nobre');
    expect(titles).not.toContain('Madrugada de amanhã');
    expect(response.json().data.counts.today).toBe(titles.length);
  });

  it('sees both companies as an agency_admin', async () => {
    const cookie = await sessionFor(world.admin);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/dashboard/agency' }, cookie),
    );

    expect(response.json().data.activeCompanies).toBe(2);
    expect(response.json().data.counts.inProduction).toBe(4);
  });

  it('never leaks another company through a filter', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        { method: 'GET', url: `/api/dashboard/agency?companyId=${world.companyB.id}` },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });

  it.each([
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses the agency dashboard to a %s', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/dashboard/agency' }, cookie),
    );

    expect(response.statusCode).toBe(403);
  });

  it('shows recent activity to an admin and nothing to a manager', async () => {
    const [adminCookie, managerCookie] = await Promise.all([
      sessionFor(world.admin),
      sessionFor(world.managerA),
    ]);

    const [asAdmin, asManager] = await Promise.all([
      app.inject(authed({ method: 'GET', url: '/api/dashboard/agency' }, adminCookie)),
      app.inject(authed({ method: 'GET', url: '/api/dashboard/agency' }, managerCookie)),
    ]);

    expect(Array.isArray(asAdmin.json().data.recentActivity)).toBe(true);
    expect(asManager.json().data.recentActivity).toBeNull();
  });

  describe('filters', () => {
    it('narrows to one company', async () => {
      const cookie = await sessionFor(world.admin);

      const response = await app.inject(
        authed(
          { method: 'GET', url: `/api/dashboard/agency?companyId=${world.companyA.id}` },
          cookie,
        ),
      );

      expect(response.json().data.activeCompanies).toBe(1);
      expect(response.json().data.counts.inProduction).toBe(2);
    });

    it('narrows to one responsible party', async () => {
      const cookie = await sessionFor(world.admin);

      const response = await app.inject(
        authed(
          { method: 'GET', url: `/api/dashboard/agency?responsibleUserId=${world.clientA.id}` },
          cookie,
        ),
      );

      // Only the two items company A gave that person, and only one is overdue.
      expect(response.json().data.overdueContent).toHaveLength(1);
      expect(response.json().data.todayContent).toHaveLength(1);
      expect(response.json().data.counts.inProduction).toBe(1);
    });

    it('narrows to a period', async () => {
      const cookie = await sessionFor(world.admin);
      const from = new Date(Date.now() + 2 * DAY).toISOString();
      const to = new Date(Date.now() + 10 * DAY).toISOString();

      const response = await app.inject(
        authed({ method: 'GET', url: `/api/dashboard/agency?from=${from}&to=${to}` }, cookie),
      );

      // Nothing today or overdue inside a window that starts the day after tomorrow.
      expect(response.json().data.todayContent).toEqual([]);
      expect(response.json().data.overdueContent).toEqual([]);
      expect(response.json().data.counts.inProduction).toBe(2);
    });

    it('narrows to a production status', async () => {
      const cookie = await sessionFor(world.admin);

      const response = await app.inject(
        authed({ method: 'GET', url: '/api/dashboard/agency?productionStatus=in_review' }, cookie),
      );

      expect(response.json().data.counts.awaitingApproval).toBe(2);
      expect(response.json().data.counts.inProduction).toBe(0);
    });
  });
});

describe('the company dashboard', () => {
  beforeEach(async () => {
    await seedWorkload(world.companyA.id, world.clientA.id);
    await seedWorkload(world.companyB.id, world.managerB.id);
  });

  it('shows a client their own company and nothing else', async () => {
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        { method: 'GET', url: `/api/dashboard/company?companyId=${world.companyA.id}` },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.counts).toMatchObject({
      plannedContent: 1,
      inProduction: 2,
      openRequests: 2,
      activeProjects: 1,
      pendingPublications: 2,
      campaigns: 0,
    });
    expect(data.myRequests).toHaveLength(2);
    expect(data.recentFiles).toHaveLength(1);
  });

  it('lists what is coming up, soonest first, and leaves the past out', async () => {
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        { method: 'GET', url: `/api/dashboard/company?companyId=${world.companyA.id}` },
        cookie,
      ),
    );

    const titles = response.json().data.upcomingContent.map((row: { title: string }) => row.title);
    expect(titles).toEqual(['Post de hoje', 'Em produção', 'Aguardando aprovação']);
  });

  it('reports another company as missing', async () => {
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        { method: 'GET', url: `/api/dashboard/company?companyId=${world.companyB.id}` },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(404);
  });

  it('answers a foreign company exactly like one that never existed', async () => {
    const cookie = await sessionFor(world.clientA);

    const [foreign, absent] = await Promise.all([
      app.inject(
        authed(
          { method: 'GET', url: `/api/dashboard/company?companyId=${world.companyB.id}` },
          cookie,
        ),
      ),
      app.inject(
        authed(
          { method: 'GET', url: `/api/dashboard/company?companyId=${crypto.randomUUID()}` },
          cookie,
        ),
      ),
    ]);

    expect(foreign.statusCode).toBe(absent.statusCode);
    expect(foreign.body).toBe(absent.body);
  });

  it('counts every request waiting on the reader, not just the five it lists', async () => {
    await withSystemScope(prisma, (tx) =>
      tx.pendingRequest.createMany({
        data: Array.from({ length: 6 }, (_, index) => ({
          companyId: world.companyA.id,
          title: `Pedido ${index}`,
          description: 'Aguardando resposta.',
          responsibleUserId: world.clientA.id,
          status: 'awaiting_client' as const,
        })),
      }),
    );
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        { method: 'GET', url: `/api/dashboard/company?companyId=${world.companyA.id}` },
        cookie,
      ),
    );

    expect(response.json().data.counts.myRequests).toBe(8);
    expect(response.json().data.myRequests).toHaveLength(5);
  });

  it('counts campaigns the way the campaign list shows them, per role', async () => {
    await withSystemScope(prisma, async (tx) => {
      const account = await tx.adAccount.create({
        data: { companyId: world.companyA.id, platform: 'meta', name: 'Conta principal' },
      });
      await tx.campaign.createMany({
        data: [
          {
            companyId: world.companyA.id,
            adAccountId: account.id,
            platform: 'meta',
            name: 'Visível',
            visibleToClient: true,
          },
          {
            companyId: world.companyA.id,
            adAccountId: account.id,
            platform: 'meta',
            name: 'Interna',
            visibleToClient: false,
          },
        ],
      });
    });

    const countFor = async (user: User) => {
      const response = await app.inject(
        authed(
          { method: 'GET', url: `/api/dashboard/company?companyId=${world.companyA.id}` },
          await sessionFor(user),
        ),
      );
      return response.json().data.counts.campaigns as number;
    };

    expect(await countFor(world.managerA)).toBe(2);
    expect(await countFor(world.clientA)).toBe(1);
    expect(await countFor(world.contributorA)).toBe(0);
  });

  it('shows only the reader their own outstanding requests', async () => {
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed(
        { method: 'GET', url: `/api/dashboard/company?companyId=${world.companyA.id}` },
        cookie,
      ),
    );

    // Both requests are addressed to the client, not to this contributor.
    expect(response.json().data.myRequests).toEqual([]);
    expect(response.json().data.counts.openRequests).toBe(2);
  });
});
