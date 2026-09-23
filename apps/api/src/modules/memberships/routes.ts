import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { conflict, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { requireAgencyAdmin } from '../../shared/permissions.js';
import { tenantScoped } from '../../shared/tenant-scope.js';
import { assertCompaniesExist, membershipSelect } from '../users/service.js';
import { revokeAllSessionsForUser } from '../auth/session-service.js';

const listQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  status: z.enum(['active', 'revoked', 'all']).default('active'),
});

const createSchema = z.object({
  userId: z.string().uuid(),
  companyId: z.string().uuid(),
  canManageCampaigns: z.boolean().default(false),
  canDeleteCompanyFiles: z.boolean().default(false),
});

const updateSchema = z.object({
  canManageCampaigns: z.boolean().optional(),
  canDeleteCompanyFiles: z.boolean().optional(),
  status: z.enum(['active', 'revoked']).optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Taking access away signs the person out everywhere, so nothing a screen already
 * loaded - a list, a detail, an upload in flight - outlives it: "a revoked membership
 * immediately removes all access" (06-permissions-and-authorization.md), and a fresh
 * sign-in is the unambiguous way to say so.
 *
 * Giving access does not. The actor's companies and overrides are re-read from these
 * rows on every request (shared/actor.ts), so a grant is in effect on the very next
 * one without it - and signing someone out because they were *given* a client used to
 * kill whatever they were doing, a phone upload included.
 */
async function signOutAfterAccessRemoved(
  tx: Parameters<typeof revokeAllSessionsForUser>[0],
  userId: string,
) {
  await revokeAllSessionsForUser(tx, userId);
}

/** Whether an edit takes anything away: the membership itself, or an override. */
function removesAccess(body: {
  status?: 'active' | 'revoked';
  canManageCampaigns?: boolean;
  canDeleteCompanyFiles?: boolean;
}): boolean {
  return (
    body.status === 'revoked' ||
    body.canManageCampaigns === false ||
    body.canDeleteCompanyFiles === false
  );
}

export async function membershipRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/memberships',
    tenantScoped(async ({ tx, actor, request }) => {
      requireAgencyAdmin(actor);
      const query = parseInput(listQuerySchema, request.query);

      const memberships = await tx.companyMembership.findMany({
        where: {
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.companyId ? { companyId: query.companyId } : {}),
          ...(query.status === 'all' ? {} : { status: query.status }),
        },
        select: {
          ...membershipSelect,
          user: { select: { id: true, name: true, email: true, role: true, status: true } },
          company: { select: { id: true, name: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { data: memberships };
    }),
  );

  app.post(
    '/memberships',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      requireAgencyAdmin(actor);
      const body = parseInput(createSchema, request.body);

      const user = await tx.user.findUnique({ where: { id: body.userId }, select: { id: true } });
      if (!user) {
        throw unprocessable('unknown_user', 'Usuário não encontrado.');
      }
      await assertCompaniesExist(tx, [body.companyId]);

      const existing = await tx.companyMembership.findUnique({
        where: { userId_companyId: { userId: body.userId, companyId: body.companyId } },
        select: { id: true, status: true },
      });

      if (existing?.status === 'active') {
        throw conflict('membership_exists', 'Este usuário já tem acesso a esta empresa.');
      }

      // A previously revoked membership is reactivated rather than duplicated, so the
      // unique (user, company) pair — and its history — stays intact.
      const membership = existing
        ? await tx.companyMembership.update({
            where: { id: existing.id },
            data: {
              status: 'active',
              canManageCampaigns: body.canManageCampaigns,
              canDeleteCompanyFiles: body.canDeleteCompanyFiles,
            },
            select: membershipSelect,
          })
        : await tx.companyMembership.create({
            data: { ...body, createdById: actor.userId },
            select: membershipSelect,
          });

      // A grant takes nothing away, so the person's sessions carry on (see above).
      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: body.companyId,
        action: AuditAction.MembershipGranted,
        entityType: 'company_membership',
        entityId: membership.id,
        ipAddress: clientIp(request),
        metadata: {
          targetUserId: body.userId,
          canManageCampaigns: body.canManageCampaigns,
          canDeleteCompanyFiles: body.canDeleteCompanyFiles,
        },
      });

      reply.code(201);
      return { data: membership };
    }),
  );

  app.patch(
    '/memberships/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      requireAgencyAdmin(actor);
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(updateSchema, request.body);

      const existing = await tx.companyMembership.findUnique({
        where: { id: params.id },
        select: { id: true, userId: true, companyId: true },
      });
      if (!existing) {
        throw notFound('not_found', 'Vínculo não encontrado.');
      }

      const membership = await tx.companyMembership.update({
        where: { id: params.id },
        data: body,
        select: membershipSelect,
      });

      if (removesAccess(body)) {
        await signOutAfterAccessRemoved(tx, existing.userId);
      }
      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: existing.companyId,
        action:
          body.status === 'revoked' ? AuditAction.MembershipRevoked : AuditAction.MembershipUpdated,
        entityType: 'company_membership',
        entityId: membership.id,
        ipAddress: clientIp(request),
        metadata: { targetUserId: existing.userId, changed: Object.keys(body) },
      });

      return { data: membership };
    }),
  );

  app.delete(
    '/memberships/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      requireAgencyAdmin(actor);
      const params = parseInput(idParamsSchema, request.params);

      const existing = await tx.companyMembership.findUnique({
        where: { id: params.id },
        select: { id: true, userId: true, companyId: true },
      });
      if (!existing) {
        throw notFound('not_found', 'Vínculo não encontrado.');
      }

      // Revoked, never deleted: the row is the record that access once existed.
      const membership = await tx.companyMembership.update({
        where: { id: params.id },
        data: { status: 'revoked' },
        select: membershipSelect,
      });

      await signOutAfterAccessRemoved(tx, existing.userId);
      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: existing.companyId,
        action: AuditAction.MembershipRevoked,
        entityType: 'company_membership',
        entityId: membership.id,
        ipAddress: clientIp(request),
        metadata: { targetUserId: existing.userId },
      });

      return { data: membership };
    }),
  );
}
