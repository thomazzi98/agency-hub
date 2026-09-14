import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, buildTestApp, createTestUser, loginAs } from '../helpers/app.js';
import { auditActions, closeTestPrisma, resetDatabase, testPrisma } from '../helpers/prisma.js';
import { syntheticBytes } from '../helpers/storage.js';

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

describe('branding assets', () => {
  /**
   * A tiny multipart body written by hand: the suite drives the API through
   * `app.inject`, which has no form-data helper, and a real one here would be more
   * machinery than the three fields it carries.
   */
  function multipartBody(input: { filename: string; contentType: string; content: Buffer }) {
    const boundary = '----agencyhubtest0123456789';
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${input.filename}"\r\n` +
        `Content-Type: ${input.contentType}\r\n\r\n`,
      'utf8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

    return {
      payload: Buffer.concat([head, input.content, tail]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  async function adminCookie(email: string) {
    const admin = await createTestUser({ email, role: 'agency_admin' });
    return { admin, cookie: await loginAs(app, admin.email) };
  }

  it('stores an uploaded logo and serves it back without a session', async () => {
    const { cookie } = await adminCookie('brand-upload@example.com');
    const png = syntheticBytes(2048);
    const form = multipartBody({ filename: 'logo.png', contentType: 'image/png', content: png });

    const uploaded = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/branding/assets/logo',
          payload: form.payload,
          headers: form.headers,
        },
        cookie,
      ),
    );

    expect(uploaded.statusCode).toBe(201);
    const logoUrl = uploaded.json().data.logoUrl as string;
    expect(logoUrl).toMatch(/^\/api\/branding\/assets\/logo\/[0-9a-f-]{36}\.png$/);

    // The login screen fetches this before anyone has authenticated.
    const served = await app.inject({ method: 'GET', url: logoUrl });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.rawPayload.byteLength).toBe(png.byteLength);
  });

  it('accepts its own asset path back through the regular update endpoint', async () => {
    const { cookie } = await adminCookie('brand-roundtrip@example.com');
    const form = multipartBody({
      filename: 'logo.png',
      contentType: 'image/png',
      content: syntheticBytes(512),
    });

    const uploaded = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/branding/assets/logo',
          payload: form.payload,
          headers: form.headers,
        },
        cookie,
      ),
    );
    const logoUrl = uploaded.json().data.logoUrl as string;

    // Re-saving the form must not fail validation on a value the server just produced.
    const resaved = await app.inject(
      authed({ method: 'PATCH', url: '/api/branding', payload: { logoUrl } }, cookie),
    );

    expect(resaved.statusCode).toBe(200);
    expect(resaved.json().data.logoUrl).toBe(logoUrl);
  });

  it('rejects a format outside the allow-list for that asset', async () => {
    const { cookie } = await adminCookie('brand-badtype@example.com');
    const form = multipartBody({
      filename: 'logo.gif',
      contentType: 'image/gif',
      content: syntheticBytes(512),
    });

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/branding/assets/logo',
          payload: form.payload,
          headers: form.headers,
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('file_type_not_allowed');
  });

  it('rejects a favicon over its much smaller limit', async () => {
    const { cookie } = await adminCookie('brand-toobig@example.com');
    const form = multipartBody({
      filename: 'favicon.png',
      contentType: 'image/png',
      content: syntheticBytes(300 * 1024),
    });

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/branding/assets/favicon',
          payload: form.payload,
          headers: form.headers,
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('file_too_large');
  });

  it('refuses the upload to anyone but an agency_admin', async () => {
    const user = await createTestUser({
      email: 'brand-manager@example.com',
      role: 'agency_manager',
    });
    const cookie = await loginAs(app, user.email);
    const form = multipartBody({
      filename: 'logo.png',
      contentType: 'image/png',
      content: syntheticBytes(512),
    });

    const response = await app.inject(
      authed(
        {
          method: 'POST',
          url: '/api/branding/assets/logo',
          payload: form.payload,
          headers: form.headers,
        },
        cookie,
      ),
    );

    expect(response.statusCode).toBe(403);
  });

  it('will not serve an arbitrary object from the bucket', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/branding/assets/../../some-company/no-project/file/secret.jpg',
    });

    expect(response.statusCode).toBe(404);
  });
});
