import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ApiError, apiRequest } from '../../lib/api';

export interface Membership {
  companyId: string;
  canManageCampaigns: boolean;
  canDeleteCompanyFiles: boolean;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: 'agency_admin' | 'agency_manager' | 'client_manager' | 'contributor';
  mustChangePassword: boolean;
  memberships: Membership[];
  session: {
    id: string;
    expiresAt: string;
    absoluteExpiresAt: string;
    passwordVerifiedAt: string;
  };
}

export const sessionQueryKey = ['auth', 'me'] as const;

export function useCurrentUser(): UseQueryResult<CurrentUser | null, Error> {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      try {
        return await apiRequest<CurrentUser>('/auth/me');
      } catch (error) {
        // Not being signed in is an expected state, not a failure to retry.
        if (error instanceof ApiError && error.isUnauthenticated) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      apiRequest<CurrentUser>('/auth/login', { method: 'POST', body: credentials }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear();
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      apiRequest<void>('/auth/change-password', { method: 'POST', body: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}
