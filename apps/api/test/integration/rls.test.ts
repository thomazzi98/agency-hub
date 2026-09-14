import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Company } from '@prisma/client';
import type { AuthenticatedActor } from '../../src/shared/actor.js';
import {
  assertLeastPrivilegeDatabaseRole,
  readDatabaseRolePrivileges,
  withSystemScope,
  withTenantScope,
} from '../../src/shared/tenant-scope.js';
import { closeTestPrisma, resetDatabase, testPrisma } from '../helpers/prisma.js';
import { createTestUser, grantMembership } from '../helpers/app.js';

const prisma = testPrisma();

function actorFor(companyIds: string[], role: AuthenticatedActor['role']): AuthenticatedActor {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    name: 'Ator',
    email: 'ator@example.com',
    role,
    mustChangePassword: false,
    sessionId: '00000000-0000-0000-0000-000000000001',
    memberships: companyIds.map((companyId) => ({
      companyId,
      canManageCampaigns: false,
      canDeleteCompanyFiles: false,
    })),
    companyIds,
  };
}

let companyA: Company;
let companyB: Company;

beforeAll(async () => {
  await resetDatabase();

  [companyA, companyB] = await withSystemScope(prisma, async (tx) => [
    await tx.company.create({ data: { name: 'Empresa A' } }),
    await tx.company.create({ data: { name: 'Empresa B' } }),
  ]);

  const userA = await createTestUser({ email: 'rls-a@example.com' });
  const userB = await createTestUser({ email: 'rls-b@example.com' });
  await grantMembership(userA.id, companyA.id);
  await grantMembership(userB.id, companyB.id);
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('database role', () => {
  it('is neither a superuser nor BYPASSRLS, so policies actually apply', async () => {
    const privileges = await readDatabaseRolePrivileges(prisma);

    expect(privileges.isSuperuser).toBe(false);
    expect(privileges.bypassesRls).toBe(false);
    await expect(assertLeastPrivilegeDatabaseRole(prisma)).resolves.toBeUndefined();
  });

  it('cannot run DDL, so a compromised application cannot reshape the schema', async () => {
    await expect(
      prisma.$executeRawUnsafe('CREATE TABLE rls_probe (id uuid PRIMARY KEY)'),
    ).rejects.toThrow();
  });
});

/**
 * Every table that belongs to a tenant, whether it carries `company_id` itself or
 * reaches one through a parent (14-database-design.md#row-level-security). Adding a
 * tenant table without adding it here is the mistake this list exists to catch: the
 * check below fails for a table that is listed but unprotected, and the reviewer of a
 * new migration has to decide, deliberately, which list a new table belongs in.
 */
const TENANT_TABLES = [
  'companies',
  'company_memberships',
  'projects',
  'folders',
  'files',
  'upload_sessions',
  'upload_parts',
  'deletion_requests',
  'comments',
  'topics',
  'topic_replies',
  'content',
  'publications',
];

describe('row-level security coverage', () => {
  it('protects every tenant-owned table with a tenant_isolation policy', async () => {
    const rows = await prisma.$queryRaw<{ table: string; enabled: boolean; policies: bigint }[]>`
      SELECT c.relname AS table,
             c.relrowsecurity AS enabled,
             count(p.polname) FILTER (WHERE p.polname = 'tenant_isolation') AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE n.nspname = 'public'
         AND c.relname = ANY (${TENANT_TABLES})
       GROUP BY c.relname, c.relrowsecurity
    `;

    expect(rows.map((row) => row.table).sort()).toEqual([...TENANT_TABLES].sort());
    expect(
      rows.filter((row) => !row.enabled || row.policies === 0n).map((row) => row.table),
    ).toEqual([]);
  });
});

describe('row-level security', () => {
  it('returns nothing from a tenant-owned table with no scope set', async () => {
    const companies = await prisma.company.findMany();

    expect(companies).toEqual([]);
  });

  it('shows a scoped actor only their own company', async () => {
    const visible = await withTenantScope(prisma, actorFor([companyA.id], 'agency_manager'), (tx) =>
      tx.company.findMany(),
    );

    expect(visible.map((company) => company.id)).toEqual([companyA.id]);
  });

  it('hides another company even when its id is known and asked for directly', async () => {
    const found = await withTenantScope(prisma, actorFor([companyA.id], 'agency_manager'), (tx) =>
      tx.company.findUnique({ where: { id: companyB.id } }),
    );

    expect(found).toBeNull();
  });

  it('hides another company memberships from a scoped actor', async () => {
    const memberships = await withTenantScope(
      prisma,
      actorFor([companyA.id], 'agency_manager'),
      (tx) => tx.companyMembership.findMany(),
    );

    expect(memberships.every((membership) => membership.companyId === companyA.id)).toBe(true);
    expect(memberships).toHaveLength(1);
  });

  it('refuses to write a row into a company outside the actor scope', async () => {
    const user = await createTestUser({ email: 'rls-write@example.com' });

    await expect(
      withTenantScope(prisma, actorFor([companyA.id], 'agency_manager'), (tx) =>
        tx.companyMembership.create({ data: { userId: user.id, companyId: companyB.id } }),
      ),
    ).rejects.toThrow();
  });

  it('shows every company to an agency_admin without any membership', async () => {
    const visible = await withTenantScope(prisma, actorFor([], 'agency_admin'), (tx) =>
      tx.company.findMany(),
    );

    expect(visible.map((company) => company.id).sort()).toEqual([companyA.id, companyB.id].sort());
  });

  /**
   * The failure this guards against is the reason the SDD mandates the interactive
   * transaction: a plain `SET` would live on the pooled connection, so a later request
   * from a different tenant could inherit the previous tenant's context.
   */
  it('never leaks one tenant scope into a concurrent request on a pooled connection', async () => {
    const rounds = 24;

    const results = await Promise.all(
      Array.from({ length: rounds }, (_, index) => {
        const own = index % 2 === 0 ? companyA : companyB;
        return withTenantScope(prisma, actorFor([own.id], 'agency_manager'), async (tx) => {
          const visible = await tx.company.findMany({ select: { id: true } });
          return { expected: own.id, seen: visible.map((company) => company.id) };
        });
      }),
    );

    for (const result of results) {
      expect(result.seen).toEqual([result.expected]);
    }
  });

  it('reverts the scope when a scoped transaction rolls back', async () => {
    await expect(
      withTenantScope(prisma, actorFor([companyA.id], 'agency_manager'), async () => {
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    expect(await prisma.company.findMany()).toEqual([]);
  });
});

describe('audit_logs append-only enforcement', () => {
  it('accepts an append but refuses an update or a delete, even under the RLS bypass', async () => {
    await withSystemScope(
      prisma,
      (tx) => tx.$executeRaw`INSERT INTO audit_logs (action) VALUES ('test.append_only')`,
    );

    const updated = await withSystemScope(
      prisma,
      (tx) =>
        tx.$executeRaw`UPDATE audit_logs SET action = 'tampered' WHERE action = 'test.append_only'`,
    );
    const deleted = await withSystemScope(
      prisma,
      (tx) => tx.$executeRaw`DELETE FROM audit_logs WHERE action = 'test.append_only'`,
    );

    expect(updated).toBe(0);
    expect(deleted).toBe(0);

    const surviving = await withSystemScope(prisma, (tx) =>
      tx.auditLog.findMany({ where: { action: 'test.append_only' } }),
    );
    expect(surviving).toHaveLength(1);
  });
});
