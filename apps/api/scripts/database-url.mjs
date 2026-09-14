/**
 * The application connects as a role that is neither a superuser nor the owner of
 * the tables, because PostgreSQL bypasses Row-Level Security for both — RLS
 * policies would exist and never apply. Schema changes and role provisioning need
 * the owner instead, so those tools take the same URL and swap the credentials.
 */

export function withOwnerCredentials(databaseUrl, env = process.env) {
  const owner = env.DB_OWNER_USER;
  const password = env.DB_OWNER_PASSWORD;

  if (!owner) {
    throw new Error('DB_OWNER_USER is not set; migrations need the database owner role.');
  }

  const url = new URL(databaseUrl);
  url.username = encodeURIComponent(owner);
  url.password = password ? encodeURIComponent(password) : '';
  return url.toString();
}

export function credentialsOf(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

export function databaseNameOf(databaseUrl) {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
}

/** Prisma-only query params (`connection_limit`, `schema`) confuse the raw pg driver. */
export function plainConnectionString(databaseUrl) {
  const url = new URL(databaseUrl);
  url.search = '';
  return url.toString();
}

export function withDatabaseName(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}
