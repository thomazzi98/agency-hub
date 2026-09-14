import { getEnv } from '../config/env.js';

/**
 * The connection string `pg_dump` and pg-boss need.
 *
 * The application role is deliberately neither the owner nor a superuser — that is
 * what makes RLS apply to it at all — so it cannot read every table, and a dump taken
 * through it would be silently incomplete. Anything that legitimately needs the whole
 * database asks for the owner here, in one place, rather than assembling a URL of its
 * own (14-database-design.md).
 *
 * Prisma-only query parameters are dropped: `connection_limit` and friends mean
 * nothing to libpq and make it refuse the string outright.
 */
export function withOwnerCredentials(): string {
  const env = getEnv();
  const url = new URL(env.DATABASE_URL);

  url.username = encodeURIComponent(env.DB_OWNER_USER);
  url.password = env.DB_OWNER_PASSWORD ? encodeURIComponent(env.DB_OWNER_PASSWORD) : '';
  url.search = '';

  return url.toString();
}
