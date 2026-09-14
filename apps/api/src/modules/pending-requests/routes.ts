import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PendingRequestStatus, Prisma } from '@prisma/client';
import { parseInput } from '../../shared/validation.js';
import { forbidden, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { authorizedCompanyIds, requireCompanyAccess } from '../../shared/permissions.js';
import { assertResponsibleHasAccess } from '../../shared/references.js';
import {
  notifyCommentCreated,
  notifyPendingRequestAnswered,
  notifyPendingRequestCreated,
} from '../notifications/events.js';
import { paginated, paginationArgs, paginationSchema } from '../../shared/pagination.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';
import type { AuthenticatedActor } from '../../shared/actor.js';
import { AWAITING_RECIPIENT_STATUSES, UNFINISHED_STATUSES } from './status.js';

const priority = z.enum(['low', 'medium', 'high']);

const requestStatus = z.enum([
  'open',
  'awaiting_client',
  'answered',
  'in_review',
  'completed',
  'cancelled',
]);

/**
 * The views the screens need, each resolved on the server so the client never receives
 * rows it would then have to hide.
 */
const requestView = z.enum([
  'all',
  'created_by_me',
  'awaiting_me',
  'awaiting_others',
  'open',
  'overdue',
  'completed',
]);

const requestSelect = {
  id: true,
  companyId: true,
  projectId: true,
  title: true,
  description: true,
  responsibleUserId: true,
  createdById: true,
  dueDate: true,
  priority: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const listQuerySchema = paginationSchema.extend({
  view: requestView.default('all'),
  companyId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  responsibleUserId: z.string().uuid().optional(),
  priority: priority.optional(),
  status: z.union([requestStatus, z.literal('all')]).default('all'),
  search: z.string().trim().min(1).max(200).optional(),
});

const createSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(5000),
  responsibleUserId: z.string().uuid(),
  dueDate: z.coerce.date().nullish(),
  priority: priority.default('medium'),
});

const updateSchema = z.object({
  projectId: z.string().uuid().nullish(),
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  responsibleUserId: z.string().uuid().optional(),
  dueDate: z.coerce.date().nullish(),
  priority: priority.optional(),
  status: requestStatus.optional(),
});

const respondSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  /** A file already uploaded through the normal upload flow (Stage 6). */
  attachmentFileId: z.string().uuid().nullish(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Opening a pendência is agency work. The matrix marks `client_manager` "🔶 (rare)",
 * but the data model carries no membership override for it (23-open-questions.md #9),
 * so the default applies and the role is refused — the same call the projects module
 * makes for the same marking.
 */
function requireRequestCreation(actor: AuthenticatedActor): void {
  if (actor.role !== 'agency_admin' && actor.role !== 'agency_manager') {
    throw forbidden('forbidden', 'Você não tem permissão para criar pendências.');
  }
}

/** Anti-IDOR: the authorized scope is a required argument, never an optional one. */
async function findRequestInScope(tx: ScopedDb, id: string, companyIds: string[] | null) {
  return tx.pendingRequest.findFirst({
    where: { id, ...(companyIds === null ? {} : { companyId: { in: companyIds } }) },
    select: requestSelect,
  });
}

type RequestRow = {
  dueDate: Date | null;
  status: PendingRequestStatus;
} & Record<string, unknown>;

/**
 * Derived on the server so "atrasada" means the same thing on the list, the detail and
 * the dashboard rather than being re-derived slightly differently by each.
 */
function withFlags(row: RequestRow, actorId: string, today: Date) {
  return {
    ...row,
    isOverdue:
      row.dueDate !== null && row.dueDate < today && UNFINISHED_STATUSES.includes(row.status),
    isAwaitingRecipient: AWAITING_RECIPIENT_STATUSES.includes(row.status),
    isMine: row.responsibleUserId === actorId,
  };
}

/** Midnight today, UTC: `due_date` is a date column, so the comparison must be too. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function companyScope(
  companyId: string | undefined,
  companyIds: string[] | null,
): Prisma.PendingRequestWhereInput {
  if (companyId) return { companyId };
  return companyIds === null ? {} : { companyId: { in: companyIds } };
}

function viewFilter(
  view: z.infer<typeof requestView>,
  actorId: string,
  today: Date,
): Prisma.PendingRequestWhereInput {
  switch (view) {
    case 'created_by_me':
      return { createdById: actorId };
    case 'awaiting_me':
      return { responsibleUserId: actorId, status: { in: AWAITING_RECIPIENT_STATUSES } };
    case 'awaiting_others':
      return {
        responsibleUserId: { not: actorId },
        status: { in: AWAITING_RECIPIENT_STATUSES },
      };
    case 'open':
      return { status: { in: UNFINISHED_STATUSES } };
    case 'overdue':
      return { dueDate: { lt: today }, status: { in: UNFINISHED_STATUSES } };
    case 'completed':
      return { status: 'completed' };
    default:
      return {};
  }
}

async function assertProjectInCompany(
  tx: ScopedDb,
  companyId: string,
  projectId: string | null | undefined,
): Promise<void> {
  if (!projectId) return;
  const project = await tx.project.findFirst({
    where: { id: projectId, companyId },
    select: { id: true },
  });
  if (!project) throw unprocessable('unknown_project', 'Projeto não encontrado nesta empresa.');
}

export async function pendingRequestRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/pending-requests',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      if (query.companyId) requireCompanyAccess(actor, query.companyId);

      const today = startOfToday();
      const where: Prisma.PendingRequestWhereInput = {
        AND: [
          companyScope(query.companyId, authorizedCompanyIds(actor)),
          viewFilter(query.view, actor.userId, today),
          query.projectId ? { projectId: query.projectId } : {},
          query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {},
          query.priority ? { priority: query.priority } : {},
          query.status === 'all' ? {} : { status: query.status },
          query.search ? { title: { contains: query.search, mode: 'insensitive' as const } } : {},
        ],
      };

      const [rows, total] = await Promise.all([
        tx.pendingRequest.findMany({
          where,
          select: requestSelect,
          // Oldest first inside the unfinished views: the one waiting longest is the
          // one that needs chasing.
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
          ...paginationArgs(query),
        }),
        tx.pendingRequest.count({ where }),
      ]);

      return paginated(
        rows.map((row) => withFlags(row, actor.userId, today)),
        total,
        query,
      );
    }),
  );

  /** The aggregate the dashboards read (03-functional-requirements.md#dashboards). */
  app.get(
    '/pending-requests/summary',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(
        z.object({ companyId: z.string().uuid().optional() }),
        request.query,
      );
      if (query.companyId) requireCompanyAccess(actor, query.companyId);

      const scope = companyScope(query.companyId, authorizedCompanyIds(actor));
      const today = startOfToday();

      const [grouped, overdue, awaitingMe] = await Promise.all([
        tx.pendingRequest.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
        tx.pendingRequest.count({
          where: { AND: [scope, { dueDate: { lt: today }, status: { in: UNFINISHED_STATUSES } }] },
        }),
        tx.pendingRequest.count({
          where: {
            AND: [
              scope,
              { responsibleUserId: actor.userId, status: { in: AWAITING_RECIPIENT_STATUSES } },
            ],
          },
        }),
      ]);

      const byStatus = Object.fromEntries(
        grouped.map((entry) => [entry.status, entry._count._all]),
      ) as Record<PendingRequestStatus, number | undefined>;

      return {
        data: {
          open: byStatus.open ?? 0,
          awaitingClient: byStatus.awaiting_client ?? 0,
          answered: byStatus.answered ?? 0,
          inReview: byStatus.in_review ?? 0,
          completed: byStatus.completed ?? 0,
          cancelled: byStatus.cancelled ?? 0,
          overdue,
          awaitingMe,
          total: grouped.reduce((sum, entry) => sum + entry._count._all, 0),
        },
      };
    }),
  );

  app.get(
    '/pending-requests/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const pendingRequest = await findRequestInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!pendingRequest) {
        throw notFound('not_found', 'Pendência não encontrada.');
      }
      return { data: withFlags(pendingRequest, actor.userId, startOfToday()) };
    }),
  );

  app.post(
    '/pending-requests',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      requireRequestCreation(actor);
      const body = parseInput(createSchema, request.body);
      requireCompanyAccess(actor, body.companyId);

      await assertProjectInCompany(tx, body.companyId, body.projectId);
      // A request addressed to someone who cannot open the company would sit forever
      // in a queue they never see.
      await assertResponsibleHasAccess(tx, body.companyId, body.responsibleUserId);

      const pendingRequest = await tx.pendingRequest.create({
        data: {
          companyId: body.companyId,
          projectId: body.projectId ?? null,
          title: body.title,
          description: body.description,
          responsibleUserId: body.responsibleUserId,
          createdById: actor.userId,
          dueDate: body.dueDate ?? null,
          priority: body.priority,
        },
        select: requestSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: pendingRequest.companyId,
        action: AuditAction.PendingRequestCreated,
        entityType: 'pending_request',
        entityId: pendingRequest.id,
        ipAddress: clientIp(request),
        metadata: { responsibleUserId: pendingRequest.responsibleUserId },
      });

      await notifyPendingRequestCreated(tx, {
        companyId: pendingRequest.companyId,
        actorId: actor.userId,
        requestId: pendingRequest.id,
        title: pendingRequest.title,
        responsibleUserId: pendingRequest.responsibleUserId,
      });

      reply.code(201);
      return { data: withFlags(pendingRequest, actor.userId, startOfToday()) };
    }),
  );

  app.patch(
    '/pending-requests/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(updateSchema, request.body);

      const existing = await findRequestInScope(tx, params.id, authorizedCompanyIds(actor));
      if (!existing) {
        throw notFound('not_found', 'Pendência não encontrada.');
      }

      // Reassigning, rewriting or closing a request is the creator's side of the
      // conversation; the recipient's side is answering it.
      const isCreator = existing.createdById === actor.userId;
      if (!isCreator && actor.role !== 'agency_admin' && actor.role !== 'agency_manager') {
        throw forbidden(
          'forbidden',
          'Você não pode alterar esta pendência. Responda para dar andamento.',
        );
      }

      await assertProjectInCompany(tx, existing.companyId, body.projectId);
      if (body.responsibleUserId) {
        await assertResponsibleHasAccess(tx, existing.companyId, body.responsibleUserId);
      }

      const pendingRequest = await tx.pendingRequest.update({
        where: { id: params.id },
        data: body,
        select: requestSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: pendingRequest.companyId,
        action: body.status
          ? AuditAction.PendingRequestStatusChanged
          : AuditAction.PendingRequestUpdated,
        entityType: 'pending_request',
        entityId: pendingRequest.id,
        ipAddress: clientIp(request),
        metadata: { changed: Object.keys(body), ...(body.status ? { to: body.status } : {}) },
      });

      return { data: withFlags(pendingRequest, actor.userId, startOfToday()) };
    }),
  );

  /**
   * The recipient's side of the flow. A response is a comment on the request, which is
   * how an attached file ends up linked to it — the comment carries the file, and the
   * comment belongs to the request (03-functional-requirements.md#pending-requests).
   *
   * Both writes happen in the same scoped transaction, so a response can never be
   * recorded without the status catching up, or the other way round.
   */
  app.post(
    '/pending-requests/:id/respond',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(respondSchema, request.body);

      const existing = await findRequestInScope(tx, params.id, authorizedCompanyIds(actor));
      if (!existing) {
        throw notFound('not_found', 'Pendência não encontrada.');
      }

      if (existing.status === 'completed' || existing.status === 'cancelled') {
        throw unprocessable('request_closed', 'Esta pendência já foi encerrada.');
      }

      if (body.attachmentFileId) {
        const attachment = await tx.file.findFirst({
          where: { id: body.attachmentFileId, companyId: existing.companyId, deletedAt: null },
          select: { id: true },
        });
        if (!attachment) {
          throw unprocessable('unknown_file', 'Arquivo anexado não encontrado nesta empresa.');
        }
      }

      const comment = await tx.comment.create({
        data: {
          companyId: existing.companyId,
          commentableType: 'pending_request',
          commentableId: existing.id,
          authorId: actor.userId,
          body: body.body,
          attachmentFileId: body.attachmentFileId ?? null,
        },
        select: {
          id: true,
          companyId: true,
          commentableType: true,
          commentableId: true,
          authorId: true,
          body: true,
          attachmentFileId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Only the person it was addressed to can move it to "respondida": anyone else
      // adding a note has not answered the request, they have commented on it.
      const answersIt =
        existing.responsibleUserId === actor.userId &&
        AWAITING_RECIPIENT_STATUSES.includes(existing.status);

      const pendingRequest = answersIt
        ? await tx.pendingRequest.update({
            where: { id: existing.id },
            data: { status: 'answered' },
            select: requestSelect,
          })
        : existing;

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: existing.companyId,
        action: answersIt ? AuditAction.PendingRequestAnswered : AuditAction.CommentCreated,
        entityType: 'pending_request',
        entityId: existing.id,
        ipAddress: clientIp(request),
        metadata: { commentId: comment.id, attached: Boolean(body.attachmentFileId) },
      });

      if (answersIt) {
        await notifyPendingRequestAnswered(tx, {
          companyId: existing.companyId,
          actorId: actor.userId,
          requestId: existing.id,
          title: existing.title,
          createdById: existing.createdById,
          withAttachment: Boolean(body.attachmentFileId),
        });
      } else {
        await notifyCommentCreated(tx, {
          companyId: existing.companyId,
          actorId: actor.userId,
          commentableType: 'pending_request',
          commentableId: existing.id,
          body: body.body,
        });
      }

      reply.code(201);
      return {
        data: {
          comment,
          pendingRequest: withFlags(pendingRequest, actor.userId, startOfToday()),
        },
      };
    }),
  );
}
