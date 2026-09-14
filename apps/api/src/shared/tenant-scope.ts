import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { isAgencyAdmin, type AuthenticatedActor } from './actor.js';
import { requireActor } from './authentication.js';

/**
 * A Prisma client whose transaction already carries this request's RLS context.
 * Tenant-owned tables are only ever queried through one of these — never through
 * the raw client, which would run with no context and (correctly) see nothing.
 */
export type ScopedDb = Prisma.TransactionClient;

/**
 * Prisma does not guarantee that two sequential calls on the top-level client run on
 * the same physical connection, so a plain `SET` would leak the previous tenant's
 * context onto a pooled connection and into an unrelated later request. Running
 * inside an interactive transaction with `set_config(..., is_local => true)` makes
 * the setting revert at transaction end regardless of commit or rollback.
 *
 * The cost is that a connection is held for the request's whole duration, which is
 * why the pool is sized for concurrent requests (ADR-0011).
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

function companyIdArray(companyIds: readonly string[]): string {
  return `{${companyIds.join(',')}}`;
}

/**
 * For queries that legitimately have no tenant context: authentication before the
 * actor is known, and background jobs acting for the system rather than a user.
 */
export async function withSystemScope<T>(
  prisma: PrismaClient,
  fn: (tx: ScopedDb) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
    return fn(tx);
  }, TRANSACTION_OPTIONS);
}

export async function withTenantScope<T>(
  prisma: PrismaClient,
  actor: AuthenticatedActor,
  fn: (tx: ScopedDb) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Set for every actor, admin included: notifications and push devices belong to a
    // person rather than to a company, so their policies scope by this rather than by
    // the company list (08-notifications-and-push.md#tenant-isolation).
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${actor.userId}, true)`;

    if (isAgencyAdmin(actor)) {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
    } else {
      await tx.$executeRaw`SELECT set_config('app.current_company_ids', ${companyIdArray(
        actor.companyIds,
      )}, true)`;
    }
    return fn(tx);
  }, TRANSACTION_OPTIONS);
}

export interface ScopedContext {
  tx: ScopedDb;
  actor: AuthenticatedActor;
  request: FastifyRequest;
  reply: FastifyReply;
}

/**
 * Wraps a route handler so it receives an already-scoped client. Route authors never
 * call `withTenantScope` themselves and never touch `app.prisma`, so the scoping
 * cannot be forgotten on a new endpoint (14-database-design.md, hard rule).
 *
 * A scoped handler must **return** its payload and use `reply.code()` for a non-200
 * status; it must never call `reply.send()`. Sending inside the transaction would
 * reply before the commit, so a client could be told a write succeeded and then not
 * see it on the next request — or be told it succeeded when the commit later failed.
 */
export function tenantScoped<TResult>(handler: (context: ScopedContext) => Promise<TResult>) {
  return async function scopedRouteHandler(
    this: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<TResult> {
    const actor = requireActor(request);
    const result = await withTenantScope(this.prisma, actor, async (tx) => {
      const payload = await handler({ tx, actor, request, reply });

      if (reply.sent) {
        throw new Error(
          'A tenant-scoped handler called reply.send() inside its transaction. ' +
            'Return the payload and use reply.code() instead, so the response is only ' +
            'sent once the transaction has committed.',
        );
      }
      return payload;
    });

    return result;
  };
}

export interface MultiScopedContext {
  /** Opens one scoped transaction per call. */
  runScoped: <T>(fn: (tx: ScopedDb) => Promise<T>) => Promise<T>;
  actor: AuthenticatedActor;
  request: FastifyRequest;
  reply: FastifyReply;
}

/**
 * For handlers that must talk to an external service (object storage) between database
 * steps. Wrapping the whole handler in one transaction would hold a pooled connection
 * across that network call — and the pool is sized for concurrent requests, not
 * concurrent waits (ADR-0011). Each `runScoped` call is its own short transaction with
 * the same RLS context, so atomicity is scoped to the steps that actually need it.
 */
export function multiScoped<TResult>(handler: (context: MultiScopedContext) => Promise<TResult>) {
  return async function multiScopedRouteHandler(
    this: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<TResult> {
    const actor = requireActor(request);
    const prisma = this.prisma;

    return handler({
      runScoped: (fn) => withTenantScope(prisma, actor, fn),
      actor,
      request,
      reply,
    });
  };
}

export interface DatabaseRolePrivileges {
  isSuperuser: boolean;
  bypassesRls: boolean;
  roleName: string;
}

export async function readDatabaseRolePrivileges(
  prisma: PrismaClient,
): Promise<DatabaseRolePrivileges> {
  const rows = await prisma.$queryRaw<
    { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
  >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

  const row = rows[0];
  if (!row) {
    throw new Error('Could not read the privileges of the current database role.');
  }

  return { roleName: row.rolname, isSuperuser: row.rolsuper, bypassesRls: row.rolbypassrls };
}

/**
 * Fails startup rather than serving traffic with inert tenant isolation: PostgreSQL
 * silently ignores every RLS policy for a superuser or a BYPASSRLS role, so this
 * misconfiguration has no symptom until it is a cross-tenant data leak.
 */
export async function assertLeastPrivilegeDatabaseRole(prisma: PrismaClient): Promise<void> {
  const privileges = await readDatabaseRolePrivileges(prisma);

  if (privileges.isSuperuser || privileges.bypassesRls) {
    throw new Error(
      `The application is connected as "${privileges.roleName}", which ` +
        `${privileges.isSuperuser ? 'is a superuser' : 'carries BYPASSRLS'}. ` +
        'PostgreSQL ignores Row-Level Security for such roles, so tenant isolation ' +
        'would not be enforced. Point DATABASE_URL at the application role created by ' +
        '`npm run db:provision --workspace=@agency-hub/api`.',
    );
  }
}
