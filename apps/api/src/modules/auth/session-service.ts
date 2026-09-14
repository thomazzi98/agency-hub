import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient, Session } from '@prisma/client';
import { getEnv } from '../../config/env.js';

type Db = PrismaClient | Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Writing `last_active_at` on literally every request would turn each read into a
 * write; a coarse touch interval keeps the sliding-expiry semantics without it.
 */
const TOUCH_INTERVAL_MS = 60_000;

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreateSessionInput {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export async function createSession(
  db: Db,
  input: CreateSessionInput,
): Promise<{ session: Session; token: string }> {
  const env = getEnv();
  const token = generateSessionToken();
  const now = new Date();

  const session = await db.session.create({
    data: {
      userId: input.userId,
      sessionTokenHash: hashSessionToken(token),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      expiresAt: new Date(now.getTime() + env.SESSION_SLIDING_DAYS * DAY_MS),
      absoluteExpiresAt: new Date(now.getTime() + env.SESSION_ABSOLUTE_DAYS * DAY_MS),
      passwordVerifiedAt: now,
    },
  });

  return { session, token };
}

export function isSessionUsable(session: Session, now = new Date()): boolean {
  return session.revokedAt === null && session.expiresAt > now && session.absoluteExpiresAt > now;
}

export async function findUsableSession(db: Db, token: string): Promise<Session | null> {
  const session = await db.session.findUnique({
    where: { sessionTokenHash: hashSessionToken(token) },
  });

  if (!session || !isSessionUsable(session)) {
    return null;
  }
  return session;
}

/** Slides the expiry forward, never past the hard cap set at login time. */
export async function touchSession(db: Db, session: Session): Promise<Session> {
  const now = new Date();
  if (now.getTime() - session.lastActiveAt.getTime() < TOUCH_INTERVAL_MS) {
    return session;
  }

  const env = getEnv();
  const slid = new Date(now.getTime() + env.SESSION_SLIDING_DAYS * DAY_MS);
  const expiresAt = slid > session.absoluteExpiresAt ? session.absoluteExpiresAt : slid;

  return db.session.update({
    where: { id: session.id },
    data: { lastActiveAt: now, expiresAt },
  });
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessionsForUser(
  db: Db,
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export function isPasswordVerificationFresh(session: Session, now = new Date()): boolean {
  const windowMs = getEnv().REAUTH_WINDOW_MINUTES * 60 * 1000;
  return now.getTime() - session.passwordVerifiedAt.getTime() <= windowMs;
}

export async function markPasswordVerified(db: Db, sessionId: string): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { passwordVerifiedAt: new Date() },
  });
}
