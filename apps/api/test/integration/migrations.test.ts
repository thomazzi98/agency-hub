import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  apiDir,
  databaseNameOf,
  dropDatabase,
  queryDatabase,
  recreateDatabase,
  resolveTestDatabaseUrl,
  runMigrateDeploy,
  runMigrateDown,
  withDatabaseName,
} from '../helpers/test-database.js';

const baseUrl = resolveTestDatabaseUrl();
const scratchUrl = withDatabaseName(baseUrl, `${databaseNameOf(baseUrl)}_rollback`);

/** Every migration must be reversible, so the rollback test walks all of them. */
const migrationCount = readdirSync(path.join(apiDir, 'prisma', 'migrations'), {
  withFileTypes: true,
}).filter((entry) => entry.isDirectory()).length;

async function publicTableNames(): Promise<string[]> {
  const rows = await queryDatabase<{ tablename: string }>(
    scratchUrl,
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return rows.map((row) => row.tablename);
}

async function enumTypeNames(): Promise<string[]> {
  const rows = await queryDatabase<{ typname: string }>(
    scratchUrl,
    `SELECT t.typname
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e' AND n.nspname = 'public'
      ORDER BY t.typname`,
  );
  return rows.map((row) => row.typname);
}

describe('migrations', () => {
  beforeAll(async () => {
    await recreateDatabase(scratchUrl);
  }, 60_000);

  afterAll(async () => {
    await dropDatabase(scratchUrl);
  }, 60_000);

  it('applies, rolls back, and re-applies cleanly on a fresh database', async () => {
    runMigrateDeploy(scratchUrl);

    const tablesAfterDeploy = await publicTableNames();
    expect(tablesAfterDeploy).toContain('users');
    expect(tablesAfterDeploy).toContain('companies');
    expect(tablesAfterDeploy).toContain('company_memberships');
    expect(tablesAfterDeploy).toContain('sessions');
    expect(tablesAfterDeploy).toContain('password_reset_audits');
    expect(tablesAfterDeploy).toContain('audit_logs');
    expect(tablesAfterDeploy).toContain('login_attempts');
    expect(await enumTypeNames()).toContain('user_role');

    runMigrateDown(scratchUrl, migrationCount);

    expect(await publicTableNames()).toEqual(['_prisma_migrations']);
    expect(await enumTypeNames()).toEqual([]);
    const remaining = await queryDatabase<{ count: string }>(
      scratchUrl,
      `SELECT count(*)::text AS count FROM _prisma_migrations WHERE rolled_back_at IS NULL`,
    );
    expect(remaining[0]?.count).toBe('0');

    runMigrateDeploy(scratchUrl);

    expect(await publicTableNames()).toEqual(tablesAfterDeploy);
  }, 180_000);
});
