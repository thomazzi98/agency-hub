#!/usr/bin/env node
/**
 * Refuses a migration that drops something without saying so out loud.
 *
 * "No column/table drop ships without an explicit, separately reviewed migration —
 * never bundled silently with an unrelated feature migration"
 * (docs/sdd/19-deployment-and-cicd.md#migrations). A reviewer can miss one `DROP
 * COLUMN` in three hundred lines of `CREATE TABLE`; this cannot.
 *
 * A migration that genuinely needs to drop something declares it:
 *
 *   -- destructive: dropping publications.legacy_url, replaced by link in stage 9
 *
 * The marker does not make the change safe. It makes it deliberate, and it puts the
 * reason in the diff where the person approving it will read it.
 *
 * `down.sql` files are exempt: reversing a migration is what they are for.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const MIGRATIONS = path.resolve('apps/api/prisma/migrations');

/** Statements that lose data, as opposed to statements that merely change shape. */
const DESTRUCTIVE = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
];

const MARKER = /--\s*destructive:/i;

const problems = [];

for (const entry of await readdir(MIGRATIONS, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const file = path.join(MIGRATIONS, entry.name, 'migration.sql');
  let sql;
  try {
    sql = await readFile(file, 'utf8');
  } catch {
    problems.push(`${entry.name}: has no migration.sql`);
    continue;
  }

  // Every migration must be reversible (docs/sdd/19-deployment-and-cicd.md).
  try {
    await readFile(path.join(MIGRATIONS, entry.name, 'down.sql'), 'utf8');
  } catch {
    problems.push(`${entry.name}: has no down.sql, so it cannot be rolled back`);
  }

  const found = DESTRUCTIVE.filter((pattern) => pattern.test(sql));
  if (found.length > 0 && !MARKER.test(sql)) {
    problems.push(`${entry.name}: drops or deletes data without a "-- destructive: <why>" comment`);
  }
}

if (problems.length > 0) {
  console.error('Migration review failed:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nSee docs/sdd/19-deployment-and-cicd.md#migrations.');
  process.exit(1);
}

console.log('Migrations reviewed: every one is reversible and none drops data silently.');
