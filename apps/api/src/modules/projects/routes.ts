import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { forbidden, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { notifyProjectChanged } from '../notifications/events.js';
import { clientIp } from '../../shared/request-context.js';
import { authorizedCompanyIds, requireCompanyAccess } from '../../shared/permissions.js';
import {
  paginated,
  paginationArgs,
  paginationSchema,
  sortSchema,
} from '../../shared/pagination.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';
import type { AuthenticatedActor } from '../../shared/actor.js';

const projectSelect = {
  id: true,
  companyId: true,
  name: true,
  code: true,
  type: true,
  description: true,
  status: true,
  startDate: true,
  endDate: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
} as const;

const projectType = z.enum([
  'property',
  'product',
  'service',
  'event',
  'campaign',
  'internal',
  'other',
]);
const projectStatus = z.enum(['planned', 'active', 'paused', 'completed', 'archived']);

const listQuerySchema = paginationSchema
  .merge(sortSchema(['name', 'createdAt', 'startDate'] as const, 'createdAt'))
  .extend({
    companyId: z.string().uuid().optional(),
    status: z.union([projectStatus, z.literal('all')]).default('all'),
    type: projectType.optional(),
    search: z.string().trim().min(1).max(120).optional(),
  });

const createSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().max(40).nullish(),
  type: projectType.default('other'),
  description: z.string().trim().max(5000).nullish(),
  status: projectStatus.default('active'),
  startDate: z.coerce.date().nullish(),
  endDate: z.coerce.date().nullish(),
  notes: z.string().trim().max(5000).nullish(),
});

const updateSchema = createSchema.omit({ companyId: true }).partial();
const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Managing projects is an agency job. `client_manager` appears as "🔶 (rare; default
 * ❌)" in the permission matrix, but the only membership overrides the data model
 * carries are campaigns and file deletion (23-open-questions.md #9), so the default
 * applies and the role is refused.
 */
function requireProjectManagement(actor: AuthenticatedActor): void {
  if (actor.role !== 'agency_admin' && actor.role !== 'agency_manager') {
    throw forbidden('forbidden', 'Você não tem permissão para gerenciar projetos.');
  }
}

async function findProjectInScope(tx: ScopedDb, id: string, companyIds: string[] | null) {
  return tx.project.findFirst({
    where: { id, ...(companyIds === null ? {} : { companyId: { in: companyIds } }) },
    select: projectSelect,
  });
}

function assertDateOrder(startDate?: Date | null, endDate?: Date | null): void {
  if (startDate && endDate && endDate < startDate) {
    throw unprocessable('invalid_date_range', 'A data de término não pode ser anterior ao início.');
  }
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/projects',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      const companyIds = authorizedCompanyIds(actor);

      // A companyId in the query picks *which* authorized company to look at; it is
      // never the scope itself (06-permissions-and-authorization.md, anti-IDOR #4).
      if (query.companyId) {
        requireCompanyAccess(actor, query.companyId);
      }

      const where = {
        ...(query.companyId
          ? { companyId: query.companyId }
          : companyIds === null
            ? {}
            : { companyId: { in: companyIds } }),
        ...(query.status === 'all' ? {} : { status: query.status }),
        ...(query.type ? { type: query.type } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { code: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        tx.project.findMany({
          where,
          select: projectSelect,
          orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
          ...paginationArgs(query),
        }),
        tx.project.count({ where }),
      ]);

      return paginated(rows, total, query);
    }),
  );

  app.get(
    '/projects/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const project = await findProjectInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!project) {
        throw notFound('not_found', 'Projeto não encontrado.');
      }
      return { data: project };
    }),
  );

  app.post(
    '/projects',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      requireProjectManagement(actor);
      const body = parseInput(createSchema, request.body);
      requireCompanyAccess(actor, body.companyId);
      assertDateOrder(body.startDate, body.endDate);

      const project = await tx.project.create({
        data: { ...body, createdById: actor.userId },
        select: projectSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: project.companyId,
        action: AuditAction.ProjectCreated,
        entityType: 'project',
        entityId: project.id,
        ipAddress: clientIp(request),
      });

      reply.code(201);
      return { data: project };
    }),
  );

  app.patch(
    '/projects/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      requireProjectManagement(actor);
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(updateSchema, request.body);

      const existing = await findProjectInScope(tx, params.id, authorizedCompanyIds(actor));
      if (!existing) {
        throw notFound('not_found', 'Projeto não encontrado.');
      }

      assertDateOrder(
        body.startDate === undefined ? existing.startDate : body.startDate,
        body.endDate === undefined ? existing.endDate : body.endDate,
      );

      const project = await tx.project.update({
        where: { id: params.id },
        data: body,
        select: projectSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: project.companyId,
        action: body.status ? AuditAction.ProjectStatusChanged : AuditAction.ProjectUpdated,
        entityType: 'project',
        entityId: project.id,
        ipAddress: clientIp(request),
        metadata: { changed: Object.keys(body) },
      });

      await notifyProjectChanged(tx, {
        companyId: project.companyId,
        actorId: actor.userId,
        projectId: project.id,
        name: project.name,
      });

      return { data: project };
    }),
  );
}
