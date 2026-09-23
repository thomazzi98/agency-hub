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
  moderatorA: User;
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

  const [admin, managerA, moderatorA, clientA, contributorA, managerB] = await Promise.all([
    createTestUser({ email: 'ct-admin@example.com', role: 'agency_admin' }),
    createTestUser({ email: 'ct-manager-a@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'ct-moderator-a@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'ct-client-a@example.com', role: 'client_manager' }),
    createTestUser({ email: 'ct-contributor-a@example.com', role: 'contributor' }),
    createTestUser({ email: 'ct-manager-b@example.com', role: 'agency_manager' }),
  ]);

  await Promise.all([
    grantMembership(managerA.id, companyA.id),
    grantMembership(moderatorA.id, companyA.id, { canDeleteCompanyFiles: true }),
    grantMembership(clientA.id, companyA.id),
    grantMembership(contributorA.id, companyA.id),
    grantMembership(managerB.id, companyB.id),
  ]);

  return { companyA, companyB, admin, managerA, moderatorA, clientA, contributorA, managerB };
}

const sessionFor = (user: User) => loginAs(app, user.email, DEFAULT_TEST_PASSWORD);

let seedCounter = 0;

async function seedProject(companyId: string) {
  seedCounter += 1;
  return withSystemScope(prisma, (tx) =>
    tx.project.create({ data: { companyId, name: `Projeto ${seedCounter}` } }),
  );
}

async function seedFile(companyId: string) {
  seedCounter += 1;
  return withSystemScope(prisma, (tx) =>
    tx.file.create({
      data: {
        companyId,
        originalName: `arquivo-${seedCounter}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: BigInt(1024),
        storageKey: `${companyId}/no-project/seed-${seedCounter}/arquivo.jpg`,
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

describe('comments', () => {
  it.each([
    ['agency_manager', () => world.managerA],
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('lets a %s comment on a project in their company', async (_role, pick) => {
    const project = await seedProject(world.companyA.id);
    const cookie = await sessionFor(pick());

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'project',
            commentableId: project.id,
            body: 'Anotação sobre o projeto.',
          },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(201);
    // The company is taken from the target row, not from the request.
    expect(response.json().data.companyId).toBe(world.companyA.id);
  });

  it('returns the thread in the order it was written', async () => {
    const file = await seedFile(world.companyA.id);
    const cookie = await sessionFor(world.contributorA);

    for (const body of ['Primeiro', 'Segundo', 'Terceiro']) {
      await app.inject(
        authed(
          {
            method: 'POST',
            url: '/api/comments',
            payload: { commentableType: 'file', commentableId: file.id, body },
          },
          cookie,
        ),
      );
    }

    const listed = await app.inject(
      authed(
        { method: 'GET', url: `/api/comments?commentableType=file&commentableId=${file.id}` },
        cookie,
      ),
    );

    expect((listed.json().data as { body: string }[]).map((comment) => comment.body)).toEqual([
      'Primeiro',
      'Segundo',
      'Terceiro',
    ]);
  });

  it('says who wrote each comment and carries the file a reply attached', async () => {
    const project = await seedProject(world.companyA.id);
    const attachment = await seedFile(world.companyA.id);
    const cookie = await sessionFor(world.clientA);

    await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'project',
            commentableId: project.id,
            body: 'Segue o material.',
            attachmentFileId: attachment.id,
          },
        },
        cookie,
      ),
    );

    const list = () =>
      app.inject(
        authed(
          {
            method: 'GET',
            url: `/api/comments?commentableType=project&commentableId=${project.id}`,
          },
          cookie,
        ),
      );

    const [comment] = (await list()).json().data;
    expect(comment.author).toEqual({ id: world.clientA.id, name: world.clientA.name });
    expect(comment.attachment).toEqual({
      id: attachment.id,
      originalName: attachment.originalName,
      sizeBytes: 1024,
      removed: false,
    });

    // A file deleted since is reported as gone, not offered for download.
    await withSystemScope(prisma, (tx) =>
      tx.file.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } }),
    );
    expect((await list()).json().data[0].attachment.removed).toBe(true);
  });

  it('refuses to comment on another company resource', async () => {
    const foreign = await seedProject(world.companyB.id);
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: { commentableType: 'project', commentableId: foreign.id, body: 'Invasor' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(404);
    expect(await systemRead((tx) => tx.comment.count())).toBe(0);
  });

  it('refuses an attachment that belongs to another company', async () => {
    const project = await seedProject(world.companyA.id);
    const foreignFile = await seedFile(world.companyB.id);
    const cookie = await sessionFor(world.contributorA);

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'project',
            commentableId: project.id,
            body: 'Com anexo alheio',
            attachmentFileId: foreignFile.id,
          },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unknown_file');
  });

  it('reports a comment on a target that does not exist as missing', async () => {
    const cookie = await sessionFor(world.contributorA);

    // Stage 10 built `pending_request`, the last commentable type that had no table
    // behind it. Every member of the enum now resolves to a real row or to a 404 —
    // there is no "unsupported target" branch left to fall through to.
    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: {
            commentableType: 'pending_request',
            commentableId: '00000000-0000-4000-8000-000000000000',
            body: 'Sobre uma pendência',
          },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });

  it('lets an author edit and remove their own comment', async () => {
    const project = await seedProject(world.companyA.id);
    const cookie = await sessionFor(world.contributorA);

    const created = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: { commentableType: 'project', commentableId: project.id, body: 'Original' },
        },
        cookie,
      ),
    );
    const id = created.json().data.id as string;

    const edited = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/comments/${id}`, payload: { body: 'Corrigido' } },
        cookie,
      ),
    );
    expect(edited.json().data.body).toBe('Corrigido');

    const removed = await app.inject(
      authed({ method: 'DELETE', url: `/api/comments/${id}` }, cookie),
    );
    expect(removed.statusCode).toBe(200);

    // Soft-deleted: out of the thread, still on the record.
    const stored = await systemRead((tx) => tx.comment.findUniqueOrThrow({ where: { id } }));
    expect(stored.deletedAt).not.toBeNull();

    const listed = await app.inject(
      authed(
        { method: 'GET', url: `/api/comments?commentableType=project&commentableId=${project.id}` },
        cookie,
      ),
    );
    expect(listed.json().data).toEqual([]);
  });

  it('refuses to touch someone else comment without moderation rights', async () => {
    const project = await seedProject(world.companyA.id);
    const authorCookie = await sessionFor(world.contributorA);
    const created = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: { commentableType: 'project', commentableId: project.id, body: 'Meu' },
        },
        authorCookie,
      ),
    );
    const id = created.json().data.id as string;

    const otherCookie = await sessionFor(world.clientA);
    const edited = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/comments/${id}`, payload: { body: 'Alterado' } },
        otherCookie,
      ),
    );
    const removed = await app.inject(
      authed({ method: 'DELETE', url: `/api/comments/${id}` }, otherCookie),
    );

    expect([edited.statusCode, removed.statusCode]).toEqual([403, 403]);
  });

  it.each([
    ['agency_admin', () => world.admin],
    ['agency_manager with the override', () => world.moderatorA],
  ])('lets a %s moderate someone else comment', async (_role, pick) => {
    const project = await seedProject(world.companyA.id);
    const authorCookie = await sessionFor(world.contributorA);
    const created = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: { commentableType: 'project', commentableId: project.id, body: 'Meu' },
        },
        authorCookie,
      ),
    );
    const id = created.json().data.id as string;

    const cookie = await sessionFor(pick());
    const removed = await app.inject(
      authed({ method: 'DELETE', url: `/api/comments/${id}` }, cookie),
    );

    expect(removed.statusCode).toBe(200);
  });

  it('refuses an agency_manager without the override', async () => {
    const project = await seedProject(world.companyA.id);
    const authorCookie = await sessionFor(world.contributorA);
    const created = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/comments',
          payload: { commentableType: 'project', commentableId: project.id, body: 'Meu' },
        },
        authorCookie,
      ),
    );
    const id = created.json().data.id as string;

    const cookie = await sessionFor(world.managerA);
    const removed = await app.inject(
      authed({ method: 'DELETE', url: `/api/comments/${id}` }, cookie),
    );

    expect(removed.statusCode).toBe(403);
  });
});

describe('follow-up topics', () => {
  async function createTopic(cookie: string, overrides: Record<string, unknown> = {}) {
    return app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/topics',
          payload: {
            companyId: world.companyA.id,
            title: 'Falta o material da fachada',
            initialMessage: 'Pode enviar as fotos até sexta?',
            responsibleUserId: world.contributorA.id,
            ...overrides,
          },
        },
        cookie,
      ),
    );
  }

  it('starts awaiting the responsible party', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await createTopic(cookie);

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      status: 'awaiting_response',
      responsibleUserId: world.contributorA.id,
      priority: 'medium',
    });
  });

  it.each([
    ['client_manager', () => world.clientA],
    ['contributor', () => world.contributorA],
  ])('refuses topic creation to a %s', async (_role, pick) => {
    const cookie = await sessionFor(pick());

    const response = await createTopic(cookie);

    expect(response.statusCode).toBe(403);
  });

  it('refuses a responsible party with no access to the company', async () => {
    const cookie = await sessionFor(world.managerA);

    const response = await createTopic(cookie, { responsibleUserId: world.managerB.id });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('responsible_without_access');
  });

  it('moves the topic back and forth as each side replies', async () => {
    const creatorCookie = await sessionFor(world.managerA);
    const created = await createTopic(creatorCookie);
    const topicId = created.json().data.id as string;

    const responsibleCookie = await sessionFor(world.contributorA);
    const answered = await app.inject(
      authed(
        { method: 'POST', url: `/api/topics/${topicId}/replies`, payload: { body: 'Envio hoje.' } },
        responsibleCookie,
      ),
    );
    expect(answered.statusCode).toBe(201);
    // Answered: now it is the creator's turn to look at it.
    expect(answered.json().data.topicStatus).toBe('in_review');

    const followUp = await app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/topics/${topicId}/replies`,
          payload: { body: 'Faltou a lateral.' },
        },
        creatorCookie,
      ),
    );
    expect(followUp.json().data.topicStatus).toBe('awaiting_response');
  });

  it('keeps replies in order with their author', async () => {
    const creatorCookie = await sessionFor(world.managerA);
    const created = await createTopic(creatorCookie);
    const topicId = created.json().data.id as string;
    const responsibleCookie = await sessionFor(world.contributorA);

    await app.inject(
      authed(
        { method: 'POST', url: `/api/topics/${topicId}/replies`, payload: { body: 'Primeira' } },
        responsibleCookie,
      ),
    );
    await app.inject(
      authed(
        { method: 'POST', url: `/api/topics/${topicId}/replies`, payload: { body: 'Segunda' } },
        creatorCookie,
      ),
    );

    const detail = await app.inject(
      authed({ method: 'GET', url: `/api/topics/${topicId}` }, creatorCookie),
    );
    const replies = detail.json().data.replies as { body: string; authorId: string }[];

    expect(replies.map((reply) => reply.body)).toEqual(['Primeira', 'Segunda']);
    expect(replies[0]?.authorId).toBe(world.contributorA.id);
    expect(replies[1]?.authorId).toBe(world.managerA.id);
    // Names, not only ids: the screen has to say who wrote what.
    expect(detail.json().data.replies[0].author).toEqual({ name: world.contributorA.name });
    expect(detail.json().data.creator).toEqual({ name: world.managerA.name });
    expect(detail.json().data.responsibleUser).toEqual({ name: world.contributorA.name });
  });

  it('refuses to reassign a topic to someone who cannot reach the company', async () => {
    const creatorCookie = await sessionFor(world.managerA);
    const created = await createTopic(creatorCookie);
    const topicId = created.json().data.id as string;

    const [foreign, unknown] = await Promise.all([
      app.inject(
        authed(
          {
            method: 'PATCH',
            url: `/api/topics/${topicId}`,
            payload: { responsibleUserId: world.managerB.id },
          },
          creatorCookie,
        ),
      ),
      app.inject(
        authed(
          {
            method: 'PATCH',
            url: `/api/topics/${topicId}`,
            payload: { responsibleUserId: crypto.randomUUID() },
          },
          creatorCookie,
        ),
      ),
    ]);

    // The same rule creation applies - and an id that is no user at all is refused the
    // same way instead of surfacing as a foreign-key error.
    for (const response of [foreign, unknown]) {
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('responsible_without_access');
    }
    const stored = await systemRead((tx) => tx.topic.findUniqueOrThrow({ where: { id: topicId } }));
    expect(stored.responsibleUserId).toBe(world.contributorA.id);
  });

  it('refuses a reply from someone who is not part of the conversation', async () => {
    const creatorCookie = await sessionFor(world.managerA);
    const created = await createTopic(creatorCookie);
    const topicId = created.json().data.id as string;

    const outsiderCookie = await sessionFor(world.clientA);
    const response = await app.inject(
      authed(
        { method: 'POST', url: `/api/topics/${topicId}/replies`, payload: { body: 'Opinião' } },
        outsiderCookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });

  it('refuses a reply once the topic is resolved', async () => {
    const creatorCookie = await sessionFor(world.managerA);
    const created = await createTopic(creatorCookie);
    const topicId = created.json().data.id as string;

    await app.inject(
      authed(
        { method: 'PATCH', url: `/api/topics/${topicId}`, payload: { status: 'resolved' } },
        creatorCookie,
      ),
    );

    const response = await app.inject(
      authed(
        { method: 'POST', url: `/api/topics/${topicId}/replies`, payload: { body: 'Mais uma' } },
        creatorCookie,
      ),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('topic_closed');
  });

  it('refuses to change a topic someone else created', async () => {
    const creatorCookie = await sessionFor(world.managerA);
    const created = await createTopic(creatorCookie);
    const topicId = created.json().data.id as string;

    const otherCookie = await sessionFor(world.moderatorA);
    const response = await app.inject(
      authed(
        { method: 'PATCH', url: `/api/topics/${topicId}`, payload: { status: 'resolved' } },
        otherCookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });

  describe('views', () => {
    it('separates what I raised from what is waiting on me', async () => {
      const managerCookie = await sessionFor(world.managerA);
      await createTopic(managerCookie);
      await createTopic(managerCookie, { responsibleUserId: world.clientA.id });

      const mine = await app.inject(
        authed({ method: 'GET', url: '/api/topics?view=created_by_me' }, managerCookie),
      );
      expect(mine.json().meta.total).toBe(2);

      const responsibleCookie = await sessionFor(world.contributorA);
      const awaitingMe = await app.inject(
        authed({ method: 'GET', url: '/api/topics?view=awaiting_me' }, responsibleCookie),
      );
      expect(awaitingMe.json().meta.total).toBe(1);

      const awaitingOthers = await app.inject(
        authed({ method: 'GET', url: '/api/topics?view=awaiting_others' }, managerCookie),
      );
      expect(awaitingOthers.json().meta.total).toBe(2);
    });

    it('moves a topic out of the open view once resolved', async () => {
      const cookie = await sessionFor(world.managerA);
      const created = await createTopic(cookie);
      const topicId = created.json().data.id as string;

      expect(
        (await app.inject(authed({ method: 'GET', url: '/api/topics?view=open' }, cookie))).json()
          .meta.total,
      ).toBe(1);

      await app.inject(
        authed(
          { method: 'PATCH', url: `/api/topics/${topicId}`, payload: { status: 'resolved' } },
          cookie,
        ),
      );

      expect(
        (await app.inject(authed({ method: 'GET', url: '/api/topics?view=open' }, cookie))).json()
          .meta.total,
      ).toBe(0);
      expect(
        (
          await app.inject(authed({ method: 'GET', url: '/api/topics?view=resolved' }, cookie))
        ).json().meta.total,
      ).toBe(1);
    });

    it('returns nothing when the view and the status filter contradict each other', async () => {
      const cookie = await sessionFor(world.managerA);
      await createTopic(cookie);

      const response = await app.inject(
        authed({ method: 'GET', url: '/api/topics?view=open&status=resolved' }, cookie),
      );

      // Both conditions apply; neither silently overwrites the other.
      expect(response.json().meta.total).toBe(0);
    });

    it('never shows one company topics to another', async () => {
      const cookie = await sessionFor(world.managerA);
      await createTopic(cookie);

      const outsiderCookie = await sessionFor(world.managerB);
      const response = await app.inject(
        authed({ method: 'GET', url: '/api/topics' }, outsiderCookie),
      );

      expect(response.json().data).toEqual([]);
    });
  });
});
