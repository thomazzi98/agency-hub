import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';

export interface Company {
  id: string;
  name: string;
  logoUrl: string | null;
  segment: string | null;
  responsibleName: string | null;
  email: string | null;
  phone: string | null;
  status: 'active' | 'archived';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyInput {
  name: string;
  segment?: string | null;
  responsibleName?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface CompanyListParams {
  page: number;
  status: 'active' | 'archived' | 'all';
  search?: string;
}

const companiesKey = ['companies'] as const;

const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

/**
 * The list endpoint already returns only what the actor may see, so there is no
 * client-side filtering here to drift out of step with the server's rule.
 */
export function useCompanies(params: CompanyListParams) {
  return useQuery({
    queryKey: [...companiesKey, params],
    queryFn: async () => {
      const query = queryString({
        page: params.page,
        status: params.status,
        search: params.search,
      });
      const envelope = await apiEnvelope<Company[]>(`/companies${query}`);
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: [...companiesKey, 'detail', id],
    queryFn: () => apiRequest<Company>(`/companies/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CompanyInput) =>
      apiRequest<Company>('/companies', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: companiesKey }),
  });
}

export function useUpdateCompany(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CompanyInput>) =>
      apiRequest<Company>(`/companies/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: companiesKey }),
  });
}

export function useSetCompanyStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (next: 'archive' | 'restore') =>
      apiRequest<Company>(`/companies/${id}/${next}`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: companiesKey }),
  });
}
