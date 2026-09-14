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
import { withSystemScope, withTenantScope } from '../../src/shared/tenant-scope.js';

const prisma = testPrisma();
let app: FastifyInstance;

interface World {
  companyA: Company;
  companyB: Company;
  admin: User;
  /** Has the campaign override in company A. */
  managerA: User;
  /** Same role, same company, no override — the point of the test. */
  managerNoOverride: User;
  clientA: User;
  contributorA: User;
  managerB: User;
  accountA: { id: string };
}

let world: World;

async function buildWorld(): Promise<World> {
  const [companyA, companyB] = await Promise.all([
    createTestCompany('Empresa A'),
    createTestCompany('Empresa B'),
  ]);

  const [admin, managerA, managerNoOverride, clientA, contributorA, managerB] = await Promise.all([
    createTestUser({ email: 'camp-admin@example.com', role: 'agency_admin' }),
    createTestUser({ email: 'camp-manager-a@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'camp-manager-plain@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'camp-client-a@example.com', role: 'client_manager' }),
    createTestUser({ email: 'camp-contributor-a@example.com', role: 'contributor' }),
    createTestUser({ email: 'camp-manager-b@example.com', role: 'agency_manager' }),
  ]);

  await Promise.all([
    grantMembership(managerA.id, companyA.id, { canManageCampaigns: true }),
    grantMembership(managerNoOverride.id, companyA.id),
    grantMembership(clientA.id, companyA.id),
    grantMembership(contributorA.id, companyA.id),
    grantMembership(managerB.id, companyB.id, { canManageCampaigns: true }),
  ]);

  const accountA = await withSystemScope(prisma, (tx) =>
    tx.adAccount.create({
      data: { companyId: companyA.id, platform: 'meta', name: 'Conta Meta' },
      select: { id: true },
    }),
  );

  return {
    companyA,
    companyB,
    admin,
    managerA,
    managerNoOverride,
    clientA,
    contributorA,
    managerB,
    accountA,
  };
}

const sessionFor = (user: User) => loginAs(app, user.email, DEFAULT_TEST_PASSWORD);

function createCampaign(cookie: string, overrides: Record<string, unknown> = {}) {
  return app.inject(
    authed(
      {
        method: 'POST',
        url: '/api/campaigns',
        payload: {
          companyId: world.companyA.id,
          adAccountId: world.accountA.id,
          name: 'Campanha de lançamento',
          objective: 'Alcance',
          dailyBudget: 150.5,
          ...overrides,
        },
      },
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

describe('the can_manage_campaigns override', () => {
  it('lets a manager who has it create a campaign', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await createCampaign(cookie);

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      name: 'Campanha de lançamento',
      platform: 'meta',
      status: 'active',
      visibleToClient: true,
      dailyBudget: '150.5',
    });
  });

  it('refuses the same manager in a company where they do not have it', async () => {
    const cookie = await sessionFor(world.managerNoOverride);

    const response = await createCampaign(cookie);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('campaign_management_not_granted');
  });

  it('is per-membership, not per-user', async () => {
    // The same person, granted in A and not in B.
    await grantMembership(world.managerA.id, world.companyB.id);
    const accountB = await withSystemScope(prisma, (tx) =>
      tx.adAccount.create({
        data: { companyId: world.companyB.id, platform: 'tiktok', name: 'Conta TikTok' },
        select: { id: true },
      }),
    );
    const cookie = await sessionFor(world.managerA);

    const [inA, inB] = await Promise.all([
      createCampaign(cookie),
      createCampaign(cookie, { companyId: world.companyB.id, adAccountId: accountB.id }),
    ]);

    expect(inA.statusCode).toBe(201);
    expect(inB.statusCode).toBe(403);
  });

  it('always lets an agency_admin through', async () => {
    const cookie = await sessionFor(world.admin);

    expect((await createCampaign(cookie)).statusCode).toBe(201);
  });

  it.each([
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('never lets a %s create one', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    expect((await createCampaign(cookie)).statusCode).toBe(403);
  });
});

describe('change history', () => {
  it('writes exactly one row per field that actually changed', async () => {
    const cookie = await sessionFor(world.managerA);
    const created = await createCampaign(cookie);
    const campaignId = created.json().data.id;

    const response = await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/campaigns/${campaignId}`,
          payload: {
            name: 'Campanha renomeada',
            status: 'paused',
            // Resubmitted unchanged — must not produce a row.
            objective: 'Alcance',
            changeNote: 'Cliente pediu pausa.',
          },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.changedFields.sort()).toEqual(['name', 'status']);

    const history = await systemRead((tx) =>
      tx.campaignHistory.findMany({ where: { campaignId }, orderBy: { fieldName: 'asc' } }),
    );

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      fieldName: 'name',
      oldValue: 'Campanha de lançamento',
      newValue: 'Campanha renomeada',
      note: 'Cliente pediu pausa.',
      changedById: world.managerA.id,
    });
    expect(history[1]).toMatchObject({
      fieldName: 'status',
      oldValue: 'active',
      newValue: 'paused',
    });
  });

  it('records a money figure moving, and one being cleared', async () => {
    const cookie = await sessionFor(world.managerA);
    const created = await createCampaign(cookie, { reportedSpend: 1000 });
    const campaignId = created.json().data.id;

    await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/campaigns/${campaignId}`,
          payload: { reportedSpend: 1250.75, dailyBudget: null },
        },
        cookie,
      ),
    );

    const history = await systemRead((tx) =>
      tx.campaignHistory.findMany({ where: { campaignId }, orderBy: { fieldName: 'asc' } }),
    );

    expect(history.map((row) => row.fieldName)).toEqual(['dailyBudget', 'reportedSpend']);
    expect(history[0]).toMatchObject({ oldValue: '150.5', newValue: null });
    expect(history[1]).toMatchObject({ oldValue: '1000', newValue: '1250.75' });
  });

  it('writes nothing when an edit changes nothing', async () => {
    const cookie = await sessionFor(world.managerA);
    const created = await createCampaign(cookie);
    const campaignId = created.json().data.id;

    const response = await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/campaigns/${campaignId}`,
          payload: { name: 'Campanha de lançamento' },
        },
        cookie,
      ),
    );

    expect(response.json().data.changedFields).toEqual([]);
    const history = await systemRead((tx) =>
      tx.campaignHistory.findMany({ where: { campaignId } }),
    );
    expect(history).toEqual([]);
  });

  it('comes back with the campaign, newest first', async () => {
    const cookie = await sessionFor(world.managerA);
    const created = await createCampaign(cookie);
    const campaignId = created.json().data.id;

    await app.inject(
      authed(
        { method: 'PATCH', url: `/api/campaigns/${campaignId}`, payload: { status: 'paused' } },
        cookie,
      ),
    );

    const response = await app.inject(
      authed({ method: 'GET', url: `/api/campaigns/${campaignId}` }, cookie),
    );

    expect(response.json().data.history).toHaveLength(1);
    expect(response.json().data.history[0].fieldName).toBe('status');
  });

  it('cannot be rewritten, because the database has no policy that would allow it', async () => {
    const cookie = await sessionFor(world.managerA);
    const created = await createCampaign(cookie);
    const campaignId = created.json().data.id;
    await app.inject(
      authed(
        { method: 'PATCH', url: `/api/campaigns/${campaignId}`, payload: { status: 'paused' } },
        cookie,
      ),
    );

    const actor = {
      userId: world.managerA.id,
      name: 'M',
      email: world.managerA.email,
      role: 'agency_manager' as const,
      mustChangePassword: false,
      sessionId: '00000000-0000-0000-0000-000000000001',
      memberships: [
        {
          companyId: world.companyA.id,
          canManageCampaigns: true,
          canDeleteCompanyFiles: false,
        },
      ],
      companyIds: [world.companyA.id],
    };

    const updated = await withTenantScope(prisma, actor, (tx) =>
      tx.campaignHistory.updateMany({ where: { campaignId }, data: { newValue: 'mentira' } }),
    );
    const deleted = await withTenantScope(prisma, actor, (tx) =>
      tx.campaignHistory.deleteMany({ where: { campaignId } }),
    );

    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);

    const history = await systemRead((tx) =>
      tx.campaignHistory.findMany({ where: { campaignId } }),
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.newValue).toBe('paused');
  });
});

describe('visibility to clients', () => {
  it('hides a campaign the agency marked invisible', async () => {
    const managerCookie = await sessionFor(world.managerA);
    await createCampaign(managerCookie, { name: 'Visível' });
    const hidden = await createCampaign(managerCookie, {
      name: 'Interna',
      visibleToClient: false,
    });

    const clientCookie = await sessionFor(world.clientA);
    const list = await app.inject(authed({ method: 'GET', url: '/api/campaigns' }, clientCookie));

    expect(list.json().data.map((row: { name: string }) => row.name)).toEqual(['Visível']);

    const detail = await app.inject(
      authed({ method: 'GET', url: `/api/campaigns/${hidden.json().data.id}` }, clientCookie),
    );
    expect(detail.statusCode).toBe(404);
  });

  it('still shows it to the agency', async () => {
    const managerCookie = await sessionFor(world.managerA);
    await createCampaign(managerCookie, { name: 'Interna', visibleToClient: false });

    const list = await app.inject(authed({ method: 'GET', url: '/api/campaigns' }, managerCookie));

    expect(list.json().meta.total).toBe(1);
  });
});

describe('tenant isolation', () => {
  it('never lists another company campaigns', async () => {
    const adminCookie = await sessionFor(world.admin);
    const accountB = await withSystemScope(prisma, (tx) =>
      tx.adAccount.create({
        data: { companyId: world.companyB.id, platform: 'tiktok', name: 'Conta B' },
        select: { id: true },
      }),
    );
    await createCampaign(adminCookie, {
      companyId: world.companyB.id,
      adAccountId: accountB.id,
      name: 'De outra empresa',
    });

    const cookie = await sessionFor(world.managerA);
    const list = await app.inject(authed({ method: 'GET', url: '/api/campaigns' }, cookie));

    expect(list.json().data.some((row: { name: string }) => row.name === 'De outra empresa')).toBe(
      false,
    );
  });

  it('refuses an ad account from another company', async () => {
    const accountB = await withSystemScope(prisma, (tx) =>
      tx.adAccount.create({
        data: { companyId: world.companyB.id, platform: 'tiktok', name: 'Conta B' },
        select: { id: true },
      }),
    );
    const cookie = await sessionFor(world.managerA);

    const response = await createCampaign(cookie, { adAccountId: accountB.id });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unknown_ad_account');
  });

  it('answers a foreign campaign id exactly like one that never existed', async () => {
    const adminCookie = await sessionFor(world.admin);
    const accountB = await withSystemScope(prisma, (tx) =>
      tx.adAccount.create({
        data: { companyId: world.companyB.id, platform: 'tiktok', name: 'Conta B' },
        select: { id: true },
      }),
    );
    const foreign = await createCampaign(adminCookie, {
      companyId: world.companyB.id,
      adAccountId: accountB.id,
    });

    const cookie = await sessionFor(world.managerA);
    const [foreignRead, absent] = await Promise.all([
      app.inject(
        authed({ method: 'GET', url: `/api/campaigns/${foreign.json().data.id}` }, cookie),
      ),
      app.inject(authed({ method: 'GET', url: `/api/campaigns/${crypto.randomUUID()}` }, cookie)),
    ]);

    expect(foreignRead.statusCode).toBe(absent.statusCode);
    expect(foreignRead.body).toBe(absent.body);
  });
});

describe('ad accounts', () => {
  it('keeps the platform in step on every campaign when the account moves', async () => {
    const cookie = await sessionFor(world.managerA);
    const created = await createCampaign(cookie);

    await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/ad-accounts/${world.accountA.id}`,
          payload: { platform: 'tiktok' },
        },
        cookie,
      ),
    );

    const campaign = await app.inject(
      authed({ method: 'GET', url: `/api/campaigns/${created.json().data.id}` }, cookie),
    );
    expect(campaign.json().data.platform).toBe('tiktok');
  });

  it('refuses a manager without the override', async () => {
    const cookie = await sessionFor(world.managerNoOverride);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/ad-accounts',
          payload: { companyId: world.companyA.id, platform: 'meta', name: 'Nova conta' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });
});

describe('campaigns needing attention', () => {
  it('reaches the dashboard and the notification centre', async () => {
    const cookie = await sessionFor(world.managerA);
    const created = await createCampaign(cookie);

    await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/campaigns/${created.json().data.id}`,
          payload: { status: 'with_problem', changeNote: 'Reprovada pela plataforma.' },
        },
        cookie,
      ),
    );

    const dashboard = await app.inject(
      authed({ method: 'GET', url: '/api/dashboard/agency' }, cookie),
    );
    expect(dashboard.json().data.counts.campaignsNeedingAttention).toBe(1);

    const notifications = await systemRead((tx) =>
      tx.notification.findMany({ where: { recipientId: world.clientA.id } }),
    );
    expect(notifications.map((row) => row.type)).toEqual(['campaign.needs_attention']);
  });

  it('filters the list down to them', async () => {
    const cookie = await sessionFor(world.managerA);
    await createCampaign(cookie, { name: 'Saudável' });
    const troubled = await createCampaign(cookie, { name: 'Com problema' });
    await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/campaigns/${troubled.json().data.id}`,
          payload: { status: 'needs_attention' },
        },
        cookie,
      ),
    );

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/campaigns?needsAttention=true' }, cookie),
    );

    expect(response.json().data.map((row: { name: string }) => row.name)).toEqual(['Com problema']);
  });
});
