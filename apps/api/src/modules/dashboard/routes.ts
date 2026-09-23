import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { parseInput } from '../../shared/validation.js';
import { forbidden } from '../../shared/errors.js';
import {
  authorizedCompanyIds,
  canManageProduction,
  requireCompanyAccess,
} from '../../shared/permissions.js';
import { isAgencyAdmin, type AuthenticatedActor } from '../../shared/actor.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';
import { businessDayBounds, businessToday } from '../../shared/business-day.js';
import { OVERDUE_STATUSES } from '../calendar/content.js';
import { AWAITING_RECIPIENT_STATUSES, UNFINISHED_STATUSES } from '../pending-requests/status.js';
import { PENDING_STATUSES } from '../publications/publication.js';
import { CAMPAIGN_ATTENTION_STATUSES, campaignVisibilityScope } from '../campaigns/campaign.js';

/**
 * Read-only aggregation over the modules that own the data
 * (21-mvp-roadmap.md, Stage 12). Nothing here defines what "atrasado" or "pendente"
 * means: those live with their own module and are imported, so a dashboard can never
 * quietly disagree with the screen it summarises.
 */

const productionStatus = z.enum([
  'planned',
  'awaiting_material',
  'in_production',
  'in_review',
  'approved',
  'completed',
  'cancelled',
]);

const filterSchema = z.object({
  companyId: z.string().uuid().optional(),
  responsibleUserId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  productionStatus: productionStatus.optional(),
});

type Filters = z.infer<typeof filterSchema>;

const companyQuerySchema = z.object({ companyId: z.string().uuid() });

/** How many rows a "recent" or "next up" panel shows. */
const PANEL_SIZE = 5;

function requireAgencyDashboard(actor: AuthenticatedActor): void {
  if (!canManageProduction(actor)) {
    throw forbidden('forbidden', 'Este painel é da equipe da agência.');
  }
}

/**
 * The company scope every query on this page shares. An `agency_manager` sees their
 * own companies and nothing else, so the "agency-wide" dashboard is still tenant-bound
 * (06-permissions-and-authorization.md).
 */
function scopeOf(
  filters: Filters,
  companyIds: string[] | null,
): { companyId?: Prisma.StringFilter | string } {
  if (filters.companyId) return { companyId: filters.companyId };
  return companyIds === null ? {} : { companyId: { in: companyIds } };
}

/**
 * Combined with `AND` rather than spread together, because a panel adds its own
 * constraint on the very same columns: spreading would let "em produção" silently
 * overwrite a `productionStatus` filter, and a panel's date range overwrite the
 * period. Both would show a number that quietly ignored what the user asked for.
 */
function contentWhere(filters: Filters, companyIds: string[] | null): Prisma.ContentWhereInput {
  return {
    deletedAt: null,
    AND: [
      scopeOf(filters, companyIds),
      filters.responsibleUserId ? { responsibleUserId: filters.responsibleUserId } : {},
      filters.priority ? { priority: filters.priority } : {},
      filters.productionStatus ? { productionStatus: filters.productionStatus } : {},
      filters.from || filters.to
        ? {
            scheduledAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {},
    ],
  };
}

/** Narrows a base filter with a panel's own constraint, keeping both. */
function and<T>(base: T, extra: T): { AND: [T, T] } {
  return { AND: [base, extra] };
}

function requestWhere(
  filters: Filters,
  companyIds: string[] | null,
): Prisma.PendingRequestWhereInput {
  return {
    AND: [
      scopeOf(filters, companyIds),
      filters.responsibleUserId ? { responsibleUserId: filters.responsibleUserId } : {},
      filters.priority ? { priority: filters.priority } : {},
    ],
  };
}

const fileCard = {
  id: true,
  companyId: true,
  originalName: true,
  status: true,
  uploadedAt: true,
  uploadedById: true,
} as const;

const contentCard = {
  id: true,
  companyId: true,
  title: true,
  type: true,
  scheduledAt: true,
  productionStatus: true,
  priority: true,
  responsibleUserId: true,
} as const;

const requestCard = {
  id: true,
  companyId: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  responsibleUserId: true,
} as const;

async function recentActivity(tx: ScopedDb, companyIds: string[] | null, companyId?: string) {
  return tx.auditLog.findMany({
    where: {
      ...(companyId ? { companyId } : companyIds === null ? {} : { companyId: { in: companyIds } }),
    },
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      companyId: true,
      actorId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: PANEL_SIZE,
  });
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  /**
   * "O que eu preciso fazer agora?" — every panel here is something somebody has to
   * act on, ordered by how soon (03-functional-requirements.md#agency-dashboard).
   */
  app.get(
    '/dashboard/agency',
    tenantScoped(async ({ tx, actor, request }) => {
      requireAgencyDashboard(actor);
      const filters = parseInput(filterSchema, request.query);
      if (filters.companyId) requireCompanyAccess(actor, filters.companyId);

      const companyIds = authorizedCompanyIds(actor);
      const now = new Date();
      const { startOfToday, startOfTomorrow } = businessDayBounds(now);
      // `due_date` is a date column: it is compared with today's date, not an instant.
      const today = businessToday(now);

      const content = contentWhere(filters, companyIds);
      const requests = requestWhere(filters, companyIds);

      const todayWhere = and(content, { scheduledAt: { gte: startOfToday, lt: startOfTomorrow } });
      const overdueWhere = and(content, {
        scheduledAt: { lt: now },
        productionStatus: { in: OVERDUE_STATUSES },
      });
      const requestsOverdueWhere = and(requests, {
        dueDate: { lt: today },
        status: { in: UNFINISHED_STATUSES },
      });

      // Counted in the database and issued together: a dashboard that fetched rows to
      // tally them in memory is exactly what 17-performance-requirements.md rules out.
      // The panels show the first few rows; the tiles count all of them - a tile that
      // read the length of its panel could never say more than five.
      const [
        activeCompanies,
        recentFiles,
        todayContent,
        todayCount,
        overdueContent,
        overdueCount,
        inProductionContent,
        awaitingApproval,
        requestsAwaitingClient,
        requestsOverdue,
        requestsOverdueCount,
        pendingPublications,
        unreadNotifications,
        activity,
        campaignsNeedingAttention,
      ] = await Promise.all([
        tx.company.count({
          where: {
            status: 'active',
            ...(filters.companyId
              ? { id: filters.companyId }
              : companyIds === null
                ? {}
                : { id: { in: companyIds } }),
          },
        }),
        tx.file.findMany({
          where: {
            deletedAt: null,
            ...scopeOf(filters, companyIds),
          },
          select: fileCard,
          orderBy: { uploadedAt: 'desc' },
          take: PANEL_SIZE,
        }),
        tx.content.findMany({
          where: todayWhere,
          select: contentCard,
          orderBy: { scheduledAt: 'asc' },
          take: PANEL_SIZE,
        }),
        tx.content.count({ where: todayWhere }),
        tx.content.findMany({
          where: overdueWhere,
          select: contentCard,
          orderBy: { scheduledAt: 'asc' },
          take: PANEL_SIZE,
        }),
        tx.content.count({ where: overdueWhere }),
        tx.content.count({ where: and(content, { productionStatus: 'in_production' }) }),
        tx.content.count({ where: and(content, { productionStatus: 'in_review' }) }),
        tx.pendingRequest.count({ where: and(requests, { status: 'awaiting_client' }) }),
        tx.pendingRequest.findMany({
          where: requestsOverdueWhere,
          select: requestCard,
          orderBy: { dueDate: 'asc' },
          take: PANEL_SIZE,
        }),
        tx.pendingRequest.count({ where: requestsOverdueWhere }),
        tx.publication.count({
          where: {
            status: { in: PENDING_STATUSES },
            content: { deletedAt: null, ...scopeOf(filters, companyIds) },
          },
        }),
        tx.notification.count({ where: { recipientId: actor.userId, readAt: null } }),
        // The audit log is admin-only to read (06-permissions-and-authorization.md), so
        // a manager's dashboard simply has no activity panel rather than an empty one.
        isAgencyAdmin(actor)
          ? recentActivity(tx, companyIds, filters.companyId)
          : Promise.resolve(null),
        tx.campaign.count({
          where: {
            AND: [
              scopeOf(filters, companyIds),
              { status: { in: CAMPAIGN_ATTENTION_STATUSES } },
              filters.responsibleUserId ? { responsibleUserId: filters.responsibleUserId } : {},
            ],
          },
        }),
      ]);

      return {
        data: {
          activeCompanies,
          recentFiles,
          todayContent,
          overdueContent,
          counts: {
            today: todayCount,
            overdue: overdueCount,
            inProduction: inProductionContent,
            awaitingApproval,
            requestsAwaitingClient,
            requestsOverdue: requestsOverdueCount,
            pendingPublications,
            campaignsNeedingAttention,
            unreadNotifications,
          },
          requestsOverdueItems: requestsOverdue,
          recentActivity: activity,
        },
      };
    }),
  );

  /**
   * The client's view: one company, and only what they are part of. Deliberately fewer
   * panels than the agency one (03-functional-requirements.md#company-dashboard).
   */
  app.get(
    '/dashboard/company',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(companyQuerySchema, request.query);
      requireCompanyAccess(actor, query.companyId);

      const now = new Date();
      const { startOfToday } = businessDayBounds(now);
      const companyScope = { companyId: query.companyId };
      const myRequestsWhere = {
        ...companyScope,
        responsibleUserId: actor.userId,
        status: { in: AWAITING_RECIPIENT_STATUSES },
      };

      const [
        plannedContent,
        inProduction,
        upcomingContent,
        recentFiles,
        openRequests,
        myRequests,
        myRequestsCount,
        activeProjects,
        pendingPublications,
        unreadNotifications,
        campaigns,
      ] = await Promise.all([
        tx.content.count({
          where: { ...companyScope, deletedAt: null, productionStatus: 'planned' },
        }),
        tx.content.count({
          where: { ...companyScope, deletedAt: null, productionStatus: 'in_production' },
        }),
        tx.content.findMany({
          where: {
            ...companyScope,
            deletedAt: null,
            scheduledAt: { gte: startOfToday },
            productionStatus: { notIn: ['cancelled'] },
          },
          select: contentCard,
          orderBy: { scheduledAt: 'asc' },
          take: PANEL_SIZE,
        }),
        tx.file.findMany({
          where: { ...companyScope, deletedAt: null },
          select: fileCard,
          orderBy: { uploadedAt: 'desc' },
          take: PANEL_SIZE,
        }),
        tx.pendingRequest.count({
          where: { ...companyScope, status: { in: UNFINISHED_STATUSES } },
        }),
        tx.pendingRequest.findMany({
          where: myRequestsWhere,
          select: requestCard,
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
          take: PANEL_SIZE,
        }),
        tx.pendingRequest.count({ where: myRequestsWhere }),
        tx.project.count({ where: { ...companyScope, status: 'active' } }),
        tx.publication.count({
          where: {
            status: { in: PENDING_STATUSES },
            content: { deletedAt: null, ...companyScope },
          },
        }),
        tx.notification.count({
          where: { recipientId: actor.userId, readAt: null, companyId: query.companyId },
        }),
        // The client only counts what the agency chose to show them, and a contributor
        // sees no campaigns at all - the same rule the campaign list applies.
        tx.campaign.count({ where: { AND: [companyScope, campaignVisibilityScope(actor)] } }),
      ]);

      return {
        data: {
          companyId: query.companyId,
          counts: {
            plannedContent,
            inProduction,
            openRequests,
            myRequests: myRequestsCount,
            activeProjects,
            pendingPublications,
            unreadNotifications,
            campaigns,
          },
          upcomingContent,
          recentFiles,
          myRequests,
        },
      };
    }),
  );
}
