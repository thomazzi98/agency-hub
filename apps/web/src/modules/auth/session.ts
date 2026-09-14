import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
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
/** Why the sign-in screen is being shown, when the session ended while the app was open. */
const sessionLostKey = ['auth', 'session-lost'] as const;

/**
 * Wired into the query client's caches, so *any* request answering that the session
 * is gone — a list loading, a form saving — hands the person back to sign-in at once.
 * Without this the screen they were on keeps its navigation and shows a retry button
 * that can never succeed, and the cached `/auth/me` keeps every route guard convinced
 * they are still signed in until a full reload.
 */
export function handleSessionLost(queryClient: QueryClient, error: unknown): void {
  if (!(error instanceof ApiError) || !error.isSessionLost) return;
  // Nobody was signed in on this tab, so there is no session to have lost.
  if (!queryClient.getQueryData(sessionQueryKey)) return;

  queryClient.setQueryData(sessionQueryKey, null);
  queryClient.setQueryData(sessionLostKey, error.message);
  // Whoever signs in next must not be served the previous person's cached rows. The
  // brand is public and stays, so the sign-in screen does not flash to the default.
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== 'auth' && query.queryKey[0] !== 'branding',
  });
}

export function useSessionLostMessage(): string | null {
  const { data } = useQuery({
    queryKey: sessionLostKey,
    queryFn: () => null as string | null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? null;
}

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
      queryClient.setQueryData(sessionLostKey, null);
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
