import type { PublicationStatus } from '../modules/publications/api';
import type { PendingRequest } from '../modules/pending-requests/api';

/**
 * One visual treatment per status, defined once and reused everywhere that status
 * appears (12-ui-ux-guidelines.md) — screens do not invent their own colours.
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'muted';

export const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  muted: 'bg-white text-slate-400 ring-slate-200',
};

/**
 * Green means it went out, red means it needs attention, amber means it is still
 * owed, and the muted tone means nobody has said anything about that network yet.
 */
export function publicationTone(status: PublicationStatus | null): BadgeTone {
  if (status === null) return 'muted';
  switch (status) {
    case 'published':
      return 'success';
    case 'failed':
    case 'not_published':
      return 'danger';
    case 'planned':
    case 'scheduled':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * A pendência is red once its deadline has passed, amber while someone still owes an
 * answer, and green only when it is actually closed out.
 */
export function pendingRequestTone(item: PendingRequest): BadgeTone {
  if (item.status === 'completed') return 'success';
  if (item.status === 'cancelled') return 'muted';
  if (item.isOverdue) return 'danger';
  if (item.isAwaitingRecipient) return 'warning';
  return 'neutral';
}
