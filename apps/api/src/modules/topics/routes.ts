import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { conflict, forbidden, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { notifyTopicCreated, notifyTopicReplied } from '../notifications/events.js';
import { clientIp } from '../../shared/request-context.js';
import { authorizedCompanyIds, requireCompanyAccess } from '../../shared/permissions.js';
import { paginated, paginationArgs, paginationSchema } from '../../shared/pagination.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';
import type { AuthenticatedActor } from '../../shared/actor.js';
import type { Prisma, TopicStatus } from '@prisma/client';

const priority = z.enum(['low', 'medium', 'high']);
const topicStatus = z.enum(['open', 'awaiting_response', 'in_review', 'resolved', 'cancelled']);
const relatedType = z.enum(['project', 'content', 'campaign', 'pending_request', 'file']);

/**
 * The views the spec requires (03-functional-requirements.md#follow-up-topics), each a
 * server-side filter rather than something the client assembles — the client never
 * receives topics it would then have to hide.
 */
const topicView = z.enum([
  'all',
  'created_by_me',
  'awaiting_me',
  'awaiting_others',
  'open',
  'resolved',
]);

/** Non-terminal states: a topic still needing someone to do something. */
const OPEN_STATUSES: TopicStatus[] = ['open', 'awaiting_response', 'in_review'];
/** Waiting specifically on the responsible party to answer. */
const AWAITING_RESPONSE_STATUSES: TopicStatus[] = ['open', 'awaiting_response'];

const listQuerySchema = paginationSchema.extend({
  view: topicView.default('all'),
  companyId: z.string().uuid().optional(),
  responsibleUserId: z.string().uuid().optional(),
  priority: priority.optional(),
  status: z.union([topicStatus, z.literal('all')]).default('all'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const createSchema = z.object({
  companyId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  initialMessage: z.string().trim().min(1).max(5000),
  responsibleUserId: z.string().uuid(),
  relatedType: relatedType.nullish(),
  relatedId: z.string().uuid().nullish(),
  priority: priority.default('medium'),
  dueDate: z.coerce.date().nullish(),
});

const updateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  responsibleUserId: z.string().uuid().optional(),
  priority: priority.optional(),
  dueDate: z.coerce.date().nullish(),
  status: topicStatus.optional(),
});

const replySchema = z.object({ body: z.string().trim().min(1).max(5000) });
const idParamsSchema = z.object({ id: z.string().uuid() });

const topicSelect = {
  id: true,
  companyId: true,
  title: true,
  initialMessage: true,
  creatorId: true,
  responsibleUserId: true,
  relatedType: true,
  relatedId: true,
  priority: true,
  dueDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Creating a topic is an agency act; anyone named responsible can reply to one. */
function requireTopicCreation(actor: AuthenticatedActor): void {
  if (actor.role !== 'agency_admin' && actor.role !== 'agency_manager') {
    throw forbidden('forbidden', 'Você não tem permissão para criar tópicos.');
  }
}

async function findTopicInScope(tx: ScopedDb, id: string, companyIds: string[] | null) {
  return tx.topic.findFirst({
    where: { id, ...(companyIds === null ? {} : { companyId: { in: companyIds } }) },
    select: topicSelect,
  });
}

function viewFilter(view: z.infer<typeof topicView>, userId: string): Prisma.TopicWhereInput {
  switch (view) {
    case 'created_by_me':
      return { creatorId: userId };
    case 'awaiting_me':
      return { responsibleUserId: userId, status: { in: AWAITING_RESPONSE_STATUSES } };
    case 'awaiting_others':
      return { creatorId: userId, status: { in: AWAITING_RESPONSE_STATUSES } };
    case 'open':
      return { status: { in: OPEN_STATUSES } };
    case 'resolved':
      return { status: 'resolved' as const };
    default:
      return {};
  }
}

export async function topicRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/topics',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      const companyIds = authorizedCompanyIds(actor);

      if (query.companyId) {
        requireCompanyAccess(actor, query.companyId);
      }

      // The view and an explicit status filter are combined with AND rather than
      // spread over each other: `?view=open&status=resolved` should return nothing,
      // not silently drop whichever the object literal happened to overwrite.
      const where: Prisma.TopicWhereInput = {
        AND: [
          query.companyId
            ? { companyId: query.companyId }
            : companyIds === null
              ? {}
              : { companyId: { in: companyIds } },
          viewFilter(query.view, actor.userId),
          query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {},
          query.priority ? { priority: query.priority } : {},
          query.status === 'all' ? {} : { status: query.status },
          query.from || query.to
            ? {
                createdAt: {
                  ...(query.from ? { gte: query.from } : {}),
                  ...(query.to ? { lte: query.to } : {}),
                },
              }
            : {},
        ],
      };

      const [rows, total] = await Promise.all([
        tx.topic.findMany({
          where,
          select: { ...topicSelect, _count: { select: { replies: true } } },
          orderBy: { createdAt: 'desc' },
          ...paginationArgs(query),
        }),
        tx.topic.count({ where }),
      ]);

      return paginated(rows, total, query);
    }),
  );

  app.get(
    '/topics/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const topic = await findTopicInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!topic) {
        throw notFound('not_found', 'Tópico não encontrado.');
      }

      const replies = await tx.topicReply.findMany({
        where: { topicId: topic.id },
        select: { id: true, authorId: true, body: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      return { data: { ...topic, replies } };
    }),
  );

  app.post(
    '/topics',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      requireTopicCreation(actor);
      const body = parseInput(createSchema, request.body);
      requireCompanyAccess(actor, body.companyId);

      // The responsible party must actually have access to the company, or the topic
      // would sit forever in a queue they cannot see.
      const membership = await tx.companyMembership.findFirst({
        where: { userId: body.responsibleUserId, companyId: body.companyId, status: 'active' },
        select: { id: true },
      });
      const responsibleIsAdmin = await tx.user.findFirst({
        where: { id: body.responsibleUserId, role: 'agency_admin', status: 'active' },
        select: { id: true },
      });
      if (!membership && !responsibleIsAdmin) {
        throw unprocessable(
          'responsible_without_access',
          'O responsável escolhido não tem acesso a esta empresa.',
        );
      }

      if ((body.relatedType && !body.relatedId) || (!body.relatedType && body.relatedId)) {
        throw unprocessable('incomplete_relation', 'Informe o tipo e o item relacionado.');
      }

      const topic = await tx.topic.create({
        data: {
          companyId: body.companyId,
          title: body.title,
          initialMessage: body.initialMessage,
          creatorId: actor.userId,
          responsibleUserId: body.responsibleUserId,
          relatedType: body.relatedType ?? null,
          relatedId: body.relatedId ?? null,
          priority: body.priority,
          dueDate: body.dueDate ?? null,
        },
        select: topicSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: topic.companyId,
        action: AuditAction.TopicCreated,
        entityType: 'topic',
        entityId: topic.id,
        ipAddress: clientIp(request),
        metadata: { responsibleUserId: body.responsibleUserId },
      });

      await notifyTopicCreated(tx, {
        companyId: topic.companyId,
        actorId: actor.userId,
        topicId: topic.id,
        title: topic.title,
        responsibleUserId: body.responsibleUserId,
      });

      reply.code(201);
      return { data: topic };
    }),
  );

  app.patch(
    '/topics/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(updateSchema, request.body);

      const existing = await findTopicInScope(tx, params.id, authorizedCompanyIds(actor));
      if (!existing) {
        throw notFound('not_found', 'Tópico não encontrado.');
      }

      // The creator drives the topic's lifecycle; an agency_admin can step in.
      const isCreator = existing.creatorId === actor.userId;
      if (!isCreator && actor.role !== 'agency_admin') {
        throw forbidden('forbidden', 'Apenas quem criou o tópico pode alterá-lo.');
      }

      const topic = await tx.topic.update({
        where: { id: params.id },
        data: body,
        select: topicSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: topic.companyId,
        action: body.status ? AuditAction.TopicStatusChanged : AuditAction.TopicUpdated,
        entityType: 'topic',
        entityId: topic.id,
        ipAddress: clientIp(request),
        metadata: { changed: Object.keys(body), status: body.status ?? null },
      });

      return { data: topic };
    }),
  );

  app.post(
    '/topics/:id/replies',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(replySchema, request.body);

      const topic = await findTopicInScope(tx, params.id, authorizedCompanyIds(actor));
      if (!topic) {
        throw notFound('not_found', 'Tópico não encontrado.');
      }

      if (topic.status === 'resolved' || topic.status === 'cancelled') {
        throw conflict('topic_closed', 'Este tópico já foi encerrado.');
      }

      // A topic is a directed conversation: the responsible party, whoever raised it,
      // and the agency staff who can act on it. Not everyone in the company.
      const isResponsible = topic.responsibleUserId === actor.userId;
      const isCreator = topic.creatorId === actor.userId;
      const isAgency = actor.role === 'agency_admin' || actor.role === 'agency_manager';
      if (!isResponsible && !isCreator && !isAgency) {
        throw forbidden('forbidden', 'Você não participa deste tópico.');
      }

      const created = await tx.topicReply.create({
        data: { topicId: topic.id, authorId: actor.userId, body: body.body },
        select: { id: true, topicId: true, authorId: true, body: true, createdAt: true },
      });

      // The status follows who just spoke: an answer from the responsible party puts the
      // topic back with whoever raised it, and anything else returns the ball.
      const nextStatus = isResponsible ? 'in_review' : 'awaiting_response';
      await tx.topic.update({ where: { id: topic.id }, data: { status: nextStatus } });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: topic.companyId,
        action: AuditAction.TopicReplied,
        entityType: 'topic',
        entityId: topic.id,
        ipAddress: clientIp(request),
        metadata: { replyId: created.id, status: nextStatus },
      });

      await notifyTopicReplied(tx, {
        companyId: topic.companyId,
        actorId: actor.userId,
        topicId: topic.id,
        title: topic.title,
        creatorId: topic.creatorId,
        responsibleUserId: topic.responsibleUserId,
      });

      reply.code(201);
      return { data: { ...created, topicStatus: nextStatus } };
    }),
  );
}
