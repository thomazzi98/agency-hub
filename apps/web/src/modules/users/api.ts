import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';

export type Role = 'agency_admin' | 'agency_manager' | 'client_manager' | 'contributor';

export interface Membership {
  id: string;
  userId: string;
  companyId: string;
  status: 'active' | 'revoked';
  canManageCampaigns: boolean;
  canDeleteCompanyFiles: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'inactive';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  memberships: Membership[];
}

export interface CreatedUser extends ManagedUser {
  /** Returned only by the create call, and only once. */
  temporaryPassword: string;
}

export interface UserListParams {
  page: number;
  role?: Role | '';
  status: 'active' | 'inactive' | 'all';
  search?: string;
}

const usersKey = ['users'] as const;
const membershipsKey = ['memberships'] as const;
const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: [...usersKey, params],
    queryFn: async () => {
      const envelope = await apiEnvelope<ManagedUser[]>(
        `/users${queryString({
          page: params.page,
          role: params.role || undefined,
          status: params.status,
          search: params.search,
        })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: [...usersKey, 'detail', id],
    queryFn: () => apiRequest<ManagedUser>(`/users/${id}`),
    enabled: Boolean(id),
  });
}

export interface CreateUserInput {
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'inactive';
  initialPassword?: string;
  memberships: { companyId: string; canManageCampaigns: boolean; canDeleteCompanyFiles: boolean }[];
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      apiRequest<CreatedUser>('/users', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useUpdateUser(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Omit<CreateUserInput, 'memberships' | 'initialPassword'>>) =>
      apiRequest<ManagedUser>(`/users/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useResetUserPassword(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ temporaryPassword: string }>(`/users/${id}/reset-password`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useGrantMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      userId: string;
      companyId: string;
      canManageCampaigns: boolean;
      canDeleteCompanyFiles: boolean;
    }) => apiRequest<Membership>('/memberships', { method: 'POST', body: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: usersKey });
      await queryClient.invalidateQueries({ queryKey: membershipsKey });
    },
  });
}

export function useUpdateMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      canManageCampaigns?: boolean;
      canDeleteCompanyFiles?: boolean;
    }) => apiRequest<Membership>(`/memberships/${id}`, { method: 'PATCH', body: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: usersKey });
      await queryClient.invalidateQueries({ queryKey: membershipsKey });
    },
  });
}

export function useRevokeMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<Membership>(`/memberships/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: usersKey });
      await queryClient.invalidateQueries({ queryKey: membershipsKey });
    },
  });
}
