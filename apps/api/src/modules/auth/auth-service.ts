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

async function assertIpWithinRateLimit(db: Db, ipAddress: string): Promise<void> {
  const env = getEnv();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const attempts = await db.loginAttempt.count({
    where: { ipAddress, createdAt: { gt: oneHourAgo } },
  });

  if (attempts >= env.LOGIN_IP_MAX_ATTEMPTS_PER_HOUR) {
    throw tooManyRequests(
      'rate_limited',
      'Muitas tentativas de login a partir deste endereço. Tente novamente mais tarde.',
    );
  }
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

export async function login(db: PrismaClient, input: LoginInput): Promise<LoginResult> {
  const email = normalizeEmail(input.email);

  await assertIpWithinRateLimit(db, input.ipAddress);

  const recordAttempt = (successful: boolean) =>
    db.loginAttempt.create({ data: { email, ipAddress: input.ipAddress, successful } });

  const user = await db.user.findUnique({ where: { email } });

  if (!user || user.status !== 'active') {
    await verifyAgainstDecoy(input.password);
    await recordAttempt(false);
    await writeAuditLog(db, {
      action: AuditAction.LoginFailed,
      ipAddress: input.ipAddress,
      metadata: { email, reason: user ? 'inactive_account' : 'unknown_email' },
    });
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordAttempt(false);
    await writeAuditLog(db, {
      actorId: user.id,
      action: AuditAction.LoginBlocked,
      entityType: 'user',
      entityId: user.id,
      ipAddress: input.ipAddress,
      metadata: { lockedUntil: user.lockedUntil.toISOString() },
    });
    throw tooManyRequests(
      'account_locked',
      'Conta temporariamente bloqueada por excesso de tentativas. Aguarde e tente novamente.',
    );
  }

  const passwordMatches = await verifyPassword(user.passwordHash, input.password);

  if (!passwordMatches) {
    const failures = user.failedLoginAttempts + 1;
    const lockedUntil = lockoutUntil(failures);

    await db.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: failures, lockedUntil },
    });
    await recordAttempt(false);
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
  await recordAttempt(true);
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

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
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

  if (!(await verifyPassword(user.passwordHash, password))) {
    await writeAuditLog(db, {
      actorId: user.id,
      action: AuditAction.ReauthenticationFailed,
      entityType: 'user',
      entityId: user.id,
      ipAddress,
    });
    throw invalidCredentials();
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
