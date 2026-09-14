import { useEffect, useMemo } from 'react';
import { Alert, SelectField } from './ui';
import { strings } from '../lib/strings';
import { useCompanies } from '../modules/companies/api';

/**
 * Screens scoped to one company share this control. It only ever lists companies the
 * actor already has access to, because that is all the API returns — there is no
 * client-side filter here that could drift from the server's rule.
 */
export function CompanySelect({
  value,
  onChange,
  label = strings.projects.company,
}: {
  value: string;
  onChange: (companyId: string) => void;
  label?: string;
}) {
  const companies = useCompanies({ page: 1, status: 'all' });
  // Memoized so the effect below does not see a new array identity every render.
  const rows = useMemo(() => companies.data?.rows ?? [], [companies.data]);

  useEffect(() => {
    if (!value && rows.length > 0) {
      onChange(rows[0]!.id);
    }
  }, [value, rows, onChange]);

  // Text buried in a disabled <option> is invisible to a screen reader and to anyone
  // who does not open the dropdown, so the empty case gets its own visible message.
  if (!companies.isPending && rows.length === 0) {
    return <Alert tone="info">{strings.folders.noCompanies}</Alert>;
  }

  return (
    <SelectField
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={rows.map((company) => ({ value: company.id, label: company.name }))}
    />
  );
}
