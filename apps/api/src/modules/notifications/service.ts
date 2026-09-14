import type { ScopedDb } from '../../shared/tenant-scope.js';

export interface NotifyInput {
  /** Null only for platform-level events with no single company. */
  companyId: string | null;
  type: string;
  title: string;
  message: string;
  actorId?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
}

/**
 * Everyone who can currently reach the company, which is re-read here rather than
 * carried along from whenever the resource was created: a membership revoked five
 * minutes ago must not receive this
 * (08-notifications-and-push.md#recipient-resolution-rules).
 *
 * `agency_admin` users have no membership rows — their access is the role — so they
 * are unioned in explicitly rather than being silently missed.
 */
export async function companyAudience(
  tx: ScopedDb,
  companyId: string,
  options: { exclude?: string | null; includeAgencyAdmins?: boolean } = {},
): Promise<string[]> {
  const [memberships, admins] = await Promise.all([
    tx.companyMembership.findMany({
      where: { companyId, status: 'active', user: { status: 'active' } },
      select: { userId: true },
    }),
    options.includeAgencyAdmins === false
      ? Promise.resolve([])
      : tx.user.findMany({
          where: { role: 'agency_admin', status: 'active' },
          select: { id: true },
        }),
  ]);

  const ids = new Set<string>(memberships.map((row) => row.userId));
  for (const admin of admins) ids.add(admin.id);
  if (options.exclude) ids.delete(options.exclude);
  return [...ids];
}

/** Only the agency's own admins — for events that are agency-wide rather than client-facing. */
export async function agencyAdmins(tx: ScopedDb, exclude?: string | null): Promise<string[]> {
  const admins = await tx.user.findMany({
    where: { role: 'agency_admin', status: 'active' },
    select: { id: true },
  });
  return admins.map((admin) => admin.id).filter((id) => id !== exclude);
}

/**
 * Narrows a caller-supplied list to people who can actually reach the company. Used
 * for mentions and for "the responsible party", where the id comes from a request
 * body and must never be trusted to be in scope.
 */
export async function usersWithCompanyAccess(
  tx: ScopedDb,
  companyId: string,
  userIds: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];

  const [memberships, admins] = await Promise.all([
    tx.companyMembership.findMany({
      where: {
        companyId,
        status: 'active',
        userId: { in: unique },
        user: { status: 'active' },
      },
      select: { userId: true },
    }),
    tx.user.findMany({
      where: { id: { in: unique }, role: 'agency_admin', status: 'active' },
      select: { id: true },
    }),
  ]);

  const allowed = new Set<string>(memberships.map((row) => row.userId));
  for (const admin of admins) allowed.add(admin.id);
  return unique.filter((id) => allowed.has(id));
}

/**
 * Creates (or refreshes) the in-app notification for each recipient. The rows are
 * written inside the caller's transaction, so a notification can never survive a
 * mutation that was rolled back.
 *
 * Deduplication is the partial unique index, not a read-then-write: an existing
 * **unread** row for the same (recipient, type, related resource) is updated in place,
 * so three quick edits are one unread item rather than three
 * (08-notifications-and-push.md#deduplication--anti-spam-concrete-parameters).
 *
 * It has to be an upsert rather than a lookup because the actor cannot *read* other
 * people's notifications — the read policy is per-recipient by design — while raising
 * an event legitimately writes to them. No `RETURNING` for the same reason.
 *
 * Push is deliberately not sent from here. The worker sweeps for rows that changed
 * since their last push (jobs/dispatch-push-notifications.ts), which is what makes the
 * spec's "debounced to the end of the window as a single, updated push" fall out
 * naturally: by the time the sweep reaches a row, the burst is already folded into it.
 * The in-app centre is unaffected and stays real-time.
 */
export async function notify(
  tx: ScopedDb,
  recipientIds: readonly string[],
  input: NotifyInput,
): Promise<number> {
  const recipients = [...new Set(recipientIds)].filter((id) => id !== input.actorId);
  if (recipients.length === 0) return 0;

  const relatedType = input.relatedType ?? null;
  const relatedId = input.relatedId ?? null;
  let written = 0;

  for (const recipientId of recipients) {
    written += await tx.$executeRaw`
      INSERT INTO "notifications"
        ("recipient_id", "company_id", "type", "title", "message",
         "actor_id", "related_type", "related_id")
      VALUES (
        ${recipientId}::uuid, ${input.companyId}::uuid, ${input.type},
        ${input.title}, ${input.message}, ${input.actorId ?? null}::uuid,
        ${relatedType}, ${relatedId}::uuid
      )
      ON CONFLICT ("recipient_id", "type", "related_type", "related_id")
        WHERE "read_at" IS NULL
      DO UPDATE SET
        "title" = EXCLUDED."title",
        "message" = EXCLUDED."message",
        "actor_id" = EXCLUDED."actor_id",
        "company_id" = EXCLUDED."company_id",
        -- Bumped so the collapsed item sorts as the recent thing it now is, and so the
        -- push sweep can tell it changed since it was last delivered.
        "created_at" = now()
    `;
  }

  return written;
}
