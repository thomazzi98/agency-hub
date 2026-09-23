import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';

export type FileStatus =
  'received' | 'in_review' | 'editing' | 'edit_complete' | 'approved' | 'archived';

export interface StoredFile {
  id: string;
  companyId: string;
  projectId: string | null;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  uploadedById: string | null;
  uploadedAt: string;
  deletedAt: string | null;
}

export interface FileListParams {
  page: number;
  companyId?: string;
  folderId?: string | 'root';
  status?: FileStatus | 'all';
  search?: string;
}

export interface DeletionRequest {
  id: string;
  companyId: string;
  targetType: 'file' | 'content';
  targetId: string;
  requestedById: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

/** A request as the review queue lists it: with what it is about, and who is involved. */
export interface DeletionRequestListItem extends DeletionRequest {
  company: { name: string };
  requestedBy: { name: string } | null;
  reviewedBy: { name: string } | null;
  /** The file's name or the content's title; null when the item no longer exists. */
  targetLabel: string | null;
  /** Already gone - its uploader removed it while the request waited, or approved. */
  targetRemoved: boolean;
}

const filesKey = ['files'] as const;
const deletionRequestsKey = ['deletion-requests'] as const;
const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

export function useFiles(params: FileListParams, enabled = true) {
  return useQuery({
    queryKey: [...filesKey, params],
    queryFn: async () => {
      const envelope = await apiEnvelope<StoredFile[]>(
        `/files${queryString({
          page: params.page,
          companyId: params.companyId,
          folderId: params.folderId,
          status: params.status ?? 'all',
          search: params.search,
        })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
    enabled,
  });
}

export function useUpdateFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: FileStatus; folderId?: string | null }) =>
      apiRequest<StoredFile>(`/files/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: filesKey }),
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ id: string }>(`/files/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: filesKey }),
  });
}

/**
 * The signed URL is fetched on demand and used immediately: it is short-lived by
 * design, so holding one in component state would just let it go stale.
 */
export async function fetchDownloadUrl(id: string): Promise<string> {
  const result = await apiRequest<{ url: string }>(`/files/${id}/download`);
  return result.url;
}

/**
 * Downloads one file. The signed URL is navigated to rather than opened in a new
 * window: it answers with `Content-Disposition: attachment`, so the browser saves the
 * file and the page stays where it is - while a window opened after an await is exactly
 * what a phone's pop-up blocker swallows without a word. Either way the bytes come
 * straight from storage, never through this application. Rejects, for the caller to
 * show, when the link cannot be had.
 */
export async function startDownload(id: string): Promise<void> {
  window.location.assign(await fetchDownloadUrl(id));
}

export function useRequestDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { targetId: string; reason: string }) =>
      apiRequest<DeletionRequest>('/deletion-requests', {
        method: 'POST',
        body: { targetType: 'file', targetId: input.targetId, reason: input.reason },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: deletionRequestsKey }),
  });
}

export function useDeletionRequests(
  status: 'pending' | 'approved' | 'rejected' | 'all',
  page: number,
) {
  return useQuery({
    queryKey: [...deletionRequestsKey, status, page],
    queryFn: async () => {
      const envelope = await apiEnvelope<DeletionRequestListItem[]>(
        `/deletion-requests${queryString({ status, page })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
  });
}

export function useReviewDeletionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      reviewNotes,
    }: {
      id: string;
      decision: 'approve' | 'reject';
      reviewNotes?: string;
    }) =>
      apiRequest<DeletionRequest>(`/deletion-requests/${id}/${decision}`, {
        method: 'POST',
        body: { reviewNotes: reviewNotes?.trim() || null },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deletionRequestsKey });
      await queryClient.invalidateQueries({ queryKey: filesKey });
    },
  });
}
