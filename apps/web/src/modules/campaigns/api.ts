import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';

export type AdPlatform = 'meta' | 'tiktok';
export type AdAccountStatus = 'active' | 'paused' | 'closed';

export type CampaignStatus =
  'active' | 'paused' | 'ended' | 'with_problem' | 'awaiting_approval' | 'needs_attention';

export interface AdAccount {
  id: string;
  companyId: string;
  platform: AdPlatform;
  name: string;
  externalAccountId: string | null;
  status: AdAccountStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
}

/**
 * Money arrives as a string: these are `numeric` columns, and turning them into a JS
 * float to render them would be the one place a reported figure could quietly change.
 */
export interface Campaign {
  id: string;
  companyId: string;
  adAccountId: string;
  platform: AdPlatform;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  dailyBudget: string | null;
  totalBudget: string | null;
  reportedSpend: string | null;
  reportedBalance: string | null;
  lastCheckedAt: string | null;
  visibleToClient: boolean;
  responsibleUserId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
}

export interface CampaignHistoryEntry {
  id: string;
  changedById: string | null;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  createdAt: string;
}

export interface CampaignDetail extends Campaign {
  history: CampaignHistoryEntry[];
}

export const AD_PLATFORMS: AdPlatform[] = ['meta', 'tiktok'];
export const AD_ACCOUNT_STATUSES: AdAccountStatus[] = ['active', 'paused', 'closed'];
export const CAMPAIGN_STATUSES: CampaignStatus[] = [
  'active',
  'paused',
  'ended',
  'with_problem',
  'awaiting_approval',
  'needs_attention',
];

/** Mirrors the server's own list, so the badge and the filter agree. */
export const CAMPAIGN_ATTENTION_STATUSES: CampaignStatus[] = [
  'with_problem',
  'needs_attention',
  'awaiting_approval',
];

export interface CampaignInput {
  companyId?: string;
  adAccountId?: string;
  name?: string;
  objective?: string | null;
  status?: CampaignStatus;
  dailyBudget?: number | null;
  totalBudget?: number | null;
  reportedSpend?: number | null;
  reportedBalance?: number | null;
  lastCheckedAt?: string | null;
  visibleToClient?: boolean;
  responsibleUserId?: string | null;
  notes?: string | null;
  changeNote?: string | null;
}

const campaignKey = ['campaigns'] as const;
const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

export function useAdAccounts(companyId: string | undefined) {
  return useQuery({
    queryKey: ['ad-accounts', companyId],
    queryFn: async () => {
      const envelope = await apiEnvelope<AdAccount[]>(
        `/ad-accounts${queryString({ companyId, pageSize: 100 })}`,
      );
      return envelope.data;
    },
    enabled: Boolean(companyId),
  });
}

export function useCreateAdAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      companyId: string;
      platform: AdPlatform;
      name: string;
      externalAccountId?: string | null;
      notes?: string | null;
    }) => apiRequest<AdAccount>('/ad-accounts', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ad-accounts'] }),
  });
}

export interface CampaignListParams {
  page: number;
  companyId?: string;
  status?: CampaignStatus | 'all';
  needsAttention?: boolean;
  search?: string;
}

export function useCampaigns(params: CampaignListParams, enabled = true) {
  return useQuery({
    queryKey: [...campaignKey, 'list', params],
    queryFn: async () => {
      const envelope = await apiEnvelope<Campaign[]>(
        `/campaigns${queryString({
          page: params.page,
          companyId: params.companyId,
          status: params.status ?? 'all',
          needsAttention: params.needsAttention ? 'true' : undefined,
          search: params.search,
        })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
    enabled,
  });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: [...campaignKey, 'detail', id],
    queryFn: () => apiRequest<CampaignDetail>(`/campaigns/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CampaignInput) =>
      apiRequest<Campaign>('/campaigns', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKey }),
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CampaignInput & { id: string }) =>
      apiRequest<Campaign & { changedFields: string[] }>(`/campaigns/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignKey });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
