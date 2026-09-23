import type { CampaignStatus, Prisma, UserRole } from '@prisma/client';

/**
 * Who sees which campaigns (09-campaign-management.md#permissions,
 * 06-permissions-and-authorization.md): the agency sees every campaign of its
 * companies, a `client_manager` only the ones the agency marked visible, and a
 * `contributor` none at all - a campaign's budget and spend are the client's business
 * figures, not something a freelancer delivering material needs.
 *
 * Applied as a `where` clause rather than filtered afterwards, so a campaign someone
 * may not see is never sent to their browser. The list, the detail, the dashboard
 * count and the notifications all read this one rule.
 */
export function campaignVisibilityScope(actor: { role: UserRole }): Prisma.CampaignWhereInput {
  switch (actor.role) {
    case 'agency_admin':
    case 'agency_manager':
      return {};
    case 'client_manager':
      return { visibleToClient: true };
    default:
      // Deny by default: a role this function does not know sees nothing.
      return { id: { in: [] } };
  }
}

/** The roles a campaign event may be told to, given whether the client can see it. */
export function campaignAudienceRoles(visibleToClient: boolean): UserRole[] {
  return visibleToClient
    ? ['agency_admin', 'agency_manager', 'client_manager']
    : ['agency_admin', 'agency_manager'];
}

/**
 * Statuses that mean a person has to look at this campaign. All three are set by a
 * human — nothing in Phase 1 derives them from live metrics
 * (09-campaign-management.md#explicitly-not-in-phase-1).
 */
export const CAMPAIGN_ATTENTION_STATUSES: CampaignStatus[] = [
  'with_problem',
  'needs_attention',
  'awaiting_approval',
];

/**
 * The fields whose changes are worth a history row. `updated_at` is not one of them:
 * it changes on every write and would drown the timeline it is meant to explain.
 */
export const TRACKED_FIELDS = [
  'name',
  'objective',
  'status',
  'adAccountId',
  'platform',
  'dailyBudget',
  'totalBudget',
  'reportedSpend',
  'reportedBalance',
  'lastCheckedAt',
  'visibleToClient',
  'responsibleUserId',
  'notes',
] as const;

export const campaignSelect = {
  id: true,
  companyId: true,
  adAccountId: true,
  platform: true,
  name: true,
  objective: true,
  status: true,
  dailyBudget: true,
  totalBudget: true,
  reportedSpend: true,
  reportedBalance: true,
  lastCheckedAt: true,
  visibleToClient: true,
  responsibleUserId: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
} as const;
