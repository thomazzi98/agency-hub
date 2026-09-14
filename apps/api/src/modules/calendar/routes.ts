import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, ProductionStatus } from '@prisma/client';
import { parseInput } from '../../shared/validation.js';
import { forbidden, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import {
  authorizedCompanyIds,
  canDeleteOthersFiles,
  canManageProduction,
  requireCompanyAccess,
} from '../../shared/permissions.js';
import { isAgencyAdmin, type AuthenticatedActor } from '../../shared/actor.js';
import {
  paginated,
  paginationArgs,
  paginationSchema,
  sortSchema,
} from '../../shared/pagination.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';
import { assertResponsibleHasAccess } from '../../shared/references.js';
import { notifyContentStatusChanged } from '../notifications/events.js';
import { PENDING_STATUSES, publicationSelect } from '../publications/publication.js';
import { BLOCKED_ON_CLIENT_STATUS, OVERDUE_STATUSES } from './content.js';

const contentType = z.enum([
  'video',
  'image',
  'carousel',
  'story',
  'reels',
  'youtube_short',
  'text',
  'custom',
]);

const productionStatus = z.enum([
  'planned',
  'awaiting_material',
  'in_production',
  'in_review',
  'approved',
  'completed',
  'cancelled',
]);

const priority = z.enum(['low', 'medium', 'high']);

/**
 * A calendar screen asks for a window, not a page, so this endpoint returns every item
 * in the range — which only stays bounded because the range itself is. A year is well
 * past the multi-month planning the spec asks for.
 */
const MAX_CALENDAR_RANGE_DAYS = 400;

/**
 * Every content row carries its network records, because the calendar has to show at a
 * glance which networks are done and which are still owed
 * (03-functional-requirements.md#multi-network-publication-log). Prisma reads them in
 * one extra query for the whole page rather than one per row.
 */
const contentSelect = {
  id: true,
  companyId: true,
  projectId: true,
  title: true,
  description: true,
  type: true,
  scheduledAt: true,
  responsibleUserId: true,
  relatedFileId: true,
  productionStatus: true,
  priority: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  publications: { select: publicationSelect },
} as const;

type ContentRow = {
  scheduledAt: Date;
  productionStatus: ProductionStatus;
} & Record<string, unknown>;

/**
 * The flags the calendar has to show (03-functional-requirements.md#editorial-calendar),
 * derived on the server so every screen agrees on what "overdue" means.
 */
function withFlags(row: ContentRow, now: Date) {
  const scheduled = row.scheduledAt;
  const isToday =
    scheduled.getUTCFullYear() === now.getUTCFullYear() &&
    scheduled.getUTCMonth() === now.getUTCMonth() &&
    scheduled.getUTCDate() === now.getUTCDate();

  return {
    ...row,
    isToday,
    isOverdue: scheduled < now && OVERDUE_STATUSES.includes(row.productionStatus),
    // Waiting on the client to send something is the one blocked state the agency
    // cannot clear on its own.
    isBlockedOnClient: row.productionStatus === BLOCKED_ON_CLIENT_STATUS,
  };
}

const filterSchema = z.object({
  companyId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  responsibleUserId: z.string().uuid().optional(),
  type: contentType.optional(),
  priority: priority.optional(),
  productionStatus: z.union([productionStatus, z.literal('all')]).default('all'),
  search: z.string().trim().min(1).max(200).optional(),
});

const listQuerySchema = paginationSchema
  .merge(sortSchema(['scheduledAt', 'createdAt', 'title'] as const, 'scheduledAt', 'asc'))
  .merge(filterSchema)
  .extend({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** Convenience filters the calendar toolbar offers directly. */
    flag: z.enum(['today', 'overdue', 'blocked']).optional(),
  });

const calendarQuerySchema = filterSchema.extend({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

const createSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).nullish(),
  type: contentType.default('custom'),
  scheduledAt: z.coerce.date(),
  responsibleUserId: z.string().uuid().nullish(),
  relatedFileId: z.string().uuid().nullish(),
  productionStatus: productionStatus.default('planned'),
  priority: priority.default('medium'),
  notes: z.string().trim().max(5000).nullish(),
});

const updateSchema = createSchema.omit({ companyId: true }).partial();
const idParamsSchema = z.object({ id: z.string().uuid() });

const duplicateSchema = z.object({
  /** Where the copy goes; the spec's "duplicate content" is always to a new date. */
  scheduledAt: z.coerce.date(),
});

/** Planning the calendar is agency work (06-permissions-and-authorization.md). */
function requireContentManagement(actor: AuthenticatedActor): void {
  if (!canManageProduction(actor)) {
    throw forbidden('forbidden', 'Você não tem permissão para gerenciar o calendário.');
  }
}

async function findContentInScope(tx: ScopedDb, id: string, companyIds: string[] | null) {
  return tx.content.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(companyIds === null ? {} : { companyId: { in: companyIds } }),
    },
    select: contentSelect,
  });
}

async function assertReferencesAreInCompany(
  tx: ScopedDb,
  companyId: string,
  input: {
    projectId?: string | null;
    relatedFileId?: string | null;
    responsibleUserId?: string | null;
  },
): Promise<void> {
  if (input.projectId) {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, companyId },
      select: { id: true },
    });
    if (!project) throw unprocessable('unknown_project', 'Projeto não encontrado nesta empresa.');
  }

  if (input.relatedFileId) {
    const file = await tx.file.findFirst({
      where: { id: input.relatedFileId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!file) throw unprocessable('unknown_file', 'Arquivo não encontrado nesta empresa.');
  }

  if (input.responsibleUserId) {
    await assertResponsibleHasAccess(tx, companyId, input.responsibleUserId);
  }
}

function companyScope(
  companyId: string | undefined,
  companyIds: string[] | null,
): Prisma.ContentWhereInput {
  if (companyId) return { companyId };
  return companyIds === null ? {} : { companyId: { in: companyIds } };
}

function commonFilters(query: z.infer<typeof filterSchema>): Prisma.ContentWhereInput[] {
  return [
    query.projectId ? { projectId: query.projectId } : {},
    query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {},
    query.type ? { type: query.type } : {},
    query.priority ? { priority: query.priority } : {},
    query.productionStatus === 'all' ? {} : { productionStatus: query.productionStatus },
    query.search ? { title: { contains: query.search, mode: 'insensitive' as const } } : {},
  ];
}

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/content',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      if (query.companyId) requireCompanyAccess(actor, query.companyId);

      const now = new Date();
      const startOfToday = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

      const flagFilter: Prisma.ContentWhereInput =
        query.flag === 'today'
          ? { scheduledAt: { gte: startOfToday, lt: startOfTomorrow } }
          : query.flag === 'overdue'
            ? { scheduledAt: { lt: now }, productionStatus: { in: OVERDUE_STATUSES } }
            : query.flag === 'blocked'
              ? { productionStatus: 'awaiting_material' }
              : {};

      const where: Prisma.ContentWhereInput = {
        deletedAt: null,
        AND: [
          companyScope(query.companyId, authorizedCompanyIds(actor)),
          ...commonFilters(query),
          flagFilter,
          query.from || query.to
            ? {
                scheduledAt: {
                  ...(query.from ? { gte: query.from } : {}),
                  ...(query.to ? { lte: query.to } : {}),
                },
              }
            : {},
        ],
      };

      const [rows, total] = await Promise.all([
        tx.content.findMany({
          where,
          select: contentSelect,
          orderBy: { [query.sort]: query.order },
          ...paginationArgs(query),
        }),
        tx.content.count({ where }),
      ]);

      return paginated(
        rows.map((row) => withFlags(row, now)),
        total,
        query,
      );
    }),
  );

  app.get(
    '/content/calendar',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(calendarQuerySchema, request.query);
      if (query.companyId) requireCompanyAccess(actor, query.companyId);

      if (query.to < query.from) {
        throw unprocessable('invalid_date_range', 'A data final não pode ser anterior à inicial.');
      }

      const days = (query.to.getTime() - query.from.getTime()) / (24 * 60 * 60 * 1000);
      if (days > MAX_CALENDAR_RANGE_DAYS) {
        throw unprocessable(
          'range_too_large',
          'O período solicitado é grande demais. Consulte no máximo um ano por vez.',
        );
      }

      const now = new Date();
      const rows = await tx.content.findMany({
        where: {
          deletedAt: null,
          scheduledAt: { gte: query.from, lte: query.to },
          AND: [
            companyScope(query.companyId, authorizedCompanyIds(actor)),
            ...commonFilters(query),
          ],
        },
        select: contentSelect,
        orderBy: { scheduledAt: 'asc' },
      });

      return { data: rows.map((row) => withFlags(row, now)) };
    }),
  );

  /**
   * The aggregate the dashboards and the production board read. Counted in the database
   * rather than by fetching rows and tallying them in memory
   * (17-performance-requirements.md#query-efficiency).
   */
  app.get(
    '/content/summary',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(
        z.object({ companyId: z.string().uuid().optional() }),
        request.query,
      );
      if (query.companyId) requireCompanyAccess(actor, query.companyId);

      const scope: Prisma.ContentWhereInput = {
        deletedAt: null,
        AND: [companyScope(query.companyId, authorizedCompanyIds(actor))],
      };
      const now = new Date();

      const grouped = await tx.content.groupBy({
        by: ['productionStatus'],
        where: scope,
        _count: { _all: true },
      });

      const byStatus = Object.fromEntries(
        grouped.map((entry) => [entry.productionStatus, entry._count._all]),
      ) as Record<ProductionStatus, number | undefined>;

      const overdue = await tx.content.count({
        where: {
          ...scope,
          scheduledAt: { lt: now },
          productionStatus: { in: OVERDUE_STATUSES },
        },
      });

      // The one aggregate on the spec's list that lives in another table: a network
      // still owed a post (03-functional-requirements.md#production-tracking).
      const pendingPublication = await tx.publication.count({
        where: { content: scope, status: { in: PENDING_STATUSES } },
      });

      const failedPublication = await tx.publication.count({
        where: { content: scope, status: 'failed' },
      });

      return {
        data: {
          planned: byStatus.planned ?? 0,
          awaitingMaterial: byStatus.awaiting_material ?? 0,
          inProduction: byStatus.in_production ?? 0,
          inReview: byStatus.in_review ?? 0,
          approved: byStatus.approved ?? 0,
          completed: byStatus.completed ?? 0,
          cancelled: byStatus.cancelled ?? 0,
          overdue,
          pendingPublication,
          failedPublication,
          total: grouped.reduce((sum, entry) => sum + entry._count._all, 0),
        },
      };
    }),
  );

  app.get(
    '/content/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const content = await findContentInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!content) {
        throw notFound('not_found', 'Conteúdo não encontrado.');
      }
      return { data: withFlags(content, new Date()) };
    }),
  );

  app.post(
    '/content',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      requireContentManagement(actor);
      const body = parseInput(createSchema, request.body);
      requireCompanyAccess(actor, body.companyId);
      await assertReferencesAreInCompany(tx, body.companyId, body);

      const content = await tx.content.create({
        data: {
          companyId: body.companyId,
          projectId: body.projectId ?? null,
          title: body.title,
          description: body.description ?? null,
          type: body.type,
          scheduledAt: body.scheduledAt,
          responsibleUserId: body.responsibleUserId ?? null,
          relatedFileId: body.relatedFileId ?? null,
          productionStatus: body.productionStatus,
          priority: body.priority,
          notes: body.notes ?? null,
          createdById: actor.userId,
        },
        select: contentSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: content.companyId,
        action: AuditAction.ContentCreated,
        entityType: 'content',
        entityId: content.id,
        ipAddress: clientIp(request),
      });

      reply.code(201);
      return { data: withFlags(content, new Date()) };
    }),
  );

  app.patch(
    '/content/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      requireContentManagement(actor);
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(updateSchema, request.body);

      const existing = await findContentInScope(tx, params.id, authorizedCompanyIds(actor));
      if (!existing) {
        throw notFound('not_found', 'Conteúdo não encontrado.');
      }
      await assertReferencesAreInCompany(tx, existing.companyId, body);

      const content = await tx.content.update({
        where: { id: params.id },
        data: body,
        select: contentSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: content.companyId,
        action: body.productionStatus
          ? AuditAction.ContentStatusChanged
          : body.scheduledAt
            ? AuditAction.ContentRescheduled
            : AuditAction.ContentUpdated,
        entityType: 'content',
        entityId: content.id,
        ipAddress: clientIp(request),
        metadata: { changed: Object.keys(body) },
      });

      if (body.productionStatus) {
        await notifyContentStatusChanged(tx, {
          companyId: content.companyId,
          actorId: actor.userId,
          contentId: content.id,
          title: content.title,
          status: body.productionStatus,
          responsibleUserId: content.responsibleUserId,
        });
      }

      return { data: withFlags(content, new Date()) };
    }),
  );

  app.post(
    '/content/:id/duplicate',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      requireContentManagement(actor);
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(duplicateSchema, request.body);

      const source = await findContentInScope(tx, params.id, authorizedCompanyIds(actor));
      if (!source) {
        throw notFound('not_found', 'Conteúdo não encontrado.');
      }

      // A copy starts at the beginning of the pipeline: carrying over "approved" would
      // claim work that has not happened for this new date.
      const content = await tx.content.create({
        data: {
          companyId: source.companyId,
          projectId: source.projectId,
          title: source.title,
          description: source.description,
          type: source.type,
          scheduledAt: body.scheduledAt,
          responsibleUserId: source.responsibleUserId,
          relatedFileId: source.relatedFileId,
          productionStatus: 'planned',
          priority: source.priority,
          notes: source.notes,
          createdById: actor.userId,
        },
        select: contentSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: content.companyId,
        action: AuditAction.ContentDuplicated,
        entityType: 'content',
        entityId: content.id,
        ipAddress: clientIp(request),
        metadata: { sourceId: source.id },
      });

      reply.code(201);
      return { data: withFlags(content, new Date()) };
    }),
  );

  app.delete(
    '/content/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const content = await findContentInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!content) {
        throw notFound('not_found', 'Conteúdo não encontrado.');
      }

      // Same rule as files: your own goes directly, anyone else's goes through review.
      const isOwn = content.createdById === actor.userId;
      const canDeleteDirectly =
        isAgencyAdmin(actor) || isOwn || canDeleteOthersFiles(actor, content.companyId);

      if (!canDeleteDirectly) {
        throw forbidden(
          'deletion_requires_approval',
          'Você não pode excluir conteúdos de outras pessoas. Solicite a exclusão para um administrador aprovar.',
        );
      }

      await tx.content.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: content.companyId,
        action: AuditAction.ContentDeleted,
        entityType: 'content',
        entityId: content.id,
        ipAddress: clientIp(request),
      });

      return { data: { id: content.id } };
    }),
  );
}
