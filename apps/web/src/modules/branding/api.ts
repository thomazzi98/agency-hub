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
