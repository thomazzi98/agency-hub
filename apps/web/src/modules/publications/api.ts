import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';

export type PublicationNetwork = 'instagram' | 'facebook' | 'tiktok' | 'youtube_shorts';

export type PublicationStatus =
  'not_planned' | 'planned' | 'scheduled' | 'published' | 'not_published' | 'failed' | 'cancelled';

export interface Publication {
  id: string;
  contentId: string;
  network: PublicationNetwork;
  status: PublicationStatus;
  publishedAt: string | null;
  link: string | null;
  responsibleUserId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationWithContent extends Publication {
  content: { id: string; companyId: string; title: string; scheduledAt: string };
}

export interface PublicationInput {
  status: PublicationStatus;
  publishedAt?: string | null;
  link?: string | null;
  responsibleUserId?: string | null;
  notes?: string | null;
}

/** Phase 1's networks, in the order the UI shows them. */
export const NETWORKS: PublicationNetwork[] = ['instagram', 'facebook', 'tiktok', 'youtube_shorts'];

export const PUBLICATION_STATUSES: PublicationStatus[] = [
  'not_planned',
  'planned',
  'scheduled',
  'published',
  'not_published',
  'failed',
  'cancelled',
];

/** Still owed; mirrors the server's own definition. */
export function isPendingPublication(status: PublicationStatus): boolean {
  return status === 'planned' || status === 'scheduled';
}

const publicationKey = ['publications'] as const;
const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

export function usePublications(contentId: string | undefined) {
  return useQuery({
    queryKey: [...publicationKey, 'content', contentId],
    queryFn: () => apiRequest<Publication[]>(`/content/${contentId}/publications`),
    enabled: Boolean(contentId),
  });
}

export interface PublicationListParams {
  page: number;
  companyId?: string;
  network?: PublicationNetwork;
  status?: PublicationStatus | 'all';
  pending?: boolean;
}

export function usePublicationList(params: PublicationListParams, enabled = true) {
  return useQuery({
    queryKey: [...publicationKey, 'list', params],
    queryFn: async () => {
      const envelope = await apiEnvelope<PublicationWithContent[]>(
        `/publications${queryString({
          page: params.page,
          companyId: params.companyId,
          network: params.network,
          status: params.status ?? 'all',
          pending: params.pending ? 'true' : undefined,
        })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
    enabled,
  });
}

/**
 * Register and update are the same call: the record is keyed by content and network,
 * so there is only ever one row to write.
 */
export function useSavePublication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      contentId,
      network,
      ...body
    }: PublicationInput & { contentId: string; network: PublicationNetwork }) =>
      apiRequest<Publication>(`/content/${contentId}/publications/${network}`, {
        method: 'PUT',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: publicationKey });
      // Content rows carry their networks, so the calendar is stale too.
      void queryClient.invalidateQueries({ queryKey: ['content'] });
    },
  });
}

export function useRemovePublication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentId, network }: { contentId: string; network: PublicationNetwork }) =>
      apiRequest<{ id: string }>(`/content/${contentId}/publications/${network}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: publicationKey });
      void queryClient.invalidateQueries({ queryKey: ['content'] });
    },
  });
}
