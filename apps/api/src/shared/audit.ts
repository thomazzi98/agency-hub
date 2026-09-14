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

  CompanyCreated: 'company.created',
  CompanyUpdated: 'company.updated',
  CompanyArchived: 'company.archived',
  CompanyRestored: 'company.restored',

  UserCreated: 'user.created',
  UserUpdated: 'user.updated',
  UserStatusChanged: 'user.status_changed',
  UserPasswordReset: 'user.password_reset',

  MembershipGranted: 'membership.granted',
  MembershipUpdated: 'membership.updated',
  MembershipRevoked: 'membership.revoked',

  BrandingUpdated: 'branding.updated',

  ProjectCreated: 'project.created',
  ProjectUpdated: 'project.updated',
  ProjectStatusChanged: 'project.status_changed',

  FolderCreated: 'folder.created',
  FolderUpdated: 'folder.updated',
  FolderDeleted: 'folder.deleted',

  UploadStarted: 'upload.started',
  UploadCompleted: 'upload.completed',
  UploadAborted: 'upload.aborted',
  UploadExpired: 'upload.expired',

  FileStatusChanged: 'file.status_changed',
  FileDeleted: 'file.deleted',
  FileDownloaded: 'file.downloaded',

  ContentCreated: 'content.created',
  ContentUpdated: 'content.updated',
  ContentStatusChanged: 'content.status_changed',
  ContentRescheduled: 'content.rescheduled',
  ContentDuplicated: 'content.duplicated',
  ContentDeleted: 'content.deleted',

  CommentCreated: 'comment.created',
  CommentUpdated: 'comment.updated',
  CommentDeleted: 'comment.deleted',

  TopicCreated: 'topic.created',
  TopicUpdated: 'topic.updated',
  TopicStatusChanged: 'topic.status_changed',
  TopicReplied: 'topic.replied',

  DeletionRequested: 'deletion_request.created',
  DeletionApproved: 'deletion_request.approved',
  DeletionRejected: 'deletion_request.rejected',

  CrossTenantAccessDenied: 'security.cross_tenant_access_denied',
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

/**
 * A plain INSERT rather than `prisma.auditLog.create`, which appends `RETURNING *`:
 * under the append-only RLS policy the new row need not be readable by the writer
 * (a platform-level event has no company), and RETURNING would fail the SELECT check.
 */
export async function writeAuditLog(db: Db, entry: AuditEntry): Promise<void> {
  const metadata = entry.metadata === undefined ? null : JSON.stringify(entry.metadata);

  await db.$executeRaw`
    INSERT INTO audit_logs (actor_id, company_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
      ${entry.actorId ?? null}::uuid,
      ${entry.companyId ?? null}::uuid,
      ${entry.action},
      ${entry.entityType ?? null},
      ${entry.entityId ?? null}::uuid,
      ${metadata}::jsonb,
      ${entry.ipAddress ?? null}
    )
  `;
}
