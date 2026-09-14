import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { notFound } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { requireAgencyAdmin } from '../../shared/permissions.js';
import {
  paginated,
  paginationArgs,
  paginationSchema,
  sortSchema,
} from '../../shared/pagination.js';
import { tenantScoped } from '../../shared/tenant-scope.js';
import { normalizeEmail } from '../auth/auth-service.js';
import {
  assertCompaniesExist,
  assertEmailAvailable,
  assertNotSelfLockout,
  issueTemporaryPassword,
  membershipSelect,
  resetUserPassword,
  userSelect,
} from './service.js';

const roleSchema = z.enum(['agency_admin', 'agency_manager', 'client_manager', 'contributor']);

const listQuerySchema = paginationSchema
  .merge(sortSchema(['name', 'email', 'createdAt', 'lastLoginAt'] as const, 'name', 'asc'))
  .extend({
    role: roleSchema.optional(),
    status: z.enum(['active', 'inactive', 'all']).default('all'),
    companyId: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(120).optional(),
  });

const membershipInputSchema = z.object({
  companyId: z.string().uuid(),
  canManageCampaigns: z.boolean().default(false),
  canDeleteCompanyFiles: z.boolean().default(false),
});

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  role: roleSchema,
  status: z.enum(['active', 'inactive']).default('active'),
  /** Optional: when omitted the system generates one and shows it exactly once. */
  initialPassword: z.string().min(10).max(256).optional(),
  memberships: z.array(membershipInputSchema).max(50).default([]),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(254).optional(),
  role: roleSchema.optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(10).max(256).optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/users',
    tenantScoped(async ({ tx, actor, request }) => {
      requireAgencyAdmin(actor);
      const query = parseInput(listQuerySchema, request.query);

      const where = {
        ...(query.role ? { role: query.role } : {}),
        ...(query.status === 'all' ? {} : { status: query.status }),
        ...(query.companyId
          ? { memberships: { some: { companyId: query.companyId, status: 'active' as const } } }
          : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { email: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        tx.user.findMany({
          where,
          select: { ...userSelect, memberships: { select: membershipSelect } },
          orderBy: { [query.sort]: query.order },
          ...paginationArgs(query),
        }),
        tx.user.count({ where }),
      ]);

      return paginated(rows, total, query);
    }),
  );

  app.get(
    '/users/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      requireAgencyAdmin(actor);
      const params = parseInput(idParamsSchema, request.params);

      const user = await tx.user.findUnique({
        where: { id: params.id },
        select: { ...userSelect, memberships: { select: membershipSelect } },
      });

      if (!user) {
        throw notFound('not_found', 'Usuário não encontrado.');
      }
      return { data: user };
    }),
  );

  app.post(
    '/users',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      requireAgencyAdmin(actor);
      const body = parseInput(createUserSchema, request.body);
      const email = normalizeEmail(body.email);

      await assertEmailAvailable(tx, email);
      await assertCompaniesExist(
        tx,
        body.memberships.map((membership) => membership.companyId),
      );

      const { temporaryPassword, passwordHash } = await issueTemporaryPassword(
        body.initialPassword,
      );

      const user = await tx.user.create({
        data: {
          name: body.name,
          email,
          role: body.role,
          status: body.status,
          passwordHash,
          // Admin-set credentials are always temporary
          // (10-authentication-and-sessions.md#first-access-flow).
          mustChangePassword: true,
          memberships: {
            create: body.memberships.map((membership) => ({
              companyId: membership.companyId,
              canManageCampaigns: membership.canManageCampaigns,
              canDeleteCompanyFiles: membership.canDeleteCompanyFiles,
              createdById: actor.userId,
            })),
          },
        },
        select: { ...userSelect, memberships: { select: membershipSelect } },
      });

      await tx.passwordResetAudit.create({
        data: {
          targetUserId: user.id,
          performedById: actor.userId,
          action: 'temp_password_generated',
        },
      });
      await writeAuditLog(tx, {
        actorId: actor.userId,
        action: AuditAction.UserCreated,
        entityType: 'user',
        entityId: user.id,
        ipAddress: clientIp(request),
        metadata: { role: user.role, companyCount: body.memberships.length },
      });

      // The only moment this value is readable; nothing persists it in plaintext.
      reply.code(201);
      return { data: { ...user, temporaryPassword } };
    }),
  );

  app.patch(
    '/users/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      requireAgencyAdmin(actor);
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(updateUserSchema, request.body);

      const existing = await tx.user.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!existing) {
        throw notFound('not_found', 'Usuário não encontrado.');
      }

      assertNotSelfLockout(actor, params.id, body);

      const email = body.email ? normalizeEmail(body.email) : undefined;
      if (email) {
        await assertEmailAvailable(tx, email, params.id);
      }

      const user = await tx.user.update({
        where: { id: params.id },
        data: { ...body, ...(email ? { email } : {}) },
        select: { ...userSelect, memberships: { select: membershipSelect } },
      });

      // Deactivating an account must take effect now, not whenever its session expires.
      if (body.status === 'inactive') {
        await tx.session.updateMany({
          where: { userId: params.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await writeAuditLog(tx, {
        actorId: actor.userId,
        action: body.status ? AuditAction.UserStatusChanged : AuditAction.UserUpdated,
        entityType: 'user',
        entityId: user.id,
        ipAddress: clientIp(request),
        metadata: { changed: Object.keys(body) },
      });

      return { data: user };
    }),
  );

  app.post(
    '/users/:id/reset-password',
    tenantScoped(async ({ tx, actor, request }) => {
      requireAgencyAdmin(actor);
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(resetPasswordSchema, request.body ?? {});

      const temporaryPassword = await resetUserPassword(tx, actor, params.id, body.newPassword);

      await writeAuditLog(tx, {
        actorId: actor.userId,
        action: AuditAction.UserPasswordReset,
        entityType: 'user',
        entityId: params.id,
        ipAddress: clientIp(request),
      });

      return { data: { temporaryPassword } };
    }),
  );
}
