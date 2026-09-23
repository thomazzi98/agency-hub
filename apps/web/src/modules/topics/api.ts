import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';

export type TopicStatus = 'open' | 'awaiting_response' | 'in_review' | 'resolved' | 'cancelled';
export type TopicPriority = 'low' | 'medium' | 'high';
export type TopicView =
  'all' | 'created_by_me' | 'awaiting_me' | 'awaiting_others' | 'open' | 'resolved';

export interface Topic {
  id: string;
  companyId: string;
  title: string;
  initialMessage: string;
  creatorId: string | null;
  responsibleUserId: string;
  relatedType: string | null;
  relatedId: string | null;
  priority: TopicPriority;
  dueDate: string | null;
  status: TopicStatus;
  createdAt: string;
  updatedAt: string;
  _count?: { replies: number };
}

export interface TopicReply {
  id: string;
  authorId: string | null;
  author: { name: string } | null;
  body: string;
  createdAt: string;
}

export interface TopicDetail extends Topic {
  creator: { name: string } | null;
  responsibleUser: { name: string };
  replies: TopicReply[];
}

export interface TopicListParams {
  page: number;
  view: TopicView;
  companyId?: string;
  priority?: TopicPriority;
}

const topicsKey = ['topics'] as const;
const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

export function useTopics(params: TopicListParams) {
  return useQuery({
    queryKey: [...topicsKey, params],
    queryFn: async () => {
      const envelope = await apiEnvelope<Topic[]>(
        `/topics${queryString({
          page: params.page,
          view: params.view,
          companyId: params.companyId,
          priority: params.priority,
        })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
  });
}

export function useTopic(id: string | undefined) {
  return useQuery({
    queryKey: [...topicsKey, 'detail', id],
    queryFn: () => apiRequest<TopicDetail>(`/topics/${id}`),
    enabled: Boolean(id),
  });
}

export interface CreateTopicInput {
  companyId: string;
  title: string;
  initialMessage: string;
  responsibleUserId: string;
  priority: TopicPriority;
  dueDate?: string | null;
}

export function useCreateTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTopicInput) =>
      apiRequest<Topic>('/topics', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: topicsKey }),
  });
}

export function useUpdateTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      status?: TopicStatus;
      priority?: TopicPriority;
      responsibleUserId?: string;
    }) => apiRequest<Topic>(`/topics/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: topicsKey }),
  });
}

export function useReplyToTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiRequest<TopicReply & { topicStatus: TopicStatus }>(`/topics/${id}/replies`, {
        method: 'POST',
        body: { body },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: topicsKey }),
  });
}
