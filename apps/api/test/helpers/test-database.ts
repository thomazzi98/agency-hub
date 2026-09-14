import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { withOwnerCredentials } from '../../scripts/database-url.mjs';

const require = createRequire(import.meta.url);

export const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Every helper here creates and drops databases. The `_test` guard is the only thing
 * standing between a misconfigured environment variable and a dropped real database,
 * so it is enforced on every code path rather than only at the entry point.
 */
function assertDroppableDatabase(databaseName: string): void {
  if (!databaseName.includes('_test')) {
    throw new Error(
      `Refusing to manage database "${databaseName}": test databases must contain "_test" in their name.`,
    );
  }
}

export function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env and start Postgres.');
  }
  assertDroppableDatabase(databaseNameOf(url));
  return url;
}

export function databaseNameOf(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
}

export function withDatabaseName(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

/** Prisma-only query params (`connection_limit`, `schema`) confuse the raw pg driver. */
function plainConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.search = '';
  return url.toString();
}

/** The test URLs carry the least-privilege application role, which cannot create databases. */
async function withMaintenanceClient<T>(
  databaseUrl: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    connectionString: withOwnerCredentials(
      plainConnectionString(withDatabaseName(databaseUrl, 'postgres')),
    ),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function recreateDatabase(databaseUrl: string): Promise<void> {
  const databaseName = databaseNameOf(databaseUrl);
  assertDroppableDatabase(databaseName);

  await withMaintenanceClient(databaseUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
  });
}

export async function dropDatabase(databaseUrl: string): Promise<void> {
  const databaseName = databaseNameOf(databaseUrl);
  assertDroppableDatabase(databaseName);

  await withMaintenanceClient(databaseUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  });
}

function prismaBinPath(): string {
  const packageJsonPath = require.resolve('prisma/package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    bin: string | Record<string, string>;
  };
  const binRelative =
    typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin.prisma;
  if (!binRelative) {
    throw new Error('Could not locate the Prisma CLI entry point.');
  }
  return path.join(path.dirname(packageJsonPath), binRelative);
}

export function runPrismaCli(args: string[], databaseUrl: string): void {
  execFileSync(process.execPath, [prismaBinPath(), ...args], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: withOwnerCredentials(databaseUrl) },
    stdio: 'pipe',
  });
}

/** Creates the least-privilege role and its grants; must precede `migrate deploy`. */
export function runProvisionAppRole(databaseUrl: string): void {
  execFileSync(
    process.execPath,
    [path.join(apiDir, 'scripts', 'provision-app-role.mjs'), databaseUrl],
    { cwd: apiDir, env: { ...process.env }, stdio: 'pipe' },
  );
}

export function runMigrateDeploy(databaseUrl: string): void {
  runProvisionAppRole(databaseUrl);
  runPrismaCli(['migrate', 'deploy'], databaseUrl);
}

export function runMigrateDown(databaseUrl: string, steps = 1): void {
  execFileSync(
    process.execPath,
    [path.join(apiDir, 'scripts', 'migrate-down.mjs'), '--steps', String(steps)],
    {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: withOwnerCredentials(databaseUrl) },
      stdio: 'pipe',
    },
  );
}

export async function queryDatabase<T extends pg.QueryResultRow>(
  databaseUrl: string,
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({
    connectionString: withOwnerCredentials(plainConnectionString(databaseUrl)),
  });
  await client.connect();
  try {
    const result = await client.query<T>(sql, values);
    return result.rows;
  } finally {
    await client.end();
  }
}

/**
 * Empties every application table, discovered dynamically so new stages need no edit
 * here. Three deliberate choices:
 *   - `DELETE`, not `TRUNCATE`: truncating rewrites each table file, ~3s per call on
 *     a Docker volume, multiplied by every test's `beforeEach`.
 *   - passes repeat until nothing is blocked, because foreign keys make order matter.
 *   - it runs on the **owner** connection: `audit_logs` is append-only at the database
 *     level (no DELETE policy at all, not even for the RLS bypass), so the application
 *     role genuinely cannot clear it — and that invariant is worth keeping.
 */
const RESET_SQL = `
DO $reset$
DECLARE
  target record;
  blocked integer;
  pass integer := 0;
BEGIN
  LOOP
    pass := pass + 1;
    blocked := 0;

    FOR target IN
      SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I', target.tablename);
      EXCEPTION WHEN foreign_key_violation THEN
        blocked := blocked + 1;
      END;
    END LOOP;

    EXIT WHEN blocked = 0;

    IF pass > 20 THEN
      RAISE EXCEPTION 'Could not clear the test database: % tables still blocked by foreign keys', blocked;
    END IF;
  END LOOP;
END
$reset$;
`;

export async function clearDatabase(databaseUrl: string): Promise<void> {
  await queryDatabase(databaseUrl, RESET_SQL);
}
