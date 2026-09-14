import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TEST_PASSWORD,
  authed,
  buildTestApp,
  createTestUser,
  loginAs,
  uniqueIp,
  withIp,
} from '../helpers/app.js';
import { closeTestPrisma, resetDatabase, testPrisma } from '../helpers/prisma.js';

const prisma = testPrisma();
let app: FastifyInstance;

beforeAll(async () => {
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeTestPrisma();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('POST /api/auth/login', () => {
  it('issues an httpOnly, SameSite=Lax session cookie', async () => {
    const user = await createTestUser({ email: 'login@example.com' });

    const response = await app.inject(
      withIp(
        {
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'login@example.com', password: DEFAULT_TEST_PASSWORD },
        },
        uniqueIp(),
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ id: user.id, email: 'login@example.com' });

    const cookie = response.cookies.find((c) => c.name === 'agency_hub_session');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/');
  });

  it('stores only a hash of the session token', async () => {
    await createTestUser({ email: 'hashed@example.com' });

    const cookie = await loginAs(app, 'hashed@example.com');
    const rawToken = cookie.split('=')[1] ?? '';

    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionTokenHash).not.toBe(rawToken);
    expect(sessions[0]?.sessionTokenHash).toHaveLength(64);
  });

  it('is case-insensitive on the email', async () => {
    await createTestUser({ email: 'case@example.com' });

    const response = await app.inject(
      withIp(
        {
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: '  CASE@Example.COM ', password: DEFAULT_TEST_PASSWORD },
        },
        uniqueIp(),
      ),
    );

    expect(response.statusCode).toBe(200);
  });

  it('returns an identical response for a wrong password and an unknown email', async () => {
    await createTestUser({ email: 'known@example.com' });

    const wrongPassword = await app.inject(
      withIp(
        {
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'known@example.com', password: 'senha-errada-123' },
        },
        uniqueIp(),
      ),
    );
    const unknownEmail = await app.inject(
      withIp(
        {
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'nobody@example.com', password: 'senha-errada-123' },
        },
        uniqueIp(),
      ),
    );

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
    expect(wrongPassword.json().error.code).toBe('invalid_credentials');
  });

  it('rejects an inactive account without revealing that it exists', async () => {
    await createTestUser({ email: 'inactive@example.com', status: 'inactive' });

    const response = await app.inject(
      withIp(
        {
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'inactive@example.com', password: DEFAULT_TEST_PASSWORD },
        },
        uniqueIp(),
      ),
    );

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_credentials');
  });

  it('locks the account after the configured number of consecutive failures', async () => {
    await createTestUser({ email: 'lockme@example.com' });
    const ip = uniqueIp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject(
        withIp(
          {
            method: 'POST',
            url: '/api/auth/login',
            payload: { email: 'lockme@example.com', password: 'senha-errada-123' },
          },
          ip,
        ),
      );
      expect(response.statusCode).toBe(401);
    }

    const locked = await app.inject(
      withIp(
        {
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'lockme@example.com', password: DEFAULT_TEST_PASSWORD },
        },
        ip,
      ),
    );

    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('account_locked');

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'lockme@example.com' } });
    expect(stored.failedLoginAttempts).toBe(5);
    expect(stored.lockedUntil).not.toBeNull();
  });

  it('clears the failure counter after a successful login', async () => {
    await createTestUser({ email: 'recover@example.com' });
    const ip = uniqueIp();

    await app.inject(
      withIp(
        {
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'recover@example.com', password: 'senha-errada-123' },
        },
        ip,
      ),
    );
    await loginAs(app, 'recover@example.com', DEFAULT_TEST_PASSWORD, { ip });

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'recover@example.com' } });
    expect(stored.failedLoginAttempts).toBe(0);
    expect(stored.lastLoginAt).not.toBeNull();
  });

  it('rate-limits repeated attempts from the same IP regardless of the account', async () => {
    await createTestUser({ email: 'ratelimit@example.com' });
    const ip = uniqueIp();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await app.inject(
        withIp(
          {
            method: 'POST',
            url: '/api/auth/login',
            payload: { email: `nobody-${attempt}@example.com`, password: 'x' },
          },
          ip,
        ),
      );
    }

    const blocked = await app.inject(
      withIp(
        {
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'ratelimit@example.com', password: DEFAULT_TEST_PASSWORD },
        },
        ip,
      ),
    );

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limited');
  });

  it('records every attempt in the audit log', async () => {
    await createTestUser({ email: 'audited@example.com' });

    await loginAs(app, 'audited@example.com');
    await app.inject(
      withIp(
        {
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'audited@example.com', password: 'senha-errada-123' },
        },
        uniqueIp(),
      ),
    );

    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map(
      (entry) => entry.action,
    );
    expect(actions).toContain('auth.login_succeeded');
    expect(actions).toContain('auth.login_failed');
  });
});

describe('session lifecycle', () => {
  it('rejects a request with no session cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthenticated');
  });

  it('rejects a revoked session on the very next request', async () => {
    await createTestUser({ email: 'revoked@example.com' });
    const cookie = await loginAs(app, 'revoked@example.com');

    const before = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, cookie));
    expect(before.statusCode).toBe(200);

    await prisma.session.updateMany({ data: { revokedAt: new Date() } });

    const after = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, cookie));
    expect(after.statusCode).toBe(401);
  });

  it('rejects an expired session', async () => {
    await createTestUser({ email: 'expired@example.com' });
    const cookie = await loginAs(app, 'expired@example.com');

    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, cookie));
    expect(response.statusCode).toBe(401);
  });

  it('never lets activity push expiry past the absolute cap', async () => {
    await createTestUser({ email: 'cap@example.com' });
    const cookie = await loginAs(app, 'cap@example.com');

    const cap = new Date(Date.now() + 60_000);
    await prisma.session.updateMany({
      data: { absoluteExpiresAt: cap, lastActiveAt: new Date(Date.now() - 10 * 60_000) },
    });

    await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, cookie));

    const session = await prisma.session.findFirstOrThrow();
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(cap.getTime());
  });

  it('logs out by revoking the session and clearing the cookie', async () => {
    await createTestUser({ email: 'logout@example.com' });
    const cookie = await loginAs(app, 'logout@example.com');

    const response = await app.inject(authed({ method: 'POST', url: '/api/auth/logout' }, cookie));
    expect(response.statusCode).toBe(204);

    const session = await prisma.session.findFirstOrThrow();
    expect(session.revokedAt).not.toBeNull();

    const after = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, cookie));
    expect(after.statusCode).toBe(401);
  });
});

describe('forced password change', () => {
  it('blocks every other route until the password is changed', async () => {
    await createTestUser({ email: 'forced@example.com', mustChangePassword: true });
    const cookie = await loginAs(app, 'forced@example.com');

    const blocked = await app.inject(authed({ method: 'GET', url: '/api/sessions' }, cookie));
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('password_change_required');

    const allowed = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, cookie));
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data.mustChangePassword).toBe(true);
  });

  it('grants full access once the password is changed', async () => {
    await createTestUser({ email: 'change@example.com', mustChangePassword: true });
    const cookie = await loginAs(app, 'change@example.com');

    const changed = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/auth/change-password',
          payload: { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: 'nova-senha-forte-1' },
        },
        cookie,
      ),
    );
    expect(changed.statusCode).toBe(204);

    const allowed = await app.inject(authed({ method: 'GET', url: '/api/sessions' }, cookie));
    expect(allowed.statusCode).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'change@example.com' } });
    expect(stored.mustChangePassword).toBe(false);
  });

  it('records a password_reset_audits row for a self-service change', async () => {
    const user = await createTestUser({ email: 'audit-pw@example.com' });
    const cookie = await loginAs(app, 'audit-pw@example.com');

    await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/auth/change-password',
          payload: { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: 'nova-senha-forte-1' },
        },
        cookie,
      ),
    );

    const audits = await prisma.passwordResetAudit.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      targetUserId: user.id,
      performedById: user.id,
      action: 'password_reset',
    });
  });
});

describe('POST /api/auth/change-password', () => {
  it('rejects a wrong current password', async () => {
    await createTestUser({ email: 'wrongcurrent@example.com' });
    const cookie = await loginAs(app, 'wrongcurrent@example.com');

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/auth/change-password',
          payload: { currentPassword: 'nao-e-essa-123', newPassword: 'nova-senha-forte-1' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_current_password');
  });

  it('rejects a password shorter than the configured minimum', async () => {
    await createTestUser({ email: 'weak@example.com' });
    const cookie = await loginAs(app, 'weak@example.com');

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/auth/change-password',
          payload: { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: 'curta' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('weak_password');
  });

  it('revokes every other session but keeps the current one', async () => {
    await createTestUser({ email: 'multi@example.com' });
    const firstCookie = await loginAs(app, 'multi@example.com');
    const secondCookie = await loginAs(app, 'multi@example.com');

    await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/auth/change-password',
          payload: { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: 'nova-senha-forte-1' },
        },
        secondCookie,
      ),
    );

    const stillValid = await app.inject(
      authed({ method: 'GET', url: '/api/auth/me' }, secondCookie),
    );
    const revoked = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, firstCookie));

    expect(stillValid.statusCode).toBe(200);
    expect(revoked.statusCode).toBe(401);
  });
});

describe('POST /api/auth/reauthenticate', () => {
  it('refreshes the password verification timestamp', async () => {
    await createTestUser({ email: 'reauth@example.com' });
    const cookie = await loginAs(app, 'reauth@example.com');

    const stale = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.session.updateMany({ data: { passwordVerifiedAt: stale } });

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/auth/reauthenticate',
          payload: { password: DEFAULT_TEST_PASSWORD },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(204);
    const session = await prisma.session.findFirstOrThrow();
    expect(session.passwordVerifiedAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it('rejects a wrong password and audits the attempt', async () => {
    await createTestUser({ email: 'reauth-bad@example.com' });
    const cookie = await loginAs(app, 'reauth-bad@example.com');

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/auth/reauthenticate',
          payload: { password: 'senha-errada-123' },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(401);
    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map(
      (entry) => entry.action,
    );
    expect(actions).toContain('auth.reauthentication_failed');
  });
});

describe('validation', () => {
  it('returns field-level details for a malformed login payload', async () => {
    const response = await app.inject(
      withIp(
        { method: 'POST', url: '/api/auth/login', payload: { email: 'not-an-email' } },
        uniqueIp(),
      ),
    );

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details.map((detail: { field: string }) => detail.field)).toContain('email');
  });
});
