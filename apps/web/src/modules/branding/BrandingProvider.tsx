import { useEffect, type ReactNode } from 'react';
import { mix } from '../../lib/color';
import { fallbackBranding, useBranding, type Branding } from './api';
import { BrandingContext } from './context';

/**
 * The brand is applied by overriding the CSS custom properties Tailwind's utilities
 * already read, so an admin's colour change lands everywhere at once without a
 * rebuild or a second styling pathway to keep in step.
 */
function applyTheme(branding: Branding): void {
  const root = document.documentElement;
  const shades: [string, string][] = [
    ['--color-brand-50', mix(branding.primaryColor, '#ffffff', 0.94)],
    ['--color-brand-100', mix(branding.primaryColor, '#ffffff', 0.86)],
    ['--color-brand-500', mix(branding.primaryColor, '#ffffff', 0.12)],
    ['--color-brand-600', branding.primaryColor],
    ['--color-brand-700', mix(branding.primaryColor, '#000000', 0.18)],
    ['--color-brand-secondary', branding.secondaryColor],
  ];

  for (const [token, value] of shades) {
    root.style.setProperty(token, value);
  }

  document.title = branding.appName;

  if (branding.faviconUrl) {
    const link =
      document.querySelector<HTMLLinkElement>("link[rel='icon']") ??
      document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
    link.href = branding.faviconUrl;
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data } = useBranding();
  const branding = data ?? fallbackBranding;

  useEffect(() => {
    applyTheme(branding);
  }, [branding]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
