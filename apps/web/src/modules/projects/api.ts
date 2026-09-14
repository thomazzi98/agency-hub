import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEnvelope, apiRequest, queryString, type PageMeta } from '../../lib/api';

export type ProjectType =
  'property' | 'product' | 'service' | 'event' | 'campaign' | 'internal' | 'other';

export type ProjectStatus = 'planned' | 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  type: ProjectType;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
}

export interface ProjectInput {
  companyId?: string;
  name: string;
  code?: string | null;
  type: ProjectType;
  description?: string | null;
  status: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

export interface ProjectListParams {
  page: number;
  companyId?: string;
  status: ProjectStatus | 'all';
  search?: string;
}

const projectsKey = ['projects'] as const;
const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0 };

export function useProjects(params: ProjectListParams) {
  return useQuery({
    queryKey: [...projectsKey, params],
    queryFn: async () => {
      const envelope = await apiEnvelope<Project[]>(
        `/projects${queryString({
          page: params.page,
          companyId: params.companyId,
          status: params.status,
          search: params.search,
        })}`,
      );
      return { rows: envelope.data, meta: envelope.meta ?? emptyMeta };
    },
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: [...projectsKey, 'detail', id],
    queryFn: () => apiRequest<Project>(`/projects/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectInput) =>
      apiRequest<Project>('/projects', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectsKey }),
  });
}

export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ProjectInput>) =>
      apiRequest<Project>(`/projects/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectsKey }),
  });
}
