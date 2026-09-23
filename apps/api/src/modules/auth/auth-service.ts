import type { Prisma, PrismaClient } from '@prisma/client';
import { getEnv } from '../../config/env.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { badRequest, tooManyRequests, unauthorized } from '../../shared/errors.js';
import { loadActor, type AuthenticatedActor } from '../../shared/actor.js';
import { withSystemScope } from '../../shared/tenant-scope.js';
import { hashPassword, verifyAgainstDecoy, verifyPassword } from './password.js';
import {
  createSession,
  markPasswordVerified,
  revokeAllSessionsForUser,
} from './session-service.js';

type Db = PrismaClient | Prisma.TransactionClient;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deliberately identical for unknown account, wrong password, and inactive account. */
function invalidCredentials() {
  return unauthorized('invalid_credentials', 'E-mail ou senha inválidos.');
}

/**
 * Records the attempt *before* counting, and counts it among the hour's. Counting first
 * let a burst of simultaneous requests all read the same total, all pass, and only then
 * be recorded - so the per-IP ceiling held against a patient attacker and not against a
 * parallel one. Returns the attempt so a success can be marked as one.
 */
async function reserveIpAttempt(db: Db, email: string, ipAddress: string): Promise<{ id: string }> {
  const env = getEnv();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const attempt = await db.loginAttempt.create({
    data: { email, ipAddress, successful: false },
    select: { id: true },
  });

  const attempts = await db.loginAttempt.count({
    where: { ipAddress, createdAt: { gt: oneHourAgo } },
  });

  if (attempts > env.LOGIN_IP_MAX_ATTEMPTS_PER_HOUR) {
    throw tooManyRequests(
      'rate_limited',
      'Muitas tentativas de login a partir deste endereço. Tente novamente mais tarde.',
    );
  }
  return attempt;
}

function lockoutUntil(consecutiveFailures: number): Date | null {
  const env = getEnv();
  if (consecutiveFailures < env.LOGIN_MAX_FAILED_ATTEMPTS) {
    return null;
  }

  const exponent = Math.min(consecutiveFailures - env.LOGIN_MAX_FAILED_ATTEMPTS, 20);
  const seconds = Math.min(
    env.LOGIN_LOCKOUT_BASE_SECONDS * 2 ** exponent,
    env.LOGIN_LOCKOUT_MAX_SECONDS,
  );
  return new Date(Date.now() + seconds * 1000);
}

export interface LoginInput {
  email: string;
  password: string;
  ipAddress: string;
  userAgent: string | null;
}

export interface LoginResult {
  token: string;
  actor: AuthenticatedActor;
}

/**
 * One more consecutive failure, counted by the database itself. Reading the count,
 * adding one here and writing it back let simultaneous wrong guesses all write the same
 * number, so a parallel burst never reached the lockout. Shared by every place a
 * password is checked for a signed-in account, so none of them is an unlimited oracle.
 */
async function recordPasswordFailure(
  db: Db,
  userId: string,
): Promise<{ failures: number; lockedUntil: Date | null }> {
  const { failedLoginAttempts } = await db.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });

  const lockedUntil = lockoutUntil(failedLoginAttempts);
  if (lockedUntil) {
    await db.user.update({ where: { id: userId }, data: { lockedUntil } });
  }
  return { failures: failedLoginAttempts, lockedUntil };
}

function accountLocked() {
  return tooManyRequests(
    'account_locked',
    'Conta temporariamente bloqueada por excesso de tentativas. Aguarde e tente novamente.',
  );
}

function isLocked<T extends { lockedUntil: Date | null }>(
  user: T,
): user is T & { lockedUntil: Date } {
  return user.lockedUntil !== null && user.lockedUntil > new Date();
}

export async function login(db: PrismaClient, input: LoginInput): Promise<LoginResult> {
  const email = normalizeEmail(input.email);

  const attempt = await reserveIpAttempt(db, email, input.ipAddress);

  const user = await db.user.findUnique({ where: { email } });

  if (!user || user.status !== 'active') {
    await verifyAgainstDecoy(input.password);
    await writeAuditLog(db, {
      action: AuditAction.LoginFailed,
      ipAddress: input.ipAddress,
      metadata: { email, reason: user ? 'inactive_account' : 'unknown_email' },
    });
    throw invalidCredentials();
  }

  if (isLocked(user)) {
    await writeAuditLog(db, {
      actorId: user.id,
      action: AuditAction.LoginBlocked,
      entityType: 'user',
      entityId: user.id,
      ipAddress: input.ipAddress,
      metadata: { lockedUntil: user.lockedUntil.toISOString() },
    });
    throw accountLocked();
  }

  const passwordMatches = await verifyPassword(user.passwordHash, input.password);

  if (!passwordMatches) {
    const { failures, lockedUntil } = await recordPasswordFailure(db, user.id);
    await writeAuditLog(db, {
      actorId: user.id,
      action: lockedUntil ? AuditAction.AccountLocked : AuditAction.LoginFailed,
      entityType: 'user',
      entityId: user.id,
      ipAddress: input.ipAddress,
      metadata: { consecutiveFailures: failures },
    });

    throw invalidCredentials();
  }

  const { token, session } = await createSession(db, {
    userId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await db.loginAttempt.update({ where: { id: attempt.id }, data: { successful: true } });
  await writeAuditLog(db, {
    actorId: user.id,
    action: AuditAction.LoginSucceeded,
    entityType: 'session',
    entityId: session.id,
    ipAddress: input.ipAddress,
  });

  const actor = await withSystemScope(db, (tx) => loadActor(tx, user.id, session.id));
  if (!actor) {
    throw invalidCredentials();
  }

  return { token, actor };
}

export interface ChangePasswordInput {
  actor: AuthenticatedActor;
  currentPassword: string;
  newPassword: string;
  ipAddress: string;
}

export async function changeOwnPassword(db: Db, input: ChangePasswordInput): Promise<void> {
  const env = getEnv();
  const user = await db.user.findUniqueOrThrow({ where: { id: input.actor.userId } });

  // A session is not a licence to guess the password behind it: a stolen cookie could
  // otherwise try passwords here without limit and learn the one that also opens every
  // other account its owner reused it on. Same counter and lockout as sign-in.
  if (isLocked(user)) {
    throw accountLocked();
  }

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    await recordPasswordFailure(db, user.id);
    throw badRequest('invalid_current_password', 'A senha atual está incorreta.');
  }

  if (input.newPassword.length < env.PASSWORD_MIN_LENGTH) {
    throw badRequest(
      'weak_password',
      `A nova senha deve ter pelo menos ${env.PASSWORD_MIN_LENGTH} caracteres.`,
    );
  }

  if (input.newPassword === input.currentPassword) {
    throw badRequest('password_unchanged', 'A nova senha deve ser diferente da senha atual.');
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  // A password change is also the remedy for a suspected compromise, so every other
  // session is dropped; the current one stays so the user is not bounced to login.
  await revokeAllSessionsForUser(db, user.id, input.actor.sessionId);
  await markPasswordVerified(db, input.actor.sessionId);

  await db.passwordResetAudit.create({
    data: { targetUserId: user.id, performedById: user.id, action: 'password_reset' },
  });
  await writeAuditLog(db, {
    actorId: user.id,
    action: AuditAction.PasswordChanged,
    entityType: 'user',
    entityId: user.id,
    ipAddress: input.ipAddress,
  });
}

export async function reauthenticate(
  db: Db,
  actor: AuthenticatedActor,
  password: string,
  ipAddress: string,
): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });

  // Step-up exists for the moment a session may not be its owner's, which is exactly
  // when unlimited guesses must not be on offer (see changeOwnPassword).
  if (isLocked(user)) {
    throw accountLocked();
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    const { failures, lockedUntil } = await recordPasswordFailure(db, user.id);
    await writeAuditLog(db, {
      actorId: user.id,
      action: AuditAction.ReauthenticationFailed,
      entityType: 'user',
      entityId: user.id,
      ipAddress,
      metadata: { consecutiveFailures: failures, locked: lockedUntil !== null },
    });
    throw invalidCredentials();
  }

  if (user.failedLoginAttempts > 0) {
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }
  await markPasswordVerified(db, actor.sessionId);
  await writeAuditLog(db, {
    actorId: user.id,
    action: AuditAction.Reauthenticated,
    entityType: 'session',
    entityId: actor.sessionId,
    ipAddress,
  });
}
