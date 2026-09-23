import type { FastifyInstance } from 'fastify';
import type { Company, User, UserRole } from '@prisma/client';
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

const prisma = testPrisma();
let app: FastifyInstance;

/**
 * Both companies deliberately hold resources of the same shape, so a missing filter
 * shows up as "sees two" rather than passing because there was nothing to leak
 * (18-testing-strategy.md#test-data).
 */
interface World {
  companyA: Company;
  companyB: Company;
  admin: User;
  managerA: User;
  managerB: User;
  clientA: User;
  contributorA: User;
  outsider: User;
}

let world: World;

async function buildWorld(): Promise<World> {
  const [companyA, companyB] = await Promise.all([
    createTestCompany('Empresa A'),
    createTestCompany('Empresa B'),
  ]);

  const make = (email: string, role: UserRole) => createTestUser({ email, role });

  const [admin, managerA, managerB, clientA, contributorA, outsider] = await Promise.all([
    make('iso-admin@example.com', 'agency_admin'),
    make('iso-manager-a@example.com', 'agency_manager'),
    make('iso-manager-b@example.com', 'agency_manager'),
    make('iso-client-a@example.com', 'client_manager'),
    make('iso-contributor-a@example.com', 'contributor'),
    make('iso-outsider@example.com', 'agency_manager'),
  ]);

  await Promise.all([
    grantMembership(managerA.id, companyA.id),
    grantMembership(managerB.id, companyB.id),
    grantMembership(clientA.id, companyA.id),
    grantMembership(contributorA.id, companyA.id),
  ]);

  return { companyA, companyB, admin, managerA, managerB, clientA, contributorA, outsider };
}

async function sessionFor(user: User): Promise<string> {
  return loginAs(app, user.email, DEFAULT_TEST_PASSWORD);
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

describe('company visibility', () => {
  it('shows an agency_admin every company', async () => {
    const cookie = await sessionFor(world.admin);

    const response = await app.inject(authed({ method: 'GET', url: '/api/companies' }, cookie));

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(2);
    expect(response.json().meta.total).toBe(2);
  });

  it.each([
    ['agency_manager', () => world.managerA],
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('shows a %s only the companies they belong to', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const response = await app.inject(authed({ method: 'GET', url: '/api/companies' }, cookie));

    expect(response.statusCode).toBe(200);
    const names = (response.json().data as { name: string }[]).map((company) => company.name);
    expect(names).toEqual(['Empresa A']);
  });

  it('shows nothing to a user with no membership at all', async () => {
    const cookie = await sessionFor(world.outsider);

    const response = await app.inject(authed({ method: 'GET', url: '/api/companies' }, cookie));

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
  });

  it.each([
    ['agency_manager', () => world.managerA],
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])(
    'hides another company from a %s asking for it by id, as if it did not exist',
    async (_role, pick) => {
      const cookie = await sessionFor(pick());

      const otherCompany = await app.inject(
        authed({ method: 'GET', url: `/api/companies/${world.companyB.id}` }, cookie),
      );
      const madeUpId = await app.inject(
        authed(
          { method: 'GET', url: '/api/companies/00000000-0000-4000-8000-000000000000' },
          cookie,
        ),
      );

      expect(otherCompany.statusCode).toBe(404);
      // Indistinguishable from an id that never existed, so existence never leaks.
      expect(otherCompany.json()).toEqual(madeUpId.json());
    },
  );

  it('stops showing a company the moment its membership is revoked', async () => {
    const cookie = await sessionFor(world.managerA);

    const before = await app.inject(authed({ method: 'GET', url: '/api/companies' }, cookie));
    expect(before.json().data).toHaveLength(1);

    const adminCookie = await sessionFor(world.admin);
    const memberships = await app.inject(
      authed({ method: 'GET', url: `/api/memberships?userId=${world.managerA.id}` }, adminCookie),
    );
    const membershipId = (memberships.json().data as { id: string }[])[0]?.id;

    const revoked = await app.inject(
      authed({ method: 'DELETE', url: `/api/memberships/${membershipId}` }, adminCookie),
    );
    expect(revoked.statusCode).toBe(200);

    // Revoking drops the user's sessions, so they must sign in again — and then see nothing.
    const staleSession = await app.inject(authed({ method: 'GET', url: '/api/companies' }, cookie));
    expect(staleSession.statusCode).toBe(401);

    const freshCookie = await sessionFor(world.managerA);
    const after = await app.inject(authed({ method: 'GET', url: '/api/companies' }, freshCookie));
    expect(after.json().data).toEqual([]);
  });

  it('gives access to another company at once, without signing the person out', async () => {
    const cookie = await sessionFor(world.managerA);
    const adminCookie = await sessionFor(world.admin);

    const granted = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/memberships',
          payload: { userId: world.managerA.id, companyId: world.companyB.id },
        },
        adminCookie,
      ),
    );
    expect(granted.statusCode).toBe(201);

    // The same session - an upload in flight on it survives - already sees the new company.
    const after = await app.inject(authed({ method: 'GET', url: '/api/companies' }, cookie));
    expect(after.statusCode).toBe(200);
    expect(after.json().data).toHaveLength(2);
  });
});

describe('company management permissions', () => {
  const payload = { name: 'Empresa Nova' };

  it('lets an agency_admin create, edit, and archive a company', async () => {
    const cookie = await sessionFor(world.admin);

    const created = await app.inject(
      authed({ method: 'POST', url: '/api/companies', payload }, cookie),
    );
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;

    const updated = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/companies/${id}`, payload: { segment: 'Varejo' } },
        cookie,
      ),
    );
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.segment).toBe('Varejo');

    const archived = await app.inject(
      authed({ method: 'POST', url: `/api/companies/${id}/archive` }, cookie),
    );
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.status).toBe('archived');

    const activeOnly = await app.inject(authed({ method: 'GET', url: '/api/companies' }, cookie));
    expect((activeOnly.json().data as { id: string }[]).map((c) => c.id)).not.toContain(id);
  });

  it.each([
    ['agency_manager', () => world.managerA],
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses company creation to a %s', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const response = await app.inject(
      authed({ method: 'POST', url: '/api/companies', payload }, cookie),
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden');
  });

  it.each([
    ['agency_manager', () => world.managerA],
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses editing even their own company to a %s', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const response = await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/companies/${world.companyA.id}`,
          payload: { name: 'Renomeada' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });

  it('refuses to edit another company, and leaves it untouched', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/companies/${world.companyB.id}`,
          payload: { name: 'Sequestrada' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(403);
    // Read through the system scope: a bare query on the application role is itself
    // blocked by RLS, which would make this assertion pass for the wrong reason.
    const stored = await withSystemScope(prisma, (tx) =>
      tx.company.findUnique({ where: { id: world.companyB.id }, select: { name: true } }),
    );
    expect(stored?.name).toBe('Empresa B');
  });
});

describe('user management permissions', () => {
  it.each([
    ['agency_manager', () => world.managerA],
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses the whole users module to a %s', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const list = await app.inject(authed({ method: 'GET', url: '/api/users' }, cookie));
    const create = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/users',
          payload: { name: 'Intruso', email: 'intruso@example.com', role: 'agency_admin' },
        },
        cookie,
      ),
    );
    const reset = await app.inject(
      authed({ method: 'POST', url: `/api/users/${world.managerB.id}/reset-password` }, cookie),
    );

    expect([list.statusCode, create.statusCode, reset.statusCode]).toEqual([403, 403, 403]);
  });

  it('creates a user with memberships and shows the temporary password exactly once', async () => {
    const cookie = await sessionFor(world.admin);

    const created = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/users',
          payload: {
            name: 'Nova Colaboradora',
            email: 'Nova@Example.com',
            role: 'contributor',
            memberships: [{ companyId: world.companyA.id, canDeleteCompanyFiles: true }],
          },
        },
        cookie,
      ),
    );

    expect(created.statusCode).toBe(201);
    const body = created.json().data;
    expect(body.email).toBe('nova@example.com');
    expect(body.mustChangePassword).toBe(true);
    expect(typeof body.temporaryPassword).toBe('string');
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0].canDeleteCompanyFiles).toBe(true);

    const fetched = await app.inject(
      authed({ method: 'GET', url: `/api/users/${body.id}` }, cookie),
    );
    expect(fetched.json().data.temporaryPassword).toBeUndefined();

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: body.id } });
    expect(stored.passwordHash).not.toContain(body.temporaryPassword);
  });

  it('rejects a duplicate email with a conflict rather than a crash', async () => {
    const cookie = await sessionFor(world.admin);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/users',
          payload: { name: 'Duplicada', email: world.managerA.email, role: 'contributor' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('email_taken');
  });

  it('refuses an admin changing their own role or deactivating themselves', async () => {
    const cookie = await sessionFor(world.admin);

    const roleChange = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/users/${world.admin.id}`, payload: { role: 'contributor' } },
        cookie,
      ),
    );
    const deactivate = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/users/${world.admin.id}`, payload: { status: 'inactive' } },
        cookie,
      ),
    );

    expect(roleChange.statusCode).toBe(422);
    expect(roleChange.json().error.code).toBe('cannot_change_own_role');
    expect(deactivate.statusCode).toBe(422);
    expect(deactivate.json().error.code).toBe('cannot_deactivate_self');
  });

  it('ends every session of a user it deactivates', async () => {
    const adminCookie = await sessionFor(world.admin);
    const victimCookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/users/${world.managerA.id}`,
          payload: { status: 'inactive' },
        },
        adminCookie,
      ),
    );
    expect(response.statusCode).toBe(200);

    const after = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, victimCookie));
    expect(after.statusCode).toBe(401);
  });

  it('forces a password change and drops existing sessions on an admin reset', async () => {
    const adminCookie = await sessionFor(world.admin);
    const victimCookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        { method: 'POST', url: `/api/users/${world.managerA.id}/reset-password` },
        adminCookie,
      ),
    );

    expect(response.statusCode).toBe(200);
    const temporaryPassword = response.json().data.temporaryPassword as string;
    expect(temporaryPassword.length).toBeGreaterThan(8);

    const stale = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, victimCookie));
    expect(stale.statusCode).toBe(401);

    const freshCookie = await loginAs(app, world.managerA.email, temporaryPassword);
    const me = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, freshCookie));
    expect(me.json().data.mustChangePassword).toBe(true);
  });
});

describe('membership management permissions', () => {
  it.each([
    ['agency_manager', () => world.managerA],
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses membership management to a %s', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const granted = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/memberships',
          payload: { userId: world.outsider.id, companyId: world.companyA.id },
        },
        cookie,
      ),
    );

    expect(granted.statusCode).toBe(403);
  });

  it('grants access to a second company without disturbing the first', async () => {
    const adminCookie = await sessionFor(world.admin);

    const granted = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/memberships',
          payload: {
            userId: world.managerA.id,
            companyId: world.companyB.id,
            canManageCampaigns: true,
          },
        },
        adminCookie,
      ),
    );
    expect(granted.statusCode).toBe(201);

    const cookie = await sessionFor(world.managerA);
    const companies = await app.inject(authed({ method: 'GET', url: '/api/companies' }, cookie));

    const names = (companies.json().data as { name: string }[]).map((company) => company.name);
    expect(names.sort()).toEqual(['Empresa A', 'Empresa B']);

    const me = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, cookie));
    const memberships = me.json().data.memberships as {
      companyId: string;
      canManageCampaigns: boolean;
    }[];
    // Overrides are per membership, not per user.
    expect(memberships.find((m) => m.companyId === world.companyB.id)?.canManageCampaigns).toBe(
      true,
    );
    expect(memberships.find((m) => m.companyId === world.companyA.id)?.canManageCampaigns).toBe(
      false,
    );
  });

  it('reactivates a revoked membership instead of creating a duplicate', async () => {
    const adminCookie = await sessionFor(world.admin);

    const list = await app.inject(
      authed({ method: 'GET', url: `/api/memberships?userId=${world.managerA.id}` }, adminCookie),
    );
    const membershipId = (list.json().data as { id: string }[])[0]?.id;

    await app.inject(
      authed({ method: 'DELETE', url: `/api/memberships/${membershipId}` }, adminCookie),
    );

    const regranted = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/memberships',
          payload: { userId: world.managerA.id, companyId: world.companyA.id },
        },
        adminCookie,
      ),
    );

    expect(regranted.statusCode).toBe(201);
    expect(regranted.json().data.id).toBe(membershipId);

    const all = await withSystemScope(prisma, (tx) =>
      tx.companyMembership.count({
        where: { userId: world.managerA.id, companyId: world.companyA.id },
      }),
    );
    expect(all).toBe(1);
  });

  it('rejects a duplicate active membership', async () => {
    const adminCookie = await sessionFor(world.admin);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/memberships',
          payload: { userId: world.managerA.id, companyId: world.companyA.id },
        },
        adminCookie,
      ),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('membership_exists');
  });
});

describe('request-body company_id is never trusted as authorization', () => {
  it('cannot reach another company by naming it in the payload', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/companies',
          payload: { name: 'Ignorada', companyId: world.companyB.id },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });
});
