#!/usr/bin/env node
/**
 * Prisma Migrate has no built-in rollback, but docs/sdd/19-deployment-and-cicd.md
 * requires every migration to be reversible. Each migration directory therefore
 * carries a hand-reviewed `down.sql` next to Prisma's generated `migration.sql`;
 * this script applies the newest applied migration's `down.sql` and removes its
 * bookkeeping row, so `prisma migrate deploy` will re-apply it cleanly afterwards.
 *
 * Usage: node scripts/migrate-down.mjs [--steps N]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config as loadDotenv } from 'dotenv';
import { withOwnerCredentials } from './database-url.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(scriptDir, '..');
loadDotenv({ path: path.resolve(apiDir, '../../.env'), quiet: true });

const stepsFlagIndex = process.argv.indexOf('--steps');
const steps = stepsFlagIndex === -1 ? 1 : Number(process.argv[stepsFlagIndex + 1]);
if (!Number.isInteger(steps) || steps < 1) {
  throw new Error('--steps must be a positive integer');
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Rolling back is DDL, which the least-privilege application role cannot run.
const databaseUrl = withOwnerCredentials(process.env.DATABASE_URL);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  for (let step = 0; step < steps; step += 1) {
    const { rows } = await client.query(
      `SELECT id, migration_name
         FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at DESC
        LIMIT 1`,
    );

    const migration = rows[0];
    if (!migration) {
      console.log('No applied migration left to roll back.');
      break;
    }

    const downPath = path.join(
      apiDir,
      'prisma',
      'migrations',
      migration.migration_name,
      'down.sql',
    );
    const downSql = await readFile(downPath, 'utf8');

    await client.query('BEGIN');
    try {
      await client.query(downSql);
      await client.query('DELETE FROM _prisma_migrations WHERE id = $1', [migration.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log(`Rolled back ${migration.migration_name}`);
  }
} finally {
  await client.end();
}
