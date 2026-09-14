import { useEffect, useMemo, useRef } from 'react';
import { Alert, SelectField } from './ui';
import { strings } from '../lib/strings';
import { useAllCompanies } from '../modules/companies/api';

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
  const companies = useAllCompanies();
  // Memoized so the effect below does not see a new array identity every render.
  const rows = useMemo(() => companies.data?.rows ?? [], [companies.data]);

  /**
   * The default is chosen once, and never after a person has chosen for themselves.
   *
   * The ref is set in the change handler rather than during render, which is the whole
   * point: a selection made before the mount effect has flushed would otherwise be
   * overwritten by the default a moment later, and the screen would silently snap back
   * to the first company. Marking it synchronously in the handler closes that window,
   * because an effect can only ever run after the handler has returned.
   *
   * Caught by an E2E run that selected a company faster than React flushed the effect.
   */
  const hasChosen = useRef(false);

  const choose = (companyId: string) => {
    hasChosen.current = true;
    onChange(companyId);
  };

  useEffect(() => {
    if (hasChosen.current || rows.length === 0) return;
    hasChosen.current = true;
    onChange(rows[0]!.id);
  }, [rows, onChange]);

  // Text buried in a disabled <option> is invisible to a screen reader and to anyone
  // who does not open the dropdown, so the empty case gets its own visible message.
  if (!companies.isPending && rows.length === 0) {
    return <Alert tone="info">{strings.folders.noCompanies}</Alert>;
  }

  return (
    <SelectField
      label={label}
      value={value}
      onChange={(event) => choose(event.target.value)}
      options={rows.map((company) => ({ value: company.id, label: company.name }))}
    />
  );
}
