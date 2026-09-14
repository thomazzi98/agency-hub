import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';

export interface Notification {
  id: string;
  companyId: string | null;
  type: string;
  title: string;
  message: string;
  actorId: string | null;
  relatedType: string | null;
  relatedId: string | null;
  readAt: string | null;
  createdAt: string;
  /** Where opening it goes — built on the server so every channel agrees. */
  link: string;
}

export interface NotificationPreference {
  eventType: string;
  channel: 'push';
  enabled: boolean;
  isDefault: boolean;
}

export interface PushDevice {
  id: string;
  fingerprint: string;
  userAgent: string | null;
  enabled: boolean;
  createdAt: string;
  lastSeenAt: string;
}

const notificationKey = ['notifications'] as const;
const preferencesKey = [...notificationKey, 'preferences'] as const;
const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

/** Polled while the app is open; the badge is the only thing that reads it. */
export function useUnreadCount() {
  return useQuery({
    queryKey: [...notificationKey, 'unread-count'],
    queryFn: () => apiRequest<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useNotifications(params: { page: number; unreadOnly: boolean }, enabled = true) {
  return useQuery({
    queryKey: [...notificationKey, 'list', params],
    queryFn: async () => {
      const envelope = await apiEnvelope<Notification[]>(
        `/notifications${queryString({
          page: params.page,
          unreadOnly: params.unreadOnly ? 'true' : undefined,
        })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
    enabled,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<Notification & { alreadyRead: boolean }>(`/notifications/${id}/read`, {
        method: 'POST',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKey }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ markedRead: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKey }),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: preferencesKey,
    queryFn: () => apiRequest<NotificationPreference[]>('/notifications/preferences'),
  });
}

/**
 * Applied to the cache before the request goes out, and rolled back if it fails.
 *
 * Without this the checkbox visibly snaps back to its old state and only corrects
 * itself once the refetch lands — which reads as "my click did nothing" on a slow
 * connection, and is exactly what a toggle must never do.
 */
export function useSetNotificationPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { eventType: string; enabled: boolean }) =>
      apiRequest<NotificationPreference>('/notifications/preferences', {
        method: 'PUT',
        body: { ...input, channel: 'push' },
      }),
    // Synchronous on purpose: React re-renders the controlled checkbox as soon as the
    // click handler returns, so an `await` here would let it snap back to the old
    // value for a frame before the optimistic value landed.
    onMutate: (input) => {
      void queryClient.cancelQueries({ queryKey: preferencesKey });
      const previous = queryClient.getQueryData<NotificationPreference[]>(preferencesKey);

      queryClient.setQueryData<NotificationPreference[]>(preferencesKey, (rows) =>
        (rows ?? []).map((row) =>
          row.eventType === input.eventType
            ? { ...row, enabled: input.enabled, isDefault: false }
            : row,
        ),
      );

      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(preferencesKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: preferencesKey }),
  });
}

export function usePushConfig() {
  return useQuery({
    queryKey: ['push', 'config'],
    queryFn: () => apiRequest<{ enabled: boolean; publicKey: string | null }>('/push/config'),
    staleTime: Infinity,
  });
}

export function usePushDevices(enabled = true) {
  return useQuery({
    queryKey: ['push', 'devices'],
    queryFn: () => apiRequest<PushDevice[]>('/push/devices'),
    enabled,
  });
}

export function useRegisterPushDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      endpoint: string;
      p256dhKey: string;
      authKey: string;
      userAgent?: string | null;
    }) => apiRequest<{ id: string }>('/push/devices', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['push', 'devices'] }),
  });
}

export function useRevokePushDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ id: string }>(`/push/devices/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['push', 'devices'] }),
  });
}
