import type { CampaignStatus } from '@prisma/client';

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
