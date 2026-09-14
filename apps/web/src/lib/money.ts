import { strings } from './strings';

/**
 * A figure somebody typed, shown the way Brazil reads money. The value arrives as a
 * string from a `numeric` column and is only parsed here, for display — nothing in the
 * app does arithmetic on it (09-campaign-management.md).
 */
export function money(value: string | null): string {
  if (value === null) return strings.campaigns.noValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
