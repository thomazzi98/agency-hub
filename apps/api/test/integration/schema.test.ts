import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPrisma, resetDatabase, testPrisma } from '../helpers/prisma.js';

const prisma = testPrisma();

async function createUser(email: string) {
  return prisma.user.create({
    data: { name: 'Fulano de Tal', email, passwordHash: 'hash', role: 'contributor' },
  });
}

describe('stage 1 schema', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestPrisma();
  });

  it('generates UUID primary keys in the database', async () => {
    const user = await createUser('uuid@example.com');

    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('defaults new accounts to a forced password change', async () => {
    const user = await createUser('forced@example.com');

    expect(user.mustChangePassword).toBe(true);
    expect(user.status).toBe('active');
  });

  it('rejects a duplicate email', async () => {
    await createUser('duplicate@example.com');

    await expect(createUser('duplicate@example.com')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate membership for the same user and company', async () => {
    const user = await createUser('member@example.com');
    const company = await prisma.company.create({ data: { name: 'Cliente A' } });

    await prisma.companyMembership.create({ data: { userId: user.id, companyId: company.id } });

    await expect(
      prisma.companyMembership.create({ data: { userId: user.id, companyId: company.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('defaults membership permission overrides to false', async () => {
    const user = await createUser('overrides@example.com');
    const company = await prisma.company.create({ data: { name: 'Cliente B' } });

    const membership = await prisma.companyMembership.create({
      data: { userId: user.id, companyId: company.id },
    });

    expect(membership.status).toBe('active');
    expect(membership.canManageCampaigns).toBe(false);
    expect(membership.canDeleteCompanyFiles).toBe(false);
  });

  it('refuses to delete a company that still has memberships', async () => {
    const user = await createUser('restrict@example.com');
    const company = await prisma.company.create({ data: { name: 'Cliente C' } });
    await prisma.companyMembership.create({ data: { userId: user.id, companyId: company.id } });

    await expect(prisma.company.delete({ where: { id: company.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });
});
