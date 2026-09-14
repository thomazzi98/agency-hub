import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';

export interface Branding {
  appName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  loginImageUrl: string | null;
  loginMessage: string | null;
  updatedAt: string;
}

export type BrandingInput = Partial<Omit<Branding, 'updatedAt'>>;

export const brandingQueryKey = ['branding'] as const;

export const fallbackBranding: Branding = {
  appName: 'Agency Hub',
  primaryColor: '#1d4ed8',
  secondaryColor: '#0f172a',
  logoUrl: null,
  faviconUrl: null,
  loginImageUrl: null,
  loginMessage: null,
  updatedAt: '',
};

/**
 * Branding changes rarely and is needed before authentication, so it is cached hard
 * (17-performance-requirements.md#caching) and never blocks a screen: a failed fetch
 * falls back to the built-in brand rather than showing an error page.
 */
export function useBranding() {
  return useQuery({
    queryKey: brandingQueryKey,
    queryFn: () => apiRequest<Branding>('/branding'),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

export type BrandingAssetKind = 'logo' | 'favicon' | 'loginImage';

/**
 * These few small images are posted to the API rather than sent straight to storage:
 * the login screen needs a stable, public URL for them, and storage objects are
 * private and reachable only through short-lived signed URLs.
 */
export function useUploadBrandingAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ kind, file }: { kind: BrandingAssetKind; file: File }) => {
      const form = new FormData();
      form.append('file', file);

      const response = await fetch(`/api/branding/assets/${kind}`, {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      const payload = (await response.json()) as { data: Branding } | { error: { code: string } };

      if (!response.ok || 'error' in payload) {
        const { ApiError } = await import('../../lib/api');
        throw new ApiError(
          response.status,
          'error' in payload ? payload.error.code : 'internal_error',
        );
      }
      return payload.data;
    },
    onSuccess: (branding) => {
      queryClient.setQueryData(brandingQueryKey, branding);
    },
  });
}

export function useUpdateBranding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: BrandingInput) =>
      apiRequest<Branding>('/branding', { method: 'PATCH', body: input }),
    onSuccess: (branding) => {
      queryClient.setQueryData(brandingQueryKey, branding);
    },
  });
}
