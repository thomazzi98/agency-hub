import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { conflict, notFound } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { notifyDeletionRequested, notifyDeletionReviewed } from '../notifications/events.js';
import { clientIp } from '../../shared/request-context.js';
import {
  authorizedCompanyIds,
  requireAgencyAdmin,
  requireCompanyAccess,
} from '../../shared/permissions.js';
import { paginated, paginationArgs, paginationSchema } from '../../shared/pagination.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';

const targetType = z.enum(['file', 'content']);

const listQuerySchema = paginationSchema.extend({
  companyId: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
});

const createSchema = z.object({
  targetType,
  targetId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000),
});

const reviewSchema = z.object({
  reviewNotes: z.string().trim().max(1000).nullish(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

const requestSelect = {
  id: true,
  companyId: true,
  targetType: true,
  targetId: true,
  requestedById: true,
  reason: true,
  status: true,
  reviewedById: true,
  reviewedAt: true,
  reviewNotes: true,
  createdAt: true,
} as const;

/**
 * What a reviewer has to see before approving an irreversible-looking act: which file or
 * content, in which company, asked for by whom. Without it the queue offered "Arquivo"
 * and a reason, and an admin approved deletions blind.
 */
const listSelect = {
  ...requestSelect,
  company: { select: { name: true } },
  requestedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
} as const;

type ListedRequest = { targetType: 'file' | 'content'; targetId: string } & Record<string, unknown>;

/**
 * The target is polymorphic, so it is resolved in one query per type for the whole
 * page rather than one per row. A target already gone - its uploader removed it while
 * the request waited - is reported as such instead of as a blank.
 */
async function withTargets<T extends ListedRequest>(tx: ScopedDb, rows: T[]) {
  const idsOf = (type: 'file' | 'content') =>
    rows.filter((row) => row.targetType === type).map((row) => row.targetId);

  const [files, contents] = await Promise.all([
    tx.file.findMany({
      where: { id: { in: idsOf('file') } },
      select: { id: true, originalName: true, deletedAt: true },
    }),
    tx.content.findMany({
      where: { id: { in: idsOf('content') } },
      select: { id: true, title: true, deletedAt: true },
    }),
  ]);

  const labels = new Map<string, { label: string; removed: boolean }>();
  for (const file of files) {
    labels.set(file.id, { label: file.originalName, removed: file.deletedAt !== null });
  }
  for (const content of contents) {
    labels.set(content.id, { label: content.title, removed: content.deletedAt !== null });
  }

  return rows.map((row) => {
    const target = labels.get(row.targetId);
    return {
      ...row,
      targetLabel: target?.label ?? null,
      targetRemoved: target?.removed ?? true,
    };
  });
}

/**
 * Resolves the target and, with it, the company the request belongs to. The company is
 * never taken from the payload: it comes from the row being pointed at, inside the
 * actor's own scope, so a request cannot be filed against another tenant's file.
 */
async function resolveTarget(
  tx: ScopedDb,
  type: 'file' | 'content',
  targetId: string,
  companyIds: string[] | null,
): Promise<{ companyId: string; label: string }> {
  if (type === 'file') {
    const file = await tx.file.findFirst({
      where: {
        id: targetId,
        deletedAt: null,
        ...(companyIds === null ? {} : { companyId: { in: companyIds } }),
      },
      select: { companyId: true, originalName: true },
    });
    if (!file) throw notFound('not_found', 'Arquivo não encontrado.');
    return { companyId: file.companyId, label: file.originalName };
  }

  const content = await tx.content.findFirst({
    where: {
      id: targetId,
      deletedAt: null,
      ...(companyIds === null ? {} : { companyId: { in: companyIds } }),
    },
    select: { companyId: true, title: true },
  });
  if (!content) throw notFound('not_found', 'Conteúdo não encontrado.');
  return { companyId: content.companyId, label: content.title };
}

export async function deletionRequestRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/deletion-requests',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      const companyIds = authorizedCompanyIds(actor);
      // The requested company picks among the actor's own, never widens them
      // (06-permissions-and-authorization.md#preventing-access-by-manipulating-ids-or-urls-anti-idor).
      if (query.companyId) requireCompanyAccess(actor, query.companyId);

      const where = {
        ...(query.companyId
          ? { companyId: query.companyId }
          : companyIds === null
            ? {}
            : { companyId: { in: companyIds } }),
        ...(query.status === 'all' ? {} : { status: query.status }),
      };

      const [rows, total] = await Promise.all([
        tx.deletionRequest.findMany({
          where,
          select: listSelect,
          // The id breaks ties, so paging never shows a row twice or skips one.
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...paginationArgs(query),
        }),
        tx.deletionRequest.count({ where }),
      ]);

      return paginated(await withTargets(tx, rows), total, query);
    }),
  );

  app.post(
    '/deletion-requests',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      const body = parseInput(createSchema, request.body);
      const target = await resolveTarget(
        tx,
        body.targetType,
        body.targetId,
        authorizedCompanyIds(actor),
      );

      const existing = await tx.deletionRequest.findFirst({
        where: { targetType: body.targetType, targetId: body.targetId, status: 'pending' },
        select: { id: true },
      });
      if (existing) {
        throw conflict(
          'deletion_request_pending',
          'Já existe uma solicitação de exclusão pendente para este item.',
        );
      }

      const created = await tx.deletionRequest.create({
        data: {
          companyId: target.companyId,
          targetType: body.targetType,
          targetId: body.targetId,
          requestedById: actor.userId,
          reason: body.reason,
        },
        select: requestSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: target.companyId,
        action: AuditAction.DeletionRequested,
        entityType: 'deletion_request',
        entityId: created.id,
        ipAddress: clientIp(request),
        metadata: { targetType: body.targetType, targetId: body.targetId, label: target.label },
      });

      await notifyDeletionRequested(tx, {
        companyId: target.companyId,
        actorId: actor.userId,
        requestId: created.id,
        targetType: body.targetType,
      });

      reply.code(201);
      return { data: created };
    }),
  );

  for (const [path, decision] of [
    ['/deletion-requests/:id/approve', 'approved'],
    ['/deletion-requests/:id/reject', 'rejected'],
  ] as const) {
    app.post(
      path,
      tenantScoped(async ({ tx, actor, request }) => {
        // Only an agency_admin reviews. `can_delete_company_files` grants *direct*
        // deletion, never review authority over someone else's request
        // (06-permissions-and-authorization.md#deletion-request-workflow).
        requireAgencyAdmin(actor);
        const params = parseInput(idParamsSchema, request.params);
        const body = parseInput(reviewSchema, request.body ?? {});

        const existing = await tx.deletionRequest.findFirst({
          where: { id: params.id },
          select: requestSelect,
        });
        if (!existing) {
          throw notFound('not_found', 'Solicitação não encontrada.');
        }
        if (existing.status !== 'pending') {
          throw conflict('already_reviewed', 'Esta solicitação já foi analisada.');
        }

        // Claimed with the status in the WHERE, not decided from the read above: two
        // admins pressing at once would otherwise both pass that check, the second
        // overwriting the first's decision and notifying the requester twice. The row
        // lock makes the second wait, re-check, and find it no longer pending.
        const claimed = await tx.deletionRequest.updateMany({
          where: { id: params.id, status: 'pending' },
          data: {
            status: decision,
            reviewedById: actor.userId,
            reviewedAt: new Date(),
            reviewNotes: body.reviewNotes ?? null,
          },
        });
        if (claimed.count === 0) {
          throw conflict('already_reviewed', 'Esta solicitação já foi analisada.');
        }

        const reviewed = await tx.deletionRequest.findFirstOrThrow({
          where: { id: params.id },
          select: requestSelect,
        });

        if (decision === 'approved') {
          // Soft delete, so an erroneous approval stays recoverable.
          const data = { deletedAt: new Date() };
          const where = { id: existing.targetId, deletedAt: null };

          if (existing.targetType === 'file') {
            await tx.file.updateMany({ where, data });
          } else {
            await tx.content.updateMany({ where, data });
          }
        }

        await writeAuditLog(tx, {
          actorId: actor.userId,
          companyId: existing.companyId,
          action:
            decision === 'approved' ? AuditAction.DeletionApproved : AuditAction.DeletionRejected,
          entityType: 'deletion_request',
          entityId: existing.id,
          ipAddress: clientIp(request),
          metadata: {
            targetType: existing.targetType,
            targetId: existing.targetId,
            reviewNotes: body.reviewNotes ?? null,
          },
        });

        await notifyDeletionReviewed(tx, {
          companyId: existing.companyId,
          actorId: actor.userId,
          requestId: existing.id,
          requestedById: existing.requestedById,
          approved: decision === 'approved',
        });

        return { data: reviewed };
      }),
    );
  }
}
