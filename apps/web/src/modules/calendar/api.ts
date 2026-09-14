import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';

export type ContentType =
  'video' | 'image' | 'carousel' | 'story' | 'reels' | 'youtube_short' | 'text' | 'custom';

export type ProductionStatus =
  | 'planned'
  | 'awaiting_material'
  | 'in_production'
  | 'in_review'
  | 'approved'
  | 'completed'
  | 'cancelled';

export type ContentPriority = 'low' | 'medium' | 'high';

export interface Content {
  id: string;
  companyId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  type: ContentType;
  scheduledAt: string;
  responsibleUserId: string | null;
  relatedFileId: string | null;
  productionStatus: ProductionStatus;
  priority: ContentPriority;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  isToday: boolean;
  isOverdue: boolean;
  isBlockedOnClient: boolean;
}

export interface ContentSummary {
  planned: number;
  awaitingMaterial: number;
  inProduction: number;
  inReview: number;
  approved: number;
  completed: number;
  cancelled: number;
  overdue: number;
  total: number;
}

export interface ContentInput {
  companyId?: string;
  title: string;
  description?: string | null;
  type: ContentType;
  scheduledAt: string;
  responsibleUserId?: string | null;
  productionStatus: ProductionStatus;
  priority: ContentPriority;
  notes?: string | null;
}

const contentKey = ['content'] as const;
const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

/** The calendar asks for a window, so this returns everything inside it, unpaginated. */
export function useCalendarRange(params: {
  companyId?: string;
  from: string;
  to: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [...contentKey, 'calendar', params.companyId, params.from, params.to],
    queryFn: () =>
      apiRequest<Content[]>(
        `/content/calendar${queryString({
          companyId: params.companyId,
          from: params.from,
          to: params.to,
        })}`,
      ),
    enabled: params.enabled ?? true,
  });
}

export interface ContentListParams {
  page: number;
  companyId?: string;
  productionStatus?: ProductionStatus | 'all';
  responsibleUserId?: string;
  flag?: 'today' | 'overdue' | 'blocked';
  search?: string;
}

export function useContentList(params: ContentListParams, enabled = true) {
  return useQuery({
    queryKey: [...contentKey, 'list', params],
    queryFn: async () => {
      const envelope = await apiEnvelope<Content[]>(
        `/content${queryString({
          page: params.page,
          companyId: params.companyId,
          productionStatus: params.productionStatus ?? 'all',
          responsibleUserId: params.responsibleUserId,
          flag: params.flag,
          search: params.search,
        })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
    enabled,
  });
}

export function useContentSummary(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...contentKey, 'summary', companyId],
    queryFn: () => apiRequest<ContentSummary>(`/content/summary${queryString({ companyId })}`),
    enabled,
  });
}

export function useCreateContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ContentInput) =>
      apiRequest<Content>('/content', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKey }),
  });
}

export function useUpdateContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<ContentInput> & { id: string }) =>
      apiRequest<Content>(`/content/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKey }),
  });
}

export function useDuplicateContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduledAt }: { id: string; scheduledAt: string }) =>
      apiRequest<Content>(`/content/${id}/duplicate`, { method: 'POST', body: { scheduledAt } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKey }),
  });
}

export function useDeleteContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ id: string }>(`/content/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKey }),
  });
}
