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

const prisma = testPrisma();
let app: FastifyInstance;

interface World {
  companyA: Company;
  companyB: Company;
  admin: User;
  managerA: User;
  managerB: User;
  clientA: User;
  contributorA: User;
  otherContributorA: User;
}

let world: World;

async function buildWorld(): Promise<World> {
  const [companyA, companyB] = await Promise.all([
    createTestCompany('Empresa A'),
    createTestCompany('Empresa B'),
  ]);

  const [admin, managerA, managerB, clientA, contributorA, otherContributorA] = await Promise.all([
    createTestUser({ email: 'pf-admin@example.com', role: 'agency_admin' }),
    createTestUser({ email: 'pf-manager-a@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'pf-manager-b@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'pf-client-a@example.com', role: 'client_manager' }),
    createTestUser({ email: 'pf-contributor-a@example.com', role: 'contributor' }),
    createTestUser({ email: 'pf-contributor-a2@example.com', role: 'contributor' }),
  ]);

  await Promise.all([
    grantMembership(managerA.id, companyA.id),
    grantMembership(managerB.id, companyB.id),
    grantMembership(clientA.id, companyA.id),
    grantMembership(contributorA.id, companyA.id),
    grantMembership(otherContributorA.id, companyA.id),
  ]);

  return {
    companyA,
    companyB,
    admin,
    managerA,
    managerB,
    clientA,
    contributorA,
    otherContributorA,
  };
}

const sessionFor = (user: User) => loginAs(app, user.email, DEFAULT_TEST_PASSWORD);

async function seedProject(companyId: string, name: string) {
  return withSystemScope(prisma, (tx) => tx.project.create({ data: { companyId, name } }));
}

async function seedFolder(companyId: string, name: string, createdById?: string) {
  return withSystemScope(prisma, (tx) =>
    tx.folder.create({ data: { companyId, name, createdById } }),
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

describe('project visibility across tenants', () => {
  beforeEach(async () => {
    await seedProject(world.companyA.id, 'Projeto A');
    await seedProject(world.companyB.id, 'Projeto B');
  });

  it('shows an agency_admin both companies projects', async () => {
    const cookie = await sessionFor(world.admin);

    const response = await app.inject(authed({ method: 'GET', url: '/api/projects' }, cookie));

    expect(response.json().meta.total).toBe(2);
  });

  it.each([
    ['agency_manager', () => world.managerA],
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('shows a %s only their own company projects', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const response = await app.inject(authed({ method: 'GET', url: '/api/projects' }, cookie));

    const names = (response.json().data as { name: string }[]).map((project) => project.name);
    expect(names).toEqual(['Projeto A']);
  });

  it('refuses a companyId filter naming a company the actor cannot reach', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: `/api/projects?companyId=${world.companyB.id}` }, cookie),
    );

    expect(response.statusCode).toBe(404);
  });

  it('hides another company project behind the same 404 as a made-up id', async () => {
    const cookie = await sessionFor(world.managerA);
    const foreign = await withSystemScope(prisma, (tx) =>
      tx.project.findFirstOrThrow({ where: { companyId: world.companyB.id } }),
    );

    const other = await app.inject(
      authed({ method: 'GET', url: `/api/projects/${foreign.id}` }, cookie),
    );
    const madeUp = await app.inject(
      authed({ method: 'GET', url: '/api/projects/00000000-0000-4000-8000-000000000000' }, cookie),
    );

    expect(other.statusCode).toBe(404);
    expect(other.json()).toEqual(madeUp.json());
  });

  it('refuses to create a project in a company the actor cannot reach', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/projects',
          payload: { companyId: world.companyB.id, name: 'Invasor' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(404);
    const count = await withSystemScope(prisma, (tx) =>
      tx.project.count({ where: { companyId: world.companyB.id } }),
    );
    expect(count).toBe(1);
  });
});

describe('project management permissions', () => {
  it('lets an agency_manager create and edit a project in their company', async () => {
    const cookie = await sessionFor(world.managerA);

    const created = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/projects',
          payload: { companyId: world.companyA.id, name: 'Lançamento', type: 'campaign' },
        },
        cookie,
      ),
    );
    expect(created.statusCode).toBe(201);

    const updated = await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/projects/${created.json().data.id}`,
          payload: { status: 'completed' },
        },
        cookie,
      ),
    );
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.status).toBe('completed');
  });

  it.each([
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses project creation to a %s', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/projects',
          payload: { companyId: world.companyA.id, name: 'Não deveria' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });

  it('rejects an end date before the start date', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/projects',
          payload: {
            companyId: world.companyA.id,
            name: 'Datas trocadas',
            startDate: '2026-03-10',
            endDate: '2026-03-01',
          },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('invalid_date_range');
  });

  it('keeps a project folders when the project is archived', async () => {
    const project = await seedProject(world.companyA.id, 'Para arquivar');
    await withSystemScope(prisma, (tx) =>
      tx.folder.create({
        data: { companyId: world.companyA.id, projectId: project.id, name: 'Materiais' },
      }),
    );
    const cookie = await sessionFor(world.managerA);

    const archived = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/projects/${project.id}`, payload: { status: 'archived' } },
        cookie,
      ),
    );
    expect(archived.statusCode).toBe(200);

    const folders = await app.inject(
      authed({ method: 'GET', url: `/api/folders?projectId=${project.id}` }, cookie),
    );
    expect(folders.json().data).toHaveLength(1);
  });
});

describe('folder visibility', () => {
  it('shows a contributor every folder in their company, whoever created it', async () => {
    await seedFolder(world.companyA.id, 'Criada pelo outro', world.otherContributorA.id);
    await seedFolder(world.companyA.id, 'Criada pelo gestor', world.managerA.id);
    await seedFolder(world.companyB.id, 'De outra empresa');

    const cookie = await sessionFor(world.contributorA);
    const response = await app.inject(authed({ method: 'GET', url: '/api/folders' }, cookie));

    const names = (response.json().data as { name: string }[]).map((folder) => folder.name);
    expect(names.sort()).toEqual(['Criada pelo gestor', 'Criada pelo outro']);
  });

  it('lists only root folders when asked for the root', async () => {
    const parent = await seedFolder(world.companyA.id, 'Raiz');
    await withSystemScope(prisma, (tx) =>
      tx.folder.create({
        data: { companyId: world.companyA.id, parentFolderId: parent.id, name: 'Filha' },
      }),
    );

    const cookie = await sessionFor(world.contributorA);
    const response = await app.inject(
      authed({ method: 'GET', url: '/api/folders?parentFolderId=root' }, cookie),
    );

    const rows = response.json().data as { name: string; _count: { children: number } }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Raiz');
    expect(rows[0]?._count.children).toBe(1);
  });
});

describe('folder management', () => {
  it('lets a contributor create a folder and nest another inside it', async () => {
    const cookie = await sessionFor(world.contributorA);

    const parent = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/folders',
          payload: { companyId: world.companyA.id, name: 'Fotos' },
        },
        cookie,
      ),
    );
    expect(parent.statusCode).toBe(201);

    const child = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/folders',
          payload: {
            companyId: world.companyA.id,
            parentFolderId: parent.json().data.id,
            name: 'Fachada',
          },
        },
        cookie,
      ),
    );

    expect(child.statusCode).toBe(201);
    expect(child.json().data.parentFolderId).toBe(parent.json().data.id);
  });

  it('refuses folder creation to a client_manager', async () => {
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/folders',
          payload: { companyId: world.companyA.id, name: 'Não deveria' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });

  it('rejects a second folder with the same name in the same place, case-insensitively', async () => {
    const cookie = await sessionFor(world.contributorA);
    const payload = { companyId: world.companyA.id, name: 'Contratos' };

    expect(
      (await app.inject(authed({ method: 'POST', url: '/api/folders', payload }, cookie)))
        .statusCode,
    ).toBe(201);

    const duplicate = await app.inject(
      authed(
        { method: 'POST', url: '/api/folders', payload: { ...payload, name: 'contratos' } },
        cookie,
      ),
    );

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('folder_name_taken');
  });

  it('allows the same folder name under different parents', async () => {
    const cookie = await sessionFor(world.contributorA);
    const first = await seedFolder(world.companyA.id, 'Cliente 1');
    const second = await seedFolder(world.companyA.id, 'Cliente 2');

    for (const parentFolderId of [first.id, second.id]) {
      const response = await app.inject(
        authed(
          {
            method: 'POST',
            url: '/api/folders',
            payload: { companyId: world.companyA.id, parentFolderId, name: 'Fotos' },
          },
          cookie,
        ),
      );
      expect(response.statusCode).toBe(201);
    }
  });

  it('refuses to attach a folder to another company project', async () => {
    const foreignProject = await seedProject(world.companyB.id, 'Projeto B');
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/folders',
          payload: {
            companyId: world.companyA.id,
            projectId: foreignProject.id,
            name: 'Contrabando',
          },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unknown_project');
  });

  it('refuses to move a folder inside its own descendant', async () => {
    const cookie = await sessionFor(world.managerA);
    const grandparent = await seedFolder(world.companyA.id, 'Avó');
    const child = await withSystemScope(prisma, (tx) =>
      tx.folder.create({
        data: { companyId: world.companyA.id, parentFolderId: grandparent.id, name: 'Filha' },
      }),
    );

    const response = await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/folders/${grandparent.id}`,
          payload: { parentFolderId: child.id },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('folder_cycle');
  });

  it('refuses to delete a folder that still has children', async () => {
    const cookie = await sessionFor(world.managerA);
    const parent = await seedFolder(world.companyA.id, 'Com filhas', world.managerA.id);
    await withSystemScope(prisma, (tx) =>
      tx.folder.create({
        data: { companyId: world.companyA.id, parentFolderId: parent.id, name: 'Filha' },
      }),
    );

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/folders/${parent.id}` }, cookie),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('folder_not_empty');
  });

  it('lets a contributor delete only their own folder', async () => {
    const cookie = await sessionFor(world.contributorA);
    const own = await seedFolder(world.companyA.id, 'Minha', world.contributorA.id);
    const other = await seedFolder(world.companyA.id, 'De outro', world.otherContributorA.id);

    const ownDelete = await app.inject(
      authed({ method: 'DELETE', url: `/api/folders/${own.id}` }, cookie),
    );
    const otherDelete = await app.inject(
      authed({ method: 'DELETE', url: `/api/folders/${other.id}` }, cookie),
    );

    expect(ownDelete.statusCode).toBe(200);
    expect(otherDelete.statusCode).toBe(403);
  });

  it('lets an agency_manager delete a folder someone else created', async () => {
    const cookie = await sessionFor(world.managerA);
    const folder = await seedFolder(world.companyA.id, 'De outro', world.contributorA.id);

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/folders/${folder.id}` }, cookie),
    );

    expect(response.statusCode).toBe(200);
  });

  it('hides another company folder behind a 404 on every operation', async () => {
    const foreign = await seedFolder(world.companyB.id, 'De outra empresa');
    const cookie = await sessionFor(world.contributorA);

    const read = await app.inject(
      authed({ method: 'GET', url: `/api/folders/${foreign.id}` }, cookie),
    );
    const rename = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/folders/${foreign.id}`, payload: { name: 'Renomeada' } },
        cookie,
      ),
    );
    const removed = await app.inject(
      authed({ method: 'DELETE', url: `/api/folders/${foreign.id}` }, cookie),
    );

    expect([read.statusCode, rename.statusCode, removed.statusCode]).toEqual([404, 404, 404]);

    const survivor = await withSystemScope(prisma, (tx) =>
      tx.folder.findUniqueOrThrow({ where: { id: foreign.id } }),
    );
    expect(survivor.name).toBe('De outra empresa');
  });
});
