import type { PrismaClient } from '@prisma/client';
import { withSystemScope } from '../shared/tenant-scope.js';
import { NotificationType } from '../modules/notifications/catalog.js';
import { companyAudience, notify } from '../modules/notifications/service.js';
import { OVERDUE_STATUSES } from '../modules/calendar/content.js';

export const NOTIFY_OVERDUE_CONTENT_JOB = 'notify-overdue-content';

/** Nobody needs to hear about something that slipped last quarter. */
const LOOKBACK_DAYS = 30;

export interface OverdueSweepResult {
  overdue: number;
  notified: number;
}

/**
 * "Content overdue" is the one event in the catalog nobody triggers by acting — it
 * happens because time passed (08-notifications-and-push.md#event-catalog-phase-1), so
 * it needs a sweep rather than a hook in a mutation path.
 *
 * Each person is told once per lateness, however often the sweep runs. Relying on the
 * unread row to absorb the repeats was not enough: every run bumped that row, which the
 * push sweep reads as "changed since it was pushed" - an hourly buzz per late item for
 * up to a month - and once the person had read it, the next run opened a fresh one.
 * "Already told" is a notification about this item created at or after the moment it
 * fell due, so an item rescheduled and missed again is a new lateness and is told again.
 */
export async function notifyOverdueContent(
  prisma: PrismaClient,
  now = new Date(),
): Promise<OverdueSweepResult> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  return withSystemScope(prisma, async (tx) => {
    const overdue = await tx.content.findMany({
      where: {
        deletedAt: null,
        scheduledAt: { lt: now, gte: since },
        productionStatus: { in: OVERDUE_STATUSES },
      },
      select: {
        id: true,
        companyId: true,
        title: true,
        responsibleUserId: true,
        scheduledAt: true,
      },
      // The most recent lateness first, should there ever be more than one batch.
      orderBy: { scheduledAt: 'desc' },
      take: 500,
    });

    if (overdue.length === 0) return { overdue: 0, notified: 0 };

    // One read for the whole batch rather than one per item.
    const earlier = await tx.notification.findMany({
      where: {
        type: NotificationType.ContentOverdue,
        relatedType: 'content',
        relatedId: { in: overdue.map((content) => content.id) },
      },
      select: { recipientId: true, relatedId: true, createdAt: true },
    });
    const earlierByContent = new Map<string, typeof earlier>();
    for (const row of earlier) {
      if (!row.relatedId) continue;
      earlierByContent.set(row.relatedId, [...(earlierByContent.get(row.relatedId) ?? []), row]);
    }

    const audiences = new Map<string, string[]>();
    let notified = 0;

    for (const content of overdue) {
      // The person who owns it if there is one; otherwise everyone who could act.
      let candidates: string[];
      if (content.responsibleUserId) {
        candidates = [content.responsibleUserId];
      } else {
        const cached = audiences.get(content.companyId);
        candidates = cached ?? (await companyAudience(tx, content.companyId));
        audiences.set(content.companyId, candidates);
      }

      const alreadyTold = new Set(
        (earlierByContent.get(content.id) ?? [])
          .filter((row) => row.createdAt >= content.scheduledAt)
          .map((row) => row.recipientId),
      );
      const recipients = candidates.filter((id) => !alreadyTold.has(id));
      if (recipients.length === 0) continue;

      notified += await notify(tx, recipients, {
        companyId: content.companyId,
        type: NotificationType.ContentOverdue,
        title: 'Conteúdo atrasado',
        message: `"${content.title}" passou da data e ainda não foi concluído.`,
        relatedType: 'content',
        relatedId: content.id,
      });
    }

    return { overdue: overdue.length, notified };
  });
}
