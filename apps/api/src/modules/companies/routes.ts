import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { notFound } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { authorizedCompanyIds, requireAgencyAdmin } from '../../shared/permissions.js';
import {
  paginated,
  paginationArgs,
  paginationSchema,
  sortSchema,
} from '../../shared/pagination.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';

const companySelect = {
  id: true,
  name: true,
  logoUrl: true,
  segment: true,
  responsibleName: true,
  email: true,
  phone: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

const listQuerySchema = paginationSchema
  .merge(sortSchema(['name', 'createdAt', 'updatedAt'] as const, 'name', 'asc'))
  .extend({
    status: z.enum(['active', 'archived', 'all']).default('active'),
    search: z.string().trim().min(1).max(120).optional(),
  });

const companyBodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  segment: z.string().trim().max(120).nullish(),
  responsibleName: z.string().trim().max(160).nullish(),
  email: z.string().trim().email().max(254).nullish(),
  phone: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(5000).nullish(),
  logoUrl: z.string().trim().url().max(2000).nullish(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Loads one company inside the actor's scope. The scope is part of the query, not a
 * check performed after the row is loaded — a mismatched id simply finds nothing,
 * which cannot be forgotten the way a follow-up `if` can.
 */
async function findCompanyInScope(tx: ScopedDb, id: string, companyIds: string[] | null) {
  return tx.company.findFirst({
    // `AND`, not a spread: for this table the scope column *is* `id`, so spreading
    // would overwrite the requested id with the scope filter and silently return
    // whichever company the actor happens to have access to.
    where: { AND: [{ id }, ...(companyIds === null ? [] : [{ id: { in: companyIds } }])] },
    select: companySelect,
  });
}

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/companies',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      const companyIds = authorizedCompanyIds(actor);

      const where = {
        ...(companyIds === null ? {} : { id: { in: companyIds } }),
        ...(query.status === 'all' ? {} : { status: query.status }),
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
      };

      const [rows, total] = await Promise.all([
        tx.company.findMany({
          where,
          select: companySelect,
          orderBy: { [query.sort]: query.order },
          ...paginationArgs(query),
        }),
        tx.company.count({ where }),
      ]);

      return paginated(rows, total, query);
    }),
  );

  app.get(
    '/companies/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const company = await findCompanyInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!company) {
        throw notFound('not_found', 'Empresa não encontrada.');
      }
      return { data: company };
    }),
  );

  /**
   * Who can be assigned work in this company. Deliberately not the admin-only user
   * directory: this is company-scoped data any member legitimately needs — to name a
   * responsible party on a topic, for instance — and it exposes nothing about users
   * outside the company.
   */
  app.get(
    '/companies/:id/members',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const company = await findCompanyInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!company) {
        throw notFound('not_found', 'Empresa não encontrada.');
      }

      const memberships = await tx.companyMembership.findMany({
        where: { companyId: params.id, status: 'active', user: { status: 'active' } },
        select: {
          canManageCampaigns: true,
          canDeleteCompanyFiles: true,
          user: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { user: { name: 'asc' } },
      });

      return {
        data: memberships.map((membership) => ({
          ...membership.user,
          canManageCampaigns: membership.canManageCampaigns,
          canDeleteCompanyFiles: membership.canDeleteCompanyFiles,
        })),
      };
    }),
  );

  app.post(
    '/companies',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      requireAgencyAdmin(actor);
      const body = parseInput(companyBodySchema, request.body);

      const company = await tx.company.create({
        data: { ...body, createdById: actor.userId },
        select: companySelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: company.id,
        action: AuditAction.CompanyCreated,
        entityType: 'company',
        entityId: company.id,
        ipAddress: clientIp(request),
      });

      reply.code(201);
      return { data: company };
    }),
  );

  app.patch(
    '/companies/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      requireAgencyAdmin(actor);
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(companyBodySchema.partial(), request.body);

      const existing = await findCompanyInScope(tx, params.id, authorizedCompanyIds(actor));
      if (!existing) {
        throw notFound('not_found', 'Empresa não encontrada.');
      }

      const company = await tx.company.update({
        where: { id: params.id },
        data: body,
        select: companySelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: company.id,
        action: AuditAction.CompanyUpdated,
        entityType: 'company',
        entityId: company.id,
        ipAddress: clientIp(request),
        metadata: { changed: Object.keys(body) },
      });

      return { data: company };
    }),
  );

  // Archiving hides a company from active lists and never deletes anything
  // (03-functional-requirements.md#companies).
  for (const [path, nextStatus, action] of [
    ['/companies/:id/archive', 'archived', AuditAction.CompanyArchived],
    ['/companies/:id/restore', 'active', AuditAction.CompanyRestored],
  ] as const) {
    app.post(
      path,
      tenantScoped(async ({ tx, actor, request }) => {
        requireAgencyAdmin(actor);
        const params = parseInput(idParamsSchema, request.params);

        const existing = await findCompanyInScope(tx, params.id, authorizedCompanyIds(actor));
        if (!existing) {
          throw notFound('not_found', 'Empresa não encontrada.');
        }

        const company = await tx.company.update({
          where: { id: params.id },
          data: { status: nextStatus },
          select: companySelect,
        });

        await writeAuditLog(tx, {
          actorId: actor.userId,
          companyId: company.id,
          action,
          entityType: 'company',
          entityId: company.id,
          ipAddress: clientIp(request),
        });

        return { data: company };
      }),
    );
  }
}
