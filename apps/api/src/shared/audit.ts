import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Stable action identifiers for `audit_logs` (16-security-requirements.md). */
export const AuditAction = {
  LoginSucceeded: 'auth.login_succeeded',
  LoginFailed: 'auth.login_failed',
  LoginBlocked: 'auth.login_blocked',
  AccountLocked: 'auth.account_locked',
  Logout: 'auth.logout',
  PasswordChanged: 'auth.password_changed',
  Reauthenticated: 'auth.reauthenticated',
  ReauthenticationFailed: 'auth.reauthentication_failed',
  SessionRevoked: 'auth.session_revoked',
  AllSessionsRevoked: 'auth.all_sessions_revoked',
} as const;

export interface AuditEntry {
  actorId?: string | null;
  companyId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

export async function writeAuditLog(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      companyId: entry.companyId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
