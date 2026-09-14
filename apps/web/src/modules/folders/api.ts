import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, queryString } from '../../lib/api';

export interface Folder {
  id: string;
  companyId: string;
  projectId: string | null;
  parentFolderId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  _count?: { children: number };
}

export interface FolderListParams {
  companyId?: string;
  projectId?: string;
  /** `root` lists top-level folders; a uuid lists that folder's children. */
  parentFolderId?: string | 'root';
}

const foldersKey = ['folders'] as const;

export function useFolders(params: FolderListParams, enabled = true) {
  return useQuery({
    queryKey: [...foldersKey, params],
    queryFn: () =>
      apiRequest<Folder[]>(
        `/folders${queryString({
          companyId: params.companyId,
          projectId: params.projectId,
          parentFolderId: params.parentFolderId,
        })}`,
      ),
    enabled,
  });
}

export function useFolder(id: string | undefined) {
  return useQuery({
    queryKey: [...foldersKey, 'detail', id],
    queryFn: () => apiRequest<Folder>(`/folders/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      companyId: string;
      name: string;
      parentFolderId?: string | null;
      projectId?: string | null;
    }) => apiRequest<Folder>('/folders', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foldersKey }),
  });
}

export function useRenameFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest<Folder>(`/folders/${id}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foldersKey }),
  });
}

export function useDeleteFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ id: string }>(`/folders/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foldersKey }),
  });
}
