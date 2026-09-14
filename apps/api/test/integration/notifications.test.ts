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
import { notifyOverdueContent } from '../../src/jobs/notify-overdue-content.js';

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
    createTestUser({ email: 'notif-admin@example.com', role: 'agency_admin' }),
    createTestUser({ email: 'notif-manager-a@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'notif-client-a@example.com', role: 'client_manager' }),
    createTestUser({ email: 'notif-contributor-a@example.com', role: 'contributor' }),
    createTestUser({ email: 'notif-manager-b@example.com', role: 'agency_manager' }),
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

const notificationsOf = (recipientId: string) =>
  systemRead((tx) =>
    tx.notification.findMany({ where: { recipientId }, orderBy: { createdAt: 'asc' } }),
  );

async function createPendingRequest(
  cookie: string,
  responsibleUserId: string,
  title = 'Enviar material',
) {
  const response = await app.inject(
    authed(
      {
        method: 'POST',
        url: '/api/pending-requests',
        payload: {
          companyId: world.companyA.id,
          title,
          description: 'Precisamos do material bruto.',
          responsibleUserId,
        },
      },
      cookie,
    ),
  );
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: string; title: string };
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

describe('event emission', () => {
  it('tells the recipient about a pending request addressed to them', async () => {
    const cookie = await sessionFor(world.managerA);
    const created = await createPendingRequest(cookie, world.clientA.id);

    const rows = await notificationsOf(world.clientA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'pending_request.created',
      companyId: world.companyA.id,
      actorId: world.managerA.id,
      relatedType: 'pending_request',
      relatedId: created.id,
      readAt: null,
    });
  });

  it('never notifies the person who caused the event', async () => {
    const cookie = await sessionFor(world.managerA);
    await createPendingRequest(cookie, world.clientA.id);

    expect(await notificationsOf(world.managerA.id)).toEqual([]);
  });

  it('tells the creator when the recipient answers, and separately that a file came', async () => {
    const managerCookie = await sessionFor(world.managerA);
    const created = await createPendingRequest(managerCookie, world.clientA.id);

    const file = await withSystemScope(prisma, (tx) =>
      tx.file.create({
        data: {
          companyId: world.companyA.id,
          originalName: 'material.mp4',
          storageKey: `test/${crypto.randomUUID()}`,
          mimeType: 'video/mp4',
          sizeBytes: BigInt(1024),
        },
      }),
    );

    const clientCookie = await sessionFor(world.clientA);
    await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/pending-requests/${created.id}/respond`,
          payload: { body: 'Segue o arquivo.', attachmentFileId: file.id },
        },
        clientCookie,
      ),
    );

    const rows = await notificationsOf(world.managerA.id);
    expect(rows.map((row) => row.type).sort()).toEqual([
      'file.response_sent',
      'pending_request.answered',
    ]);
  });

  it('notifies the whole company about an upload, minus the uploader', async () => {
    const cookie = await sessionFor(world.contributorA);

    await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'company',
            commentableId: world.companyA.id,
            body: 'Uma nota para a equipe.',
          },
        },
        cookie,
      ),
    );

    const [forManager, forClient, forAuthor] = await Promise.all([
      notificationsOf(world.managerA.id),
      notificationsOf(world.clientA.id),
      notificationsOf(world.contributorA.id),
    ]);

    expect(forManager).toHaveLength(1);
    expect(forClient).toHaveLength(1);
    expect(forAuthor).toEqual([]);
  });

  it('turns a mention into its own event instead of a generic comment', async () => {
    const cookie = await sessionFor(world.contributorA);

    await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'company',
            commentableId: world.companyA.id,
            body: 'Ana, pode ver isso?',
            mentionedUserIds: [world.clientA.id],
          },
        },
        cookie,
      ),
    );

    const [mentioned, other] = await Promise.all([
      notificationsOf(world.clientA.id),
      notificationsOf(world.managerA.id),
    ]);

    expect(mentioned.map((row) => row.type)).toEqual(['user.mentioned']);
    expect(other.map((row) => row.type)).toEqual(['comment.created']);
  });

  it('ignores a mention of somebody outside the company', async () => {
    const cookie = await sessionFor(world.managerA);

    await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'company',
            commentableId: world.companyA.id,
            body: 'Olha isso.',
            mentionedUserIds: [world.managerB.id],
          },
        },
        cookie,
      ),
    );

    expect(await notificationsOf(world.managerB.id)).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('never creates a notification for someone outside the event company', async () => {
    const cookie = await sessionFor(world.managerA);
    await createPendingRequest(cookie, world.clientA.id);

    await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'company',
            commentableId: world.companyA.id,
            body: 'Nota interna.',
          },
        },
        cookie,
      ),
    );

    const everything = await systemRead((tx) => tx.notification.findMany());
    expect(everything.every((row) => row.companyId === world.companyA.id)).toBe(true);
    expect(everything.some((row) => row.recipientId === world.managerB.id)).toBe(false);
  });

  it('stops a revoked member receiving anything further', async () => {
    await withSystemScope(prisma, (tx) =>
      tx.companyMembership.updateMany({
        where: { userId: world.clientA.id, companyId: world.companyA.id },
        data: { status: 'revoked' },
      }),
    );

    const cookie = await sessionFor(world.managerA);
    await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'company',
            commentableId: world.companyA.id,
            body: 'Depois da revogação.',
          },
        },
        cookie,
      ),
    );

    expect(await notificationsOf(world.clientA.id)).toEqual([]);
  });

  it('shows a reader only their own notifications', async () => {
    const managerCookie = await sessionFor(world.managerA);
    await createPendingRequest(managerCookie, world.clientA.id);

    // The manager caused it, so their own centre is empty even though the row exists.
    const mine = await app.inject(
      authed({ method: 'GET', url: '/api/notifications' }, managerCookie),
    );
    expect(mine.json().data).toEqual([]);

    const clientCookie = await sessionFor(world.clientA);
    const theirs = await app.inject(
      authed({ method: 'GET', url: '/api/notifications' }, clientCookie),
    );
    expect(theirs.json().data).toHaveLength(1);
  });
});

describe('deduplication', () => {
  it('collapses repeated events on the same resource into one unread row', async () => {
    const cookie = await sessionFor(world.managerA);
    const created = await createPendingRequest(cookie, world.clientA.id);

    for (const title of ['Primeira revisão', 'Segunda revisão', 'Terceira revisão']) {
      await app.inject(
        authed(
          { method: 'PATCH', url: `/api/pending-requests/${created.id}`, payload: { title } },
          cookie,
        ),
      );
      await app.inject(
        authed(
          {
            method: 'POST',
            url: '/api/comments',
            payload: {
              commentableType: 'pending_request',
              commentableId: created.id,
              body: title,
            },
          },
          cookie,
        ),
      );
    }

    const rows = await notificationsOf(world.clientA.id);
    const comments = rows.filter((row) => row.type === 'comment.created');
    expect(comments).toHaveLength(1);
    expect(comments[0]?.message).toBe('Terceira revisão');
  });

  it('starts a new row once the previous one has been read', async () => {
    const managerCookie = await sessionFor(world.managerA);
    const created = await createPendingRequest(managerCookie, world.clientA.id);

    const clientCookie = await sessionFor(world.clientA);
    await app.inject(authed({ method: 'POST', url: '/api/notifications/read-all' }, clientCookie));

    await app.inject(
      authed(
        {
          method: 'PATCH',
          url: `/api/pending-requests/${created.id}`,
          payload: { responsibleUserId: world.clientA.id, title: 'Reaberta' },
        },
        managerCookie,
      ),
    );
    await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'pending_request',
            commentableId: created.id,
            body: 'Ainda precisamos disso.',
          },
        },
        managerCookie,
      ),
    );

    const rows = await notificationsOf(world.clientA.id);
    expect(rows.filter((row) => row.readAt === null)).toHaveLength(1);
    expect(rows.length).toBeGreaterThan(1);
  });
});

describe('the notification centre', () => {
  it('counts unread, marks one read and hands back where it goes', async () => {
    const managerCookie = await sessionFor(world.managerA);
    const created = await createPendingRequest(managerCookie, world.clientA.id);

    const clientCookie = await sessionFor(world.clientA);

    const before = await app.inject(
      authed({ method: 'GET', url: '/api/notifications/unread-count' }, clientCookie),
    );
    expect(before.json().data.unread).toBe(1);

    const list = await app.inject(
      authed({ method: 'GET', url: '/api/notifications' }, clientCookie),
    );
    const notificationId = list.json().data[0].id;
    expect(list.json().data[0].link).toBe(`/pendencias/${created.id}`);

    const read = await app.inject(
      authed({ method: 'POST', url: `/api/notifications/${notificationId}/read` }, clientCookie),
    );
    expect(read.statusCode).toBe(200);
    expect(read.json().data.readAt).not.toBeNull();
    expect(read.json().data.link).toBe(`/pendencias/${created.id}`);

    const after = await app.inject(
      authed({ method: 'GET', url: '/api/notifications/unread-count' }, clientCookie),
    );
    expect(after.json().data.unread).toBe(0);
  });

  it('refuses to mark somebody else notification read', async () => {
    const managerCookie = await sessionFor(world.managerA);
    await createPendingRequest(managerCookie, world.clientA.id);

    const theirs = await systemRead((tx) =>
      tx.notification.findFirst({ where: { recipientId: world.clientA.id } }),
    );

    const intruder = await sessionFor(world.contributorA);
    const response = await app.inject(
      authed({ method: 'POST', url: `/api/notifications/${theirs?.id}/read` }, intruder),
    );

    expect(response.statusCode).toBe(404);
    const still = await systemRead((tx) =>
      tx.notification.findUnique({ where: { id: theirs!.id } }),
    );
    expect(still?.readAt).toBeNull();
  });

  it('filters to unread only', async () => {
    const managerCookie = await sessionFor(world.managerA);
    await createPendingRequest(managerCookie, world.clientA.id, 'Primeira');

    const clientCookie = await sessionFor(world.clientA);
    await app.inject(authed({ method: 'POST', url: '/api/notifications/read-all' }, clientCookie));

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/notifications?unreadOnly=true' }, clientCookie),
    );
    expect(response.json().data).toEqual([]);
    expect(response.json().unread).toBe(0);
  });
});

describe('preferences', () => {
  it('returns every event type with its default', async () => {
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/notifications/preferences' }, cookie),
    );

    const rows = response.json().data as { eventType: string; enabled: boolean }[];
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.find((row) => row.eventType === 'user.mentioned')?.enabled).toBe(true);
    expect(rows.find((row) => row.eventType === 'comment.created')?.enabled).toBe(false);
  });

  it('stores an override without touching anyone else', async () => {
    const cookie = await sessionFor(world.clientA);

    await app.inject(
      authed(
        {
          method: 'PUT',
          url: '/api/notifications/preferences',
          payload: { eventType: 'user.mentioned', channel: 'push', enabled: false },
        },
        cookie,
      ),
    );

    const mine = await app.inject(
      authed({ method: 'GET', url: '/api/notifications/preferences' }, cookie),
    );
    expect(
      (mine.json().data as { eventType: string; enabled: boolean }[]).find(
        (row) => row.eventType === 'user.mentioned',
      )?.enabled,
    ).toBe(false);

    const otherCookie = await sessionFor(world.managerA);
    const theirs = await app.inject(
      authed({ method: 'GET', url: '/api/notifications/preferences' }, otherCookie),
    );
    expect(
      (theirs.json().data as { eventType: string; enabled: boolean }[]).find(
        (row) => row.eventType === 'user.mentioned',
      )?.enabled,
    ).toBe(true);
  });

  it('refuses to turn the in-app channel off, because it is the system of record', async () => {
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(
      authed(
        {
          method: 'PUT',
          url: '/api/notifications/preferences',
          payload: { eventType: 'user.mentioned', channel: 'in_app', enabled: false },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(400);
  });
});

describe('push devices', () => {
  const subscription = {
    endpoint: 'https://push.example.com/endpoint/abc123456789',
    p256dhKey: 'chave-publica-do-navegador',
    authKey: 'segredo-do-navegador',
    userAgent: 'Vitest',
  };

  it('registers a browser and lists it without leaking the endpoint', async () => {
    const cookie = await sessionFor(world.clientA);

    const created = await app.inject(
      authed({ method: 'POST', url: '/api/push/devices', payload: subscription }, cookie),
    );
    expect(created.statusCode).toBe(201);

    const list = await app.inject(authed({ method: 'GET', url: '/api/push/devices' }, cookie));
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].endpoint).toBeUndefined();
    expect(list.json().data[0].fingerprint).toBe('abc123456789');
  });

  it('updates the same registration instead of accumulating duplicates', async () => {
    const cookie = await sessionFor(world.clientA);

    await app.inject(
      authed({ method: 'POST', url: '/api/push/devices', payload: subscription }, cookie),
    );
    const second = await app.inject(
      authed({ method: 'POST', url: '/api/push/devices', payload: subscription }, cookie),
    );

    expect(second.statusCode).toBe(200);
    const list = await app.inject(authed({ method: 'GET', url: '/api/push/devices' }, cookie));
    expect(list.json().data).toHaveLength(1);
  });

  it('never lets one user revoke another device', async () => {
    const cookie = await sessionFor(world.clientA);
    const created = await app.inject(
      authed({ method: 'POST', url: '/api/push/devices', payload: subscription }, cookie),
    );
    const deviceId = created.json().data.id;

    const intruder = await sessionFor(world.contributorA);
    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/push/devices/${deviceId}` }, intruder),
    );

    expect(response.statusCode).toBe(404);
    const device = await systemRead((tx) => tx.pushDevice.findUnique({ where: { id: deviceId } }));
    expect(device?.revokedAt).toBeNull();
  });

  it('reports whether this deployment can push at all', async () => {
    const cookie = await sessionFor(world.clientA);

    const response = await app.inject(authed({ method: 'GET', url: '/api/push/config' }, cookie));

    expect(response.statusCode).toBe(200);
    expect(typeof response.json().data.enabled).toBe('boolean');
  });
});

describe('the overdue sweep', () => {
  it('notifies the responsible party once, however often it runs', async () => {
    const content = await withSystemScope(prisma, (tx) =>
      tx.content.create({
        data: {
          companyId: world.companyA.id,
          title: 'Post atrasado',
          scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          productionStatus: 'in_production',
          responsibleUserId: world.clientA.id,
        },
      }),
    );

    await notifyOverdueContent(prisma);
    await notifyOverdueContent(prisma);

    const rows = await notificationsOf(world.clientA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'content.overdue',
      relatedType: 'content',
      relatedId: content.id,
    });
  });

  it('leaves finished and future content alone', async () => {
    await withSystemScope(prisma, (tx) =>
      tx.content.createMany({
        data: [
          {
            companyId: world.companyA.id,
            title: 'Concluído',
            scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
            productionStatus: 'completed',
            responsibleUserId: world.clientA.id,
          },
          {
            companyId: world.companyA.id,
            title: 'Futuro',
            scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            productionStatus: 'planned',
            responsibleUserId: world.clientA.id,
          },
        ],
      }),
    );

    const result = await notifyOverdueContent(prisma);

    expect(result.overdue).toBe(0);
    expect(await notificationsOf(world.clientA.id)).toEqual([]);
  });
});
