import type { UserRole } from '@prisma/client';
import { conflict, forbidden, unprocessable } from '../../shared/errors.js';
import type { ScopedDb } from '../../shared/tenant-scope.js';
import type { AuthenticatedActor } from '../../shared/actor.js';
import { generateTemporaryPassword, hashPassword } from '../auth/password.js';
import { revokeAllSessionsForUser } from '../auth/session-service.js';

export const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const membershipSelect = {
  id: true,
  userId: true,
  companyId: true,
  status: true,
  canManageCampaigns: true,
  canDeleteCompanyFiles: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function assertEmailAvailable(
  tx: ScopedDb,
  email: string,
  exceptUserId?: string,
): Promise<void> {
  const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (existing && existing.id !== exceptUserId) {
    throw conflict('email_taken', 'Já existe um usuário com este e-mail.');
  }
}

/**
 * An admin editing their own role or deactivating themselves is how an installation
 * ends up with no reachable administrator; the change is refused rather than warned
 * about, because there is no recovery path through the product afterwards.
 */
export function assertNotSelfLockout(
  actor: AuthenticatedActor,
  targetUserId: string,
  changes: { role?: UserRole; status?: string },
): void {
  if (actor.userId !== targetUserId) return;

  if (changes.role && changes.role !== actor.role) {
    throw unprocessable('cannot_change_own_role', 'Você não pode alterar o seu próprio perfil.');
  }
  if (changes.status && changes.status !== 'active') {
    throw unprocessable('cannot_deactivate_self', 'Você não pode desativar a sua própria conta.');
  }
}

export async function assertCompaniesExist(tx: ScopedDb, companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return;

  const found = await tx.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true },
  });

  if (found.length !== new Set(companyIds).size) {
    throw unprocessable('unknown_company', 'Uma das empresas informadas não existe.');
  }
}

export interface IssuedPassword {
  temporaryPassword: string;
  passwordHash: string;
}

/** The plaintext is returned to the caller for its single display and never stored. */
export async function issueTemporaryPassword(explicit?: string): Promise<IssuedPassword> {
  const temporaryPassword = explicit?.trim() || generateTemporaryPassword();
  return { temporaryPassword, passwordHash: await hashPassword(temporaryPassword) };
}

export async function resetUserPassword(
  tx: ScopedDb,
  actor: AuthenticatedActor,
  targetUserId: string,
  explicitPassword?: string,
): Promise<string> {
  const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!target) {
    throw forbidden('not_found', 'Usuário não encontrado.');
  }

  const { temporaryPassword, passwordHash } = await issueTemporaryPassword(explicitPassword);

  await tx.user.update({
    where: { id: targetUserId },
    data: {
      passwordHash,
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  // A reset exists to take an account back from whoever might hold it; leaving their
  // existing sessions alive would defeat the point.
  await revokeAllSessionsForUser(tx, targetUserId);

  await tx.passwordResetAudit.create({
    data: {
      targetUserId,
      performedById: actor.userId,
      action: 'temp_password_generated',
    },
  });

  return temporaryPassword;
}
