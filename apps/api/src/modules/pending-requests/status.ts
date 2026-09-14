import type { PendingRequestStatus } from '@prisma/client';

/** Still needs something from someone. */
export const UNFINISHED_STATUSES: PendingRequestStatus[] = [
  'open',
  'awaiting_client',
  'answered',
  'in_review',
];

/** Specifically waiting on the person it was addressed to. */
export const AWAITING_RECIPIENT_STATUSES: PendingRequestStatus[] = ['open', 'awaiting_client'];
