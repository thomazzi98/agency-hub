import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';

export type CommentableType = 'company' | 'project' | 'file' | 'content' | 'pending_request';

export interface Comment {
  id: string;
  companyId: string;
  commentableType: CommentableType;
  commentableId: string;
  authorId: string | null;
  /** Null once the author's account is gone. */
  author: { id: string; name: string } | null;
  body: string;
  attachmentFileId: string | null;
  /** The file a reply carried - a pending request answered with the material, say. */
  attachment: { id: string; originalName: string; sizeBytes: number; removed: boolean } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommentTarget {
  commentableType: CommentableType;
  commentableId: string;
}

const commentsKey = ['comments'] as const;
const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

export function useComments(target: CommentTarget, enabled = true) {
  return useQuery({
    queryKey: [...commentsKey, target],
    queryFn: async () => {
      const envelope = await apiEnvelope<Comment[]>(
        `/comments${queryString({
          commentableType: target.commentableType,
          commentableId: target.commentableId,
          pageSize: 100,
        })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
    enabled,
  });
}

export function useCreateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CommentTarget & { body: string; attachmentFileId?: string | null }) =>
      apiRequest<Comment>('/comments', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: commentsKey }),
  });
}

export function useUpdateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiRequest<Comment>(`/comments/${id}`, { method: 'PATCH', body: { body } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: commentsKey }),
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ id: string }>(`/comments/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: commentsKey }),
  });
}
