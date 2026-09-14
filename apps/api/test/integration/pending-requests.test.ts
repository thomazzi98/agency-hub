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
    createTestUser({ email: 'req-admin@example.com', role: 'agency_admin' }),
    createTestUser({ email: 'req-manager-a@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'req-client-a@example.com', role: 'client_manager' }),
    createTestUser({ email: 'req-contributor-a@example.com', role: 'contributor' }),
    createTestUser({ email: 'req-manager-b@example.com', role: 'agency_manager' }),
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
const isoDate = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * DAY).toISOString().slice(0, 10);

function createRequest(cookie: string, payload: Record<string, unknown>) {
  return app.inject(authed({ method: 'POST', url: '/api/pending-requests', payload }, cookie));
}

async function seedRequest(options: {
  companyId: string;
  responsibleUserId: string;
  createdById?: string;
  status?: 'open' | 'awaiting_client' | 'answered' | 'in_review' | 'completed' | 'cancelled';
  dueDate?: Date | null;
  title?: string;
}) {
  return withSystemScope(prisma, (tx) =>
    tx.pendingRequest.create({
      data: {
        companyId: options.companyId,
        title: options.title ?? 'Enviar vídeo',
        description: 'Precisamos do material bruto.',
        responsibleUserId: options.responsibleUserId,
        createdById: options.createdById ?? null,
        status: options.status ?? 'open',
        dueDate: options.dueDate ?? null,
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

describe('creating a pending request', () => {
  const payload = () => ({
    companyId: world.companyA.id,
    title: 'Enviar fotos do imóvel',
    description: 'Precisamos de 10 fotos horizontais.',
    responsibleUserId: world.clientA.id,
    dueDate: isoDate(3),
    priority: 'high',
  });

  it('lets an agency_manager open one addressed to the client', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await createRequest(cookie, payload());

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      title: 'Enviar fotos do imóvel',
      status: 'open',
      priority: 'high',
      responsibleUserId: world.clientA.id,
      createdById: world.managerA.id,
      isAwaitingRecipient: true,
      isOverdue: false,
    });
  });

  it.each([
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses creation to a %s', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const response = await createRequest(cookie, payload());

    expect(response.statusCode).toBe(403);
  });

  it('refuses a recipient who cannot reach the company', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await createRequest(cookie, {
      ...payload(),
      responsibleUserId: world.managerB.id,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('responsible_without_access');
  });

  it('refuses a project from another company', async () => {
    const project = await withSystemScope(prisma, (tx) =>
      tx.project.create({ data: { companyId: world.companyB.id, name: 'Projeto B' } }),
    );
    const cookie = await sessionFor(world.managerA);

    const response = await createRequest(cookie, { ...payload(), projectId: project.id });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unknown_project');
  });

  it('reports another company as missing', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await createRequest(cookie, {
      ...payload(),
      companyId: world.companyB.id,
      responsibleUserId: world.managerB.id,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('responding', () => {
  it('lets the recipient answer and moves the request to answered', async () => {
    const pendingRequest = await seedRequest({
      companyId: world.companyA.id,
      responsibleUserId: world.clientA.id,
      createdById: world.managerA.id,
    });
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/pending-requests/${pendingRequest.id}/respond`,
          payload: { body: 'Enviei o material agora.' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().data.pendingRequest.status).toBe('answered');
    expect(response.json().data.comment.body).toBe('Enviei o material agora.');
  });

  it('links an attached file to the request through the comment', async () => {
    const pendingRequest = await seedRequest({
      companyId: world.companyA.id,
      responsibleUserId: world.clientA.id,
      createdById: world.managerA.id,
    });
    const file = await withSystemScope(prisma, (tx) =>
      tx.file.create({
        data: {
          companyId: world.companyA.id,
          originalName: 'material.mp4',
          storageKey: `test/${crypto.randomUUID()}`,
          mimeType: 'video/mp4',
          sizeBytes: BigInt(1024),
          uploadedById: world.clientA.id,
        },
      }),
    );
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/pending-requests/${pendingRequest.id}/respond`,
          payload: { body: 'Segue o arquivo.', attachmentFileId: file.id },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().data.comment.attachmentFileId).toBe(file.id);

    // The link the spec asks for: the response is reachable from the request itself.
    const thread = await app.inject(
      authed(
        {
          method: 'GET',
          url: `/api/comments?commentableType=pending_request&commentableId=${pendingRequest.id}`,
        },
        cookie,
      ),
    );
    expect(thread.json().data).toHaveLength(1);
    expect(thread.json().data[0].attachmentFileId).toBe(file.id);
  });

  it('refuses a file from another company as an attachment', async () => {
    const pendingRequest = await seedRequest({
      companyId: world.companyA.id,
      responsibleUserId: world.clientA.id,
    });
    const file = await withSystemScope(prisma, (tx) =>
      tx.file.create({
        data: {
          companyId: world.companyB.id,
          originalName: 'outro.mp4',
          storageKey: `test/${crypto.randomUUID()}`,
          mimeType: 'video/mp4',
          sizeBytes: BigInt(1024),
        },
      }),
    );
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/pending-requests/${pendingRequest.id}/respond`,
          payload: { body: 'Segue.', attachmentFileId: file.id },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unknown_file');
  });

  it('lets someone else comment without claiming the request was answered', async () => {
    const pendingRequest = await seedRequest({
      companyId: world.companyA.id,
      responsibleUserId: world.clientA.id,
      createdById: world.managerA.id,
    });
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/pending-requests/${pendingRequest.id}/respond`,
          payload: { body: 'Já pedi por telefone também.' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().data.pendingRequest.status).toBe('open');
  });

  it('refuses a response to a closed request', async () => {
    const pendingRequest = await seedRequest({
      companyId: world.companyA.id,
      responsibleUserId: world.clientA.id,
      status: 'completed',
    });
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/pending-requests/${pendingRequest.id}/respond`,
          payload: { body: 'Tarde demais.' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('request_closed');
  });

  it('never lets another company respond', async () => {
    const pendingRequest = await seedRequest({
      companyId: world.companyA.id,
      responsibleUserId: world.clientA.id,
    });
    const cookie = await sessionFor(world.managerB);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/pending-requests/${pendingRequest.id}/respond`,
          payload: { body: 'Invasor.' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(404);
  });
});

describe('updating', () => {
  it('lets the creator close it', async () => {
    const pendingRequest = await seedRequest({
      companyId: world.companyA.id,
      responsibleUserId: world.clientA.id,
      createdById: world.managerA.id,
      status: 'answered',
    });
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/pending-requests/${pendingRequest.id}`,
          payload: { status: 'completed' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('completed');

    const audits = await systemRead((tx) =>
      tx.auditLog.findMany({ where: { action: 'pending_request.status_changed' } }),
    );
    expect(audits).toHaveLength(1);
  });

  it('refuses the recipient rewriting the request instead of answering it', async () => {
    const pendingRequest = await seedRequest({
      companyId: world.companyA.id,
      responsibleUserId: world.clientA.id,
      createdById: world.managerA.id,
    });
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/pending-requests/${pendingRequest.id}`,
          payload: { status: 'completed' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });
});

describe('views and aggregates', () => {
  beforeEach(async () => {
    await Promise.all([
      seedRequest({
        companyId: world.companyA.id,
        responsibleUserId: world.clientA.id,
        createdById: world.managerA.id,
        dueDate: new Date(Date.now() - 3 * DAY),
        title: 'Atrasada',
      }),
      seedRequest({
        companyId: world.companyA.id,
        responsibleUserId: world.managerA.id,
        createdById: world.admin.id,
        status: 'awaiting_client',
        title: 'Para o gestor',
      }),
      seedRequest({
        companyId: world.companyA.id,
        responsibleUserId: world.clientA.id,
        createdById: world.managerA.id,
        status: 'completed',
        title: 'Concluída',
      }),
      seedRequest({
        companyId: world.companyB.id,
        responsibleUserId: world.managerB.id,
        title: 'De outra empresa',
      }),
    ]);
  });

  it('answers "what is waiting on me"', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/pending-requests?view=awaiting_me' }, cookie),
    );

    expect(response.json().data.map((row: { title: string }) => row.title)).toEqual([
      'Para o gestor',
    ]);
    expect(response.json().data[0].isMine).toBe(true);
  });

  it('answers "what did I ask for"', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/pending-requests?view=created_by_me' }, cookie),
    );

    // Two of the four: the one addressed to the manager was opened by the admin, and
    // the fourth belongs to another company entirely.
    expect(response.json().meta.total).toBe(2);
  });

  it('flags an overdue request and finds it by view', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/pending-requests?view=overdue' }, cookie),
    );

    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0]).toMatchObject({ title: 'Atrasada', isOverdue: true });
  });

  it('counts the aggregates the dashboard asks for', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/pending-requests/summary' }, cookie),
    );

    expect(response.json().data).toMatchObject({
      open: 1,
      awaitingClient: 1,
      completed: 1,
      overdue: 1,
      awaitingMe: 1,
      total: 3,
    });
  });

  it('never shows another company requests', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/pending-requests' }, cookie),
    );

    expect(
      response.json().data.some((row: { title: string }) => row.title === 'De outra empresa'),
    ).toBe(false);
  });

  it('answers a foreign id exactly like an id that never existed', async () => {
    const foreignRequest = await withSystemScope(prisma, (tx) =>
      tx.pendingRequest.findFirst({ where: { companyId: world.companyB.id } }),
    );
    const cookie = await sessionFor(world.managerA);

    const [foreign, absent] = await Promise.all([
      app.inject(
        authed({ method: 'GET', url: `/api/pending-requests/${foreignRequest?.id}` }, cookie),
      ),
      app.inject(
        authed({ method: 'GET', url: `/api/pending-requests/${crypto.randomUUID()}` }, cookie),
      ),
    ]);

    expect(foreign.statusCode).toBe(absent.statusCode);
    expect(foreign.body).toBe(absent.body);
  });
});
