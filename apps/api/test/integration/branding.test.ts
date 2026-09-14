import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, buildTestApp, createTestUser, loginAs } from '../helpers/app.js';
import { auditActions, closeTestPrisma, resetDatabase, testPrisma } from '../helpers/prisma.js';

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

describe('GET /api/branding', () => {
  it('is readable without a session, because the login screen needs it', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/branding' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      appName: 'Agency Hub',
      primaryColor: '#1d4ed8',
    });
  });

  it('never exposes who last changed it', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/branding' });

    expect(response.json().data.updatedById).toBeUndefined();
  });
});

describe('PATCH /api/branding', () => {
  it('lets an agency_admin change the brand and records the change', async () => {
    const admin = await createTestUser({ email: 'brand-admin@example.com', role: 'agency_admin' });
    const cookie = await loginAs(app, admin.email);

    const response = await app.inject(
      authed(
        {
          method: 'PATCH',
          url: '/api/branding',
          payload: {
            appName: 'Agência Exemplo',
            primaryColor: '#7C2D12',
            loginMessage: 'Bem-vindo à área do cliente.',
          },
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      appName: 'Agência Exemplo',
      // Normalized to lower case so the stored value is comparable.
      primaryColor: '#7c2d12',
      loginMessage: 'Bem-vindo à área do cliente.',
    });

    expect(await auditActions()).toContain('branding.updated');

    const stored = await prisma.brandingSettings.findFirstOrThrow();
    expect(stored.updatedById).toBe(admin.id);
  });

  it.each([['agency_manager'], ['client_manager'], ['contributor']] as const)(
    'refuses the change to a %s',
    async (role) => {
      const user = await createTestUser({ email: `brand-${role}@example.com`, role });
      const cookie = await loginAs(app, user.email);

      const response = await app.inject(
        authed({ method: 'PATCH', url: '/api/branding', payload: { appName: 'Invadida' } }, cookie),
      );

      expect(response.statusCode).toBe(403);
      const unchanged = await app.inject({ method: 'GET', url: '/api/branding' });
      expect(unchanged.json().data.appName).toBe('Agency Hub');
    },
  );

  it('refuses a brand colour that white text could not be read against', async () => {
    const admin = await createTestUser({ email: 'brand-pale@example.com', role: 'agency_admin' });
    const cookie = await loginAs(app, admin.email);

    const response = await app.inject(
      authed(
        { method: 'PATCH', url: '/api/branding', payload: { primaryColor: '#ffe066' } },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('insufficient_contrast');
    // The message names the measured ratio so the admin can judge how far off it is.
    expect(response.json().error.message).toMatch(/\d+\.\d+:1/);

    const unchanged = await app.inject({ method: 'GET', url: '/api/branding' });
    expect(unchanged.json().data.primaryColor).toBe('#1d4ed8');
  });

  it('rejects a malformed colour before any business logic runs', async () => {
    const admin = await createTestUser({ email: 'brand-bad@example.com', role: 'agency_admin' });
    const cookie = await loginAs(app, admin.email);

    const response = await app.inject(
      authed({ method: 'PATCH', url: '/api/branding', payload: { primaryColor: 'azul' } }, cookie),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_error');
  });

  it('keeps exactly one brand row no matter how many updates happen', async () => {
    const admin = await createTestUser({ email: 'brand-single@example.com', role: 'agency_admin' });
    const cookie = await loginAs(app, admin.email);

    for (const appName of ['Um', 'Dois', 'Três']) {
      await app.inject(
        authed({ method: 'PATCH', url: '/api/branding', payload: { appName } }, cookie),
      );
    }

    expect(await prisma.brandingSettings.count()).toBe(1);
  });
});
