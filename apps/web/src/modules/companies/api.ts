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
  pageSize?: number;
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
        pageSize: params.pageSize,
        status: params.status,
        search: params.search,
      });
      const envelope = await apiEnvelope<Company[]>(`/companies${query}`);
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
  });
}

/** The server's cap on a page (apps/api/src/shared/pagination.ts). */
const MAX_PAGE_SIZE = 100;
/** A backstop against a runaway loop, far past any real agency's client list. */
const MAX_PAGES = 50;

/**
 * Every company the actor can reach, for the selectors that must offer all of them.
 * A single page would silently hide the rest: archived clients count towards it, and an
 * agency past a hundred could simply not pick some of its companies on any screen. So
 * the first page says how many there are and the others are fetched alongside.
 */
export function useAllCompanies() {
  return useQuery({
    queryKey: [...companiesKey, 'all'],
    queryFn: async () => {
      const page = (number: number) =>
        apiEnvelope<Company[]>(
          `/companies${queryString({ page: number, pageSize: MAX_PAGE_SIZE, status: 'all' })}`,
        );

      const first = await page(1);
      const total = first.meta?.total ?? first.data.length;
      const pageCount = Math.min(Math.ceil(total / MAX_PAGE_SIZE), MAX_PAGES);
      const rest = await Promise.all(
        Array.from({ length: Math.max(pageCount - 1, 0) }, (_, index) => page(index + 2)),
      );

      // A company created between two of the requests shifts the pages under them.
      const byId = new Map<string, Company>();
      for (const envelope of [first, ...rest]) {
        for (const company of envelope.data) byId.set(company.id, company);
      }
      const rows = [...byId.values()];
      return { rows, meta: { page: 1, pageSize: rows.length, total } satisfies PageMeta };
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

export interface CompanyMember {
  id: string;
  name: string;
  email: string;
  role: 'agency_admin' | 'agency_manager' | 'client_manager' | 'contributor';
  canManageCampaigns: boolean;
  canDeleteCompanyFiles: boolean;
}

/**
 * Who can be assigned work in a company. Not the admin-only user directory: this is
 * company-scoped and any member of the company may read it.
 */
export function useCompanyMembers(companyId: string | undefined) {
  return useQuery({
    queryKey: [...companiesKey, 'members', companyId],
    queryFn: () => apiRequest<CompanyMember[]>(`/companies/${companyId}/members`),
    enabled: Boolean(companyId),
  });
}
