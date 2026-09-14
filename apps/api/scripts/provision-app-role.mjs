#!/usr/bin/env node
/**
 * Creates (or updates) the least-privilege role the application connects as, using
 * the credentials already present in DATABASE_URL. Must run before migrations,
 * because the default-privilege rule it installs is what makes every table a later
 * migration creates reachable by that role.
 *
 * The role is explicitly NOSUPERUSER / NOBYPASSRLS: PostgreSQL silently ignores RLS
 * policies for superusers and for roles carrying BYPASSRLS, which would turn the
 * whole tenant-isolation safety net into a no-op.
 *
 * Usage: node scripts/provision-app-role.mjs [database-url]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config as loadDotenv } from 'dotenv';
import {
  credentialsOf,
  databaseNameOf,
  plainConnectionString,
  withOwnerCredentials,
} from './database-url.mjs';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: path.resolve(apiDir, '../../.env'), quiet: true });

const databaseUrl = process.argv[2] ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('No database URL given and DATABASE_URL is not set.');
}

const { user, password } = credentialsOf(databaseUrl);
const owner = process.env.DB_OWNER_USER;
const databaseName = databaseNameOf(databaseUrl);

if (!user) {
  throw new Error('The database URL carries no username for the application role.');
}
if (user === owner) {
  throw new Error(
    `The application role must differ from the owner role "${owner}": PostgreSQL bypasses RLS for table owners.`,
  );
}
if (!password) {
  throw new Error(`No password in the database URL for role "${user}".`);
}

const client = new pg.Client({
  connectionString: plainConnectionString(withOwnerCredentials(databaseUrl)),
});
await client.connect();

// DO blocks cannot take bind parameters, and roles/databases cannot be parameterized
// at all, so identifiers and the password literal are escaped by the driver instead.
const id = (value) => client.escapeIdentifier(value);
const lit = (value) => client.escapeLiteral(value);

try {
  const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
  if (existing.rowCount === 0) {
    await client.query(`CREATE ROLE ${id(user)} LOGIN`);
  }

  await client.query(
    `ALTER ROLE ${id(user)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ` +
      `NOBYPASSRLS NOREPLICATION PASSWORD ${lit(password)}`,
  );

  await client.query(`GRANT CONNECT ON DATABASE ${id(databaseName)} TO ${id(user)}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${id(user)}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${id(user)}`,
  );
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${id(user)}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public ` +
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${id(user)}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${id(user)}`,
  );

  console.log(`Application role "${user}" is provisioned on "${databaseName}".`);
} finally {
  await client.end();
}
