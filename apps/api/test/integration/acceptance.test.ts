import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Company, User } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_TEST_PASSWORD,
  authed,
  buildTestApp,
  createTestCompany,
  createTestUser,
  grantMembership,
  loginAs,
} from '../helpers/app.js';
import { closeTestPrisma, resetDatabase, systemRead, testPrisma } from '../helpers/prisma.js';
import { withSystemScope } from '../../src/shared/tenant-scope.js';
import { MAX_PAGE_SIZE } from '../../src/shared/pagination.js';

/**
 * The acceptance criteria that belong to no single module
 * (22-acceptance-criteria.md). Each stage proved its own behaviour; these are the
 * statements about the system as a whole, which is exactly the kind of thing that
 * holds in every module separately and stops holding when one of them changes.
 */

const prisma = testPrisma();
let app: FastifyInstance;

let admin: User;
let manager: User;
let companyA: Company;

beforeAll(async () => {
  app = buildTestApp();
  await app.ready();
  await resetDatabase();

  companyA = await createTestCompany('Empresa A');
  admin = await createTestUser({ email: 'acc-admin@example.com', role: 'agency_admin' });
  manager = await createTestUser({ email: 'acc-manager@example.com', role: 'agency_manager' });
  await grantMembership(manager.id, companyA.id);

  // Enough rows that a page limit has something to hide behind it.
  await withSystemScope(prisma, (tx) =>
    tx.content.createMany({
      data: Array.from({ length: 150 }, (_, index) => ({
        companyId: companyA.id,
        title: `Conteúdo ${index}`,
        scheduledAt: new Date(Date.now() + index * 60_000),
      })),
    }),
  );
});

afterAll(async () => {
  await app.close();
  await closeTestPrisma();
});

const sessionFor = (user: User) => loginAs(app, user.email, DEFAULT_TEST_PASSWORD);

/** Every paginated list in the product, so a new one cannot quietly skip the cap. */
const LIST_ENDPOINTS = [
  '/api/companies',
  '/api/users',
  '/api/projects',
  '/api/files',
  '/api/content',
  '/api/publications',
  '/api/pending-requests',
  '/api/topics',
  '/api/comments?commentableType=company&commentableId=',
  '/api/deletion-requests',
  '/api/notifications',
  '/api/campaigns',
  '/api/ad-accounts',
];

describe('criterion 30: pagination is enforced server-side', () => {
  it('caps an over-large page size rather than obeying it or failing', async () => {
    const cookie = await sessionFor(admin);

    const response = await app.inject(
      authed({ method: 'GET', url: '/api/content?pageSize=10000' }, cookie),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().meta.pageSize).toBe(MAX_PAGE_SIZE);
    expect(response.json().data.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  it('never returns an unbounded list from any list endpoint', async () => {
    const cookie = await sessionFor(admin);

    for (const endpoint of LIST_ENDPOINTS) {
      const url = endpoint.endsWith('=')
        ? `${endpoint}${companyA.id}&pageSize=10000`
        : `${endpoint}?pageSize=10000`;
      const response = await app.inject(
        authed({ method: 'GET', url: url.replace('??', '?') }, cookie),
      );

      expect(response.statusCode, endpoint).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.data), endpoint).toBe(true);
      expect(body.data.length, endpoint).toBeLessThanOrEqual(MAX_PAGE_SIZE);
      if (body.meta) expect(body.meta.pageSize, endpoint).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    }
  });

  it('defaults to a page rather than everything when nothing is asked for', async () => {
    const cookie = await sessionFor(admin);

    const response = await app.inject(authed({ method: 'GET', url: '/api/content' }, cookie));

    expect(response.json().data).toHaveLength(20);
    expect(response.json().meta.total).toBe(150);
  });
});

describe('criterion 25: list endpoints answer quickly', () => {
  /**
   * A guard against a regression, not a benchmark: 500 ms p95 is the target in
   * 17-performance-requirements.md, measured here against a table with 150 rows on
   * whatever machine happens to be running the suite. It catches the kind of mistake
   * that costs an order of magnitude — an N+1, a missing index — rather than
   * measuring the hardware.
   */
  it('keeps p95 under the target across repeated calls', async () => {
    const cookie = await sessionFor(admin);
    const durations: number[] = [];

    for (let index = 0; index < 30; index += 1) {
      const started = performance.now();
      const response = await app.inject(
        authed({ method: 'GET', url: `/api/content?page=${(index % 5) + 1}` }, cookie),
      );
      durations.push(performance.now() - started);
      expect(response.statusCode).toBe(200);
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)]!;
    expect(p95).toBeLessThan(500);
  });

  it('does not slow down as a list grows, which is what an N+1 looks like', async () => {
    const cookie = await sessionFor(admin);

    const timed = async (pageSize: number) => {
      const started = performance.now();
      await app.inject(authed({ method: 'GET', url: `/api/content?pageSize=${pageSize}` }, cookie));
      return performance.now() - started;
    };

    await timed(10);
    const small = await timed(10);
    const large = await timed(100);

    // Ten times the rows must not cost anything like ten times the work. Generous on
    // purpose: this is looking for a per-row query, not measuring throughput.
    expect(large).toBeLessThan(small * 6 + 150);
  });
});

describe('criterion 16: a password is never readable anywhere', () => {
  it('never appears in an authentication response', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: admin.email, password: DEFAULT_TEST_PASSWORD },
      remoteAddress: '203.0.113.90',
    });

    expect(login.statusCode).toBe(200);
    expect(login.body).not.toContain(DEFAULT_TEST_PASSWORD);
    expect(login.body.toLowerCase()).not.toContain('passwordhash');

    const cookie = await sessionFor(admin);
    const me = await app.inject(authed({ method: 'GET', url: '/api/auth/me' }, cookie));
    expect(me.body).not.toContain(DEFAULT_TEST_PASSWORD);
    expect(me.body.toLowerCase()).not.toContain('hash');
  });

  it('is stored only as an argon2 hash', async () => {
    const stored = await systemRead((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: admin.id }, select: { passwordHash: true } }),
    );

    expect(stored.passwordHash).not.toContain(DEFAULT_TEST_PASSWORD);
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('never reaches a user listing, even for an admin', async () => {
    const cookie = await sessionFor(admin);

    const response = await app.inject(authed({ method: 'GET', url: '/api/users' }, cookie));

    // `mustChangePassword` is a legitimate field, so the check is for the hash and
    // for anything that could be a password, not for the word.
    expect(response.body).not.toContain('$argon2id$');
    expect(response.body.toLowerCase()).not.toContain('passwordhash');
    expect(response.body).not.toContain(DEFAULT_TEST_PASSWORD);
  });
});

describe('criterion 20: no advertising platform is contacted', () => {
  it('has no outbound call to Meta or TikTok anywhere in the source', async () => {
    const roots = [path.resolve('src'), path.resolve('../web/src')];
    const offenders: string[] = [];

    const forbidden = [
      /graph\.facebook\.com/i,
      /business-api\.tiktok\.com/i,
      /ads-api\./i,
      /facebook\.com\/v\d/i,
    ];

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;

        const source = await readFile(full, 'utf8');
        if (forbidden.some((pattern) => pattern.test(source))) offenders.push(full);
      }
    }

    for (const root of roots) await walk(root);

    // Phase 1 is a manual record on purpose (09-campaign-management.md); an
    // integration appearing here would change what every reported figure means.
    expect(offenders).toEqual([]);
  });
});

describe('criterion 3: cross-company access is impossible under every role', () => {
  it('answers for a company the actor cannot reach exactly as for one that does not exist', async () => {
    const companyB = await createTestCompany('Empresa B');
    const cookie = await sessionFor(manager);

    const [foreign, absent] = await Promise.all([
      app.inject(authed({ method: 'GET', url: `/api/companies/${companyB.id}` }, cookie)),
      app.inject(authed({ method: 'GET', url: `/api/companies/${crypto.randomUUID()}` }, cookie)),
    ]);

    expect(foreign.statusCode).toBe(absent.statusCode);
    expect(foreign.body).toBe(absent.body);
  });

  it('leaks nothing through a list, whatever the page size asked for', async () => {
    const companyB = await createTestCompany('Empresa C');
    await withSystemScope(prisma, (tx) =>
      tx.content.create({
        data: {
          companyId: companyB.id,
          title: 'Segredo de outra empresa',
          scheduledAt: new Date(),
        },
      }),
    );

    const cookie = await sessionFor(manager);
    const response = await app.inject(
      authed({ method: 'GET', url: '/api/content?pageSize=10000' }, cookie),
    );

    expect(response.body).not.toContain('Segredo de outra empresa');
  });
});

describe('the indexing strategy holds across the whole schema', () => {
  /**
   * "Every foreign key gets an index (Postgres does not create one automatically for
   * FKs)" — 14-database-design.md#indexing-strategy.
   *
   * A *leading* index specifically. A composite that covers the column in second
   * position does not help the check PostgreSQL runs on the referencing table when a
   * parent row is deleted or updated, and with `onDelete: Restrict` everywhere that
   * check happens on every attempted delete. The final review found eight of these.
   */
  it('gives every foreign key a leading index', async () => {
    const unindexed = await prisma.$queryRaw<{ table: string; column: string }[]>`
      SELECT c.conrelid::regclass::text AS table, a.attname AS column
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f'
         AND c.connamespace = 'public'::regnamespace
         AND NOT EXISTS (
           SELECT 1 FROM pg_index i
            WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
         )
    `;

    expect(unindexed.map((row) => `${row.table}.${row.column}`)).toEqual([]);
  });

  it('keeps a partial index on every soft-deletable table', async () => {
    // "Partial indexes on soft-deletable tables to keep the common-case index small"
    // (14-database-design.md#indexing-strategy).
    const softDeletable = ['files', 'comments', 'content'];

    const partials = await prisma.$queryRaw<{ table: string; count: bigint }[]>`
      SELECT tablename AS table, count(*) AS count
        FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = ANY (${softDeletable})
         AND indexdef LIKE '%deleted_at IS NULL%'
       GROUP BY tablename
    `;

    expect(partials.map((row) => row.table).sort()).toEqual([...softDeletable].sort());
  });
});
