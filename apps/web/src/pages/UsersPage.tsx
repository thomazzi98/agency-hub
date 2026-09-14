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
import { roleLabel, strings } from '../lib/strings';
import { useUsers, type Role, type UserListParams } from '../modules/users/api';

const roleOptions = [
  { value: '', label: strings.common.all },
  { value: 'agency_admin', label: roleLabel('agency_admin') },
  { value: 'agency_manager', label: roleLabel('agency_manager') },
  { value: 'client_manager', label: roleLabel('client_manager') },
  { value: 'contributor', label: roleLabel('contributor') },
];

export default function UsersPage() {
  const [params, setParams] = useState<UserListParams>({ page: 1, status: 'all', role: '' });
  const [searchDraft, setSearchDraft] = useState('');

  const users = useUsers(params);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{strings.users.title}</h1>
        <Link to="/usuarios/novo">
          <Button>{strings.users.new}</Button>
        </Link>
      </div>

      <Card>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setParams((previous) => ({ ...previous, page: 1, search: searchDraft.trim() }));
          }}
        >
          <div className="flex-1">
            <TextField
              label={strings.common.search}
              placeholder={strings.users.searchPlaceholder}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>
          <SelectField
            label={strings.users.role}
            value={params.role ?? ''}
            onChange={(event) =>
              setParams((previous) => ({
                ...previous,
                page: 1,
                role: event.target.value as Role | '',
              }))
            }
            options={roleOptions}
          />
          <SelectField
            label={strings.users.status}
            value={params.status}
            onChange={(event) =>
              setParams((previous) => ({
                ...previous,
                page: 1,
                status: event.target.value as UserListParams['status'],
              }))
            }
            options={[
              { value: 'all', label: strings.common.all },
              { value: 'active', label: strings.users.statusActive },
              { value: 'inactive', label: strings.users.statusInactive },
            ]}
          />
          <Button type="submit" variant="secondary">
            {strings.common.search}
          </Button>
        </form>
      </Card>

      {users.isError && (
        <Alert tone="error" onRetry={() => void users.refetch()}>
          {users.error.message}
        </Alert>
      )}

      {users.isPending && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      )}

      {users.data && users.data.rows.length === 0 && (
        <EmptyState
          title={strings.users.empty}
          hint={strings.users.emptyHint}
          action={
            <Link to="/usuarios/novo">
              <Button>{strings.users.new}</Button>
            </Link>
          }
        />
      )}

      {users.data && users.data.rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {users.data.rows.map((user) => (
              <li key={user.id}>
                <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-slate-900">{user.name}</p>
                      <Badge tone={user.status === 'active' ? 'success' : 'neutral'}>
                        {user.status === 'active'
                          ? strings.users.statusActive
                          : strings.users.statusInactive}
                      </Badge>
                      {user.mustChangePassword && (
                        <Badge tone="warning">{strings.users.mustChangePassword}</Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {`${user.email} · ${roleLabel(user.role)} · ${
                        user.memberships.filter((m) => m.status === 'active').length
                      } empresa(s)`}
                    </p>
                  </div>

                  <Link to={`/usuarios/${user.id}`}>
                    <Button variant="secondary">{strings.common.edit}</Button>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>

          <Pagination
            page={users.data.meta.page}
            pageSize={users.data.meta.pageSize}
            total={users.data.meta.total}
            onPageChange={(page) => setParams((previous) => ({ ...previous, page }))}
          />
        </>
      )}
    </div>
  );
}
