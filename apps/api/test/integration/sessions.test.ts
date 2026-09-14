import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, buildTestApp, createTestUser, loginAs } from '../helpers/app.js';
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

describe('GET /api/sessions', () => {
  it('lists the actor own active sessions and flags the current one', async () => {
    await createTestUser({ email: 'owner@example.com' });
    const first = await loginAs(app, 'owner@example.com');
    const second = await loginAs(app, 'owner@example.com');

    const response = await app.inject(authed({ method: 'GET', url: '/api/sessions' }, second));

    expect(response.statusCode).toBe(200);
    const sessions = response.json().data as { id: string; isCurrent: boolean }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.isCurrent)).toHaveLength(1);
    expect(first).not.toBe(second);
  });

  it('refuses a non-admin asking for another user sessions', async () => {
    await createTestUser({ email: 'manager@example.com', role: 'agency_manager' });
    const other = await createTestUser({ email: 'other@example.com' });
    const cookie = await loginAs(app, 'manager@example.com');

    const response = await app.inject(
      authed({ method: 'GET', url: `/api/sessions?userId=${other.id}` }, cookie),
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden');
  });

  it('lets an agency_admin inspect another user sessions', async () => {
    await createTestUser({ email: 'admin@example.com', role: 'agency_admin' });
    const other = await createTestUser({ email: 'target@example.com' });
    await loginAs(app, 'target@example.com');
    const adminCookie = await loginAs(app, 'admin@example.com');

    const response = await app.inject(
      authed({ method: 'GET', url: `/api/sessions?userId=${other.id}` }, adminCookie),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
  });
});

describe('DELETE /api/sessions/:id', () => {
  it('revokes one of the actor own sessions', async () => {
    await createTestUser({ email: 'self-revoke@example.com' });
    const doomed = await loginAs(app, 'self-revoke@example.com');
    const current = await loginAs(app, 'self-revoke@example.com');

    const list = await app.inject(authed({ method: 'GET', url: '/api/sessions' }, current));
    const target = (list.json().data as { id: string; isCurrent: boolean }[]).find(
      (session) => !session.isCurrent,
    );

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/sessions/${target?.id}` }, current),
    );

    expect(response.statusCode).toBe(204);
    const after = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, doomed));
    expect(after.statusCode).toBe(401);
  });

  it('hides another user session behind a 404 rather than a 403', async () => {
    await createTestUser({ email: 'intruder@example.com' });
    await createTestUser({ email: 'victim@example.com' });
    const victimCookie = await loginAs(app, 'victim@example.com');
    const intruderCookie = await loginAs(app, 'intruder@example.com');

    const victimSession = await prisma.session.findFirstOrThrow({
      where: { user: { email: 'victim@example.com' } },
    });

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/sessions/${victimSession.id}` }, intruderCookie),
    );

    expect(response.statusCode).toBe(404);

    const stillValid = await app.inject(
      authed({ method: 'GET', url: '/api/auth/me' }, victimCookie),
    );
    expect(stillValid.statusCode).toBe(200);
  });

  it('lets an agency_admin revoke any session', async () => {
    await createTestUser({ email: 'root@example.com', role: 'agency_admin' });
    await createTestUser({ email: 'employee@example.com' });
    const employeeCookie = await loginAs(app, 'employee@example.com');
    const adminCookie = await loginAs(app, 'root@example.com');

    const employeeSession = await prisma.session.findFirstOrThrow({
      where: { user: { email: 'employee@example.com' } },
    });

    const response = await app.inject(
      authed({ method: 'DELETE', url: `/api/sessions/${employeeSession.id}` }, adminCookie),
    );

    expect(response.statusCode).toBe(204);
    const after = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, employeeCookie));
    expect(after.statusCode).toBe(401);
  });
});

describe('POST /api/sessions/revoke-all', () => {
  it('drops every other session of the actor but keeps the current one', async () => {
    await createTestUser({ email: 'everywhere@example.com' });
    const old = await loginAs(app, 'everywhere@example.com');
    const current = await loginAs(app, 'everywhere@example.com');

    const response = await app.inject(
      authed({ method: 'POST', url: '/api/sessions/revoke-all', payload: {} }, current),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.revokedCount).toBe(1);

    expect((await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, old))).statusCode).toBe(
      401,
    );
    expect(
      (await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, current))).statusCode,
    ).toBe(200);
  });

  it('refuses a non-admin targeting another user', async () => {
    await createTestUser({ email: 'nosy@example.com' });
    const target = await createTestUser({ email: 'quiet@example.com' });
    const cookie = await loginAs(app, 'nosy@example.com');

    const response = await app.inject(
      authed(
        { method: 'POST', url: '/api/sessions/revoke-all', payload: { userId: target.id } },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });

  it('logs an agency_admin target out everywhere, sparing no session', async () => {
    await createTestUser({ email: 'superuser@example.com', role: 'agency_admin' });
    const target = await createTestUser({ email: 'logged-out@example.com' });
    const targetCookie = await loginAs(app, 'logged-out@example.com');
    await loginAs(app, 'logged-out@example.com');
    const adminCookie = await loginAs(app, 'superuser@example.com');

    const response = await app.inject(
      authed(
        { method: 'POST', url: '/api/sessions/revoke-all', payload: { userId: target.id } },
        adminCookie,
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.revokedCount).toBe(2);
    expect(
      (await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, targetCookie))).statusCode,
    ).toBe(401);
  });
});
