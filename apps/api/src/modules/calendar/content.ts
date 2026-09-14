import type { ProductionStatus } from '@prisma/client';

/**
 * Reached its date without being finished or called off. Shared so the calendar, the
 * production summary, the overdue sweep and the dashboards cannot drift apart on what
 * "atrasado" means.
 */
export const OVERDUE_STATUSES: ProductionStatus[] = [
  'planned',
  'awaiting_material',
  'in_production',
  'in_review',
  'approved',
];

/** Waiting on the client to send something — the one state the agency cannot clear. */
export const BLOCKED_ON_CLIENT_STATUS: ProductionStatus = 'awaiting_material';
