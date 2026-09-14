import type { PrismaClient } from '@prisma/client';
import { withSystemScope } from '../shared/tenant-scope.js';
import { NotificationType } from '../modules/notifications/catalog.js';
import { companyAudience, notify } from '../modules/notifications/service.js';

export const NOTIFY_OVERDUE_CONTENT_JOB = 'notify-overdue-content';

/** Nobody needs to hear about something that slipped last quarter. */
const LOOKBACK_DAYS = 30;

/** Statuses that mean the work has not happened yet (mirrors modules/calendar). */
const UNFINISHED = [
  'planned',
  'awaiting_material',
  'in_production',
  'in_review',
  'approved',
] as const;

export interface OverdueSweepResult {
  overdue: number;
  notified: number;
}

/**
 * "Content overdue" is the one event in the catalog nobody triggers by acting — it
 * happens because time passed (08-notifications-and-push.md#event-catalog-phase-1), so
 * it needs a sweep rather than a hook in a mutation path.
 *
 * Re-running it is safe: the notification service collapses onto the same unread row,
 * so an item that stays late for a week produces one item in the centre, refreshed,
 * not one per hour.
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
        productionStatus: { in: [...UNFINISHED] },
      },
      select: {
        id: true,
        companyId: true,
        title: true,
        responsibleUserId: true,
      },
      take: 500,
    });

    let notified = 0;
    for (const content of overdue) {
      // The person who owns it if there is one; otherwise everyone who could act.
      const recipients = content.responsibleUserId
        ? [content.responsibleUserId]
        : await companyAudience(tx, content.companyId);

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
