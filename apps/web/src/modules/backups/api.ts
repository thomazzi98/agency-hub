import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, type ApiError } from '../../lib/api';

export type BackupStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface BackupJob {
  id: string;
  status: BackupStatus;
  fileName: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  requestedById: string | null;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  downloadedAt: string | null;
  createdAt: string;
  /** Whether the file is still on disk. The server decides, not the status alone. */
  downloadable: boolean;
}

const backupKey = ['backups'] as const;

/**
 * Polled while anything is still running: the dump happens in the worker, so the only
 * way this screen learns it finished is by asking. It stops asking once nothing is in
 * flight, rather than polling an idle page forever.
 */
export function useBackups(enabled = true) {
  return useQuery({
    queryKey: backupKey,
    queryFn: () => apiRequest<BackupJob[]>('/admin/backups'),
    enabled,
    refetchInterval: (query) => {
      const rows = query.state.data;
      const running = rows?.some((job) => job.status === 'queued' || job.status === 'processing');
      return running ? 3_000 : false;
    },
  });
}

/**
 * Typed with `ApiError` so the caller can read `code`: this is the one mutation whose
 * failure is sometimes an instruction ("confirm your password") rather than a problem.
 */
export function useRequestBackup() {
  const queryClient = useQueryClient();
  return useMutation<BackupJob, ApiError, void>({
    mutationFn: () => apiRequest<BackupJob>('/admin/backups', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupKey }),
  });
}

export function useReauthenticate() {
  return useMutation({
    mutationFn: (password: string) =>
      apiRequest<null>('/auth/reauthenticate', { method: 'POST', body: { password } }),
  });
}
