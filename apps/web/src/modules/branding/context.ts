import { createContext, useContext } from 'react';
import { fallbackBranding, type Branding } from './api';

export const BrandingContext = createContext<Branding>(fallbackBranding);

export function useBrand(): Branding {
  return useContext(BrandingContext);
}
