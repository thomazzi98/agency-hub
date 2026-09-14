import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Pagination,
  SelectField,
  Spinner,
  TextField,
} from '../components/ui';
import { strings } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import { useCompanies, type CompanyListParams } from '../modules/companies/api';

export default function CompaniesPage() {
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === 'agency_admin';

  const [params, setParams] = useState<CompanyListParams>({ page: 1, status: 'active' });
  const [searchDraft, setSearchDraft] = useState('');

  const companies = useCompanies(params);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{strings.companies.title}</h1>
        {isAdmin && (
          <Link to="/empresas/nova" className="sm:w-auto">
            <Button>{strings.companies.new}</Button>
          </Link>
        )}
      </div>

      <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <form
          className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setParams((previous) => ({ ...previous, page: 1, search: searchDraft.trim() }));
          }}
        >
          <div className="flex-1">
            <TextField
              label={strings.common.search}
              placeholder={strings.companies.searchPlaceholder}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>
          <SelectField
            label={strings.companies.status}
            value={params.status}
            onChange={(event) =>
              setParams((previous) => ({
                ...previous,
                page: 1,
                status: event.target.value as CompanyListParams['status'],
              }))
            }
            options={[
              { value: 'active', label: strings.companies.statusActive },
              { value: 'archived', label: strings.companies.statusArchived },
              { value: 'all', label: strings.common.all },
            ]}
          />
          <Button type="submit" variant="secondary">
            {strings.common.search}
          </Button>
        </form>
      </Card>

      {companies.isError && (
        <Alert tone="error" onRetry={() => void companies.refetch()}>
          {companies.error.message}
        </Alert>
      )}

      {companies.isPending && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      )}

      {companies.data && companies.data.rows.length === 0 && (
        <EmptyState
          title={strings.companies.empty}
          hint={isAdmin ? strings.companies.emptyAdminHint : strings.companies.emptyMemberHint}
          action={
            isAdmin ? (
              <Link to="/empresas/nova">
                <Button>{strings.companies.new}</Button>
              </Link>
            ) : undefined
          }
        />
      )}

      {companies.data && companies.data.rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {companies.data.rows.map((company) => (
              <li key={company.id}>
                <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-slate-900">{company.name}</p>
                      <Badge tone={company.status === 'active' ? 'success' : 'neutral'}>
                        {company.status === 'active'
                          ? strings.companies.statusActive
                          : strings.companies.statusArchived}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {[company.segment, company.responsibleName].filter(Boolean).join(' · ') ||
                        strings.common.none}
                    </p>
                  </div>

                  {isAdmin && (
                    <Link to={`/empresas/${company.id}`}>
                      <Button variant="secondary">{strings.common.edit}</Button>
                    </Link>
                  )}
                </Card>
              </li>
            ))}
          </ul>

          <Pagination
            page={companies.data.meta.page}
            pageSize={companies.data.meta.pageSize}
            total={companies.data.meta.total}
            onPageChange={(page) => setParams((previous) => ({ ...previous, page }))}
          />
        </>
      )}
    </div>
  );
}
