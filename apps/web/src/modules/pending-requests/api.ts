import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';
import type { Comment } from '../comments/api';

export type PendingRequestStatus =
  'open' | 'awaiting_client' | 'answered' | 'in_review' | 'completed' | 'cancelled';

export type PendingRequestView =
  'all' | 'created_by_me' | 'awaiting_me' | 'awaiting_others' | 'open' | 'overdue' | 'completed';

export type Priority = 'low' | 'medium' | 'high';

export interface PendingRequest {
  id: string;
  companyId: string;
  projectId: string | null;
  title: string;
  description: string;
  responsibleUserId: string;
  createdById: string | null;
  dueDate: string | null;
  priority: Priority;
  status: PendingRequestStatus;
  createdAt: string;
  updatedAt: string;
  isOverdue: boolean;
  isAwaitingRecipient: boolean;
  isMine: boolean;
}

export interface PendingRequestSummary {
  open: number;
  awaitingClient: number;
  answered: number;
  inReview: number;
  completed: number;
  cancelled: number;
  overdue: number;
  awaitingMe: number;
  total: number;
}

export interface PendingRequestInput {
  companyId: string;
  projectId?: string | null;
  title: string;
  description: string;
  responsibleUserId: string;
  dueDate?: string | null;
  priority: Priority;
}

export const PENDING_REQUEST_STATUSES: PendingRequestStatus[] = [
  'open',
  'awaiting_client',
  'answered',
  'in_review',
  'completed',
  'cancelled',
];

const requestKey = ['pending-requests'] as const;
const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

export interface PendingRequestListParams {
  page: number;
  view: PendingRequestView;
  companyId?: string;
  status?: PendingRequestStatus | 'all';
  priority?: Priority;
  search?: string;
}

export function usePendingRequests(params: PendingRequestListParams, enabled = true) {
  return useQuery({
    queryKey: [...requestKey, 'list', params],
    queryFn: async () => {
      const envelope = await apiEnvelope<PendingRequest[]>(
        `/pending-requests${queryString({
          page: params.page,
          view: params.view,
          companyId: params.companyId,
          status: params.status ?? 'all',
          priority: params.priority,
          search: params.search,
        })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
    enabled,
  });
}

export function usePendingRequest(id: string | undefined) {
  return useQuery({
    queryKey: [...requestKey, 'detail', id],
    queryFn: () => apiRequest<PendingRequest>(`/pending-requests/${id}`),
    enabled: Boolean(id),
  });
}

export function usePendingRequestSummary(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...requestKey, 'summary', companyId],
    queryFn: () =>
      apiRequest<PendingRequestSummary>(`/pending-requests/summary${queryString({ companyId })}`),
    enabled,
  });
}

export function useCreatePendingRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PendingRequestInput) =>
      apiRequest<PendingRequest>('/pending-requests', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: requestKey }),
  });
}

export function useUpdatePendingRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: Partial<PendingRequestInput> & { id: string } & {
      status?: PendingRequestStatus;
    }) => apiRequest<PendingRequest>(`/pending-requests/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: requestKey }),
  });
}

/**
 * A response is one call: the comment and the status change land together, so the
 * thread can never show an answer the request itself has not registered.
 */
export function useRespondToPendingRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; body: string; attachmentFileId?: string | null }) =>
      apiRequest<{ comment: Comment; pendingRequest: PendingRequest }>(
        `/pending-requests/${id}/respond`,
        { method: 'POST', body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: requestKey });
      void queryClient.invalidateQueries({ queryKey: ['comments'] });
    },
  });
}
