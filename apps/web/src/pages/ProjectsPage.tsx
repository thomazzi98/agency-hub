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
import { formatDateOnly } from '../lib/dates';
import { projectStatusLabel, projectTypeLabel, strings } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import { useProjects, type ProjectListParams, type ProjectStatus } from '../modules/projects/api';

const statusOptions = [
  { value: 'all', label: strings.common.all },
  ...(['planned', 'active', 'paused', 'completed', 'archived'] as const).map((status) => ({
    value: status,
    label: projectStatusLabel(status),
  })),
];

function formatPeriod(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) return strings.projects.noPeriod;
  if (startDate && endDate) return `${formatDateOnly(startDate)} – ${formatDateOnly(endDate)}`;
  return formatDateOnly((startDate ?? endDate)!);
}

export default function ProjectsPage() {
  const { data: currentUser } = useCurrentUser();
  const canManage = currentUser?.role === 'agency_admin' || currentUser?.role === 'agency_manager';

  const [params, setParams] = useState<ProjectListParams>({ page: 1, status: 'all' });
  const [searchDraft, setSearchDraft] = useState('');

  const projects = useProjects(params);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{strings.projects.title}</h1>
        {canManage && (
          <Link to="/projetos/novo">
            <Button>{strings.projects.new}</Button>
          </Link>
        )}
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
              placeholder={strings.projects.searchPlaceholder}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>
          <SelectField
            label={strings.projects.status}
            value={params.status}
            onChange={(event) =>
              setParams((previous) => ({
                ...previous,
                page: 1,
                status: event.target.value as ProjectStatus | 'all',
              }))
            }
            options={statusOptions}
          />
          <Button type="submit" variant="secondary">
            {strings.common.search}
          </Button>
        </form>
      </Card>

      {projects.isError && (
        <Alert tone="error" onRetry={() => void projects.refetch()}>
          {projects.error.message}
        </Alert>
      )}

      {projects.isPending && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      )}

      {projects.data && projects.data.rows.length === 0 && (
        <EmptyState
          title={strings.projects.empty}
          hint={canManage ? strings.projects.emptyHint : strings.projects.emptyReadOnlyHint}
          action={
            canManage ? (
              <Link to="/projetos/novo">
                <Button>{strings.projects.new}</Button>
              </Link>
            ) : undefined
          }
        />
      )}

      {projects.data && projects.data.rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {projects.data.rows.map((project) => (
              <li key={project.id}>
                <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-slate-900">{project.name}</p>
                      <Badge tone={project.status === 'active' ? 'success' : 'neutral'}>
                        {projectStatusLabel(project.status)}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {[
                        projectTypeLabel(project.type),
                        project.code,
                        formatPeriod(project.startDate, project.endDate),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  {canManage && (
                    <Link to={`/projetos/${project.id}`}>
                      <Button variant="secondary">{strings.common.edit}</Button>
                    </Link>
                  )}
                </Card>
              </li>
            ))}
          </ul>

          <Pagination
            page={projects.data.meta.page}
            pageSize={projects.data.meta.pageSize}
            total={projects.data.meta.total}
            onPageChange={(page) => setParams((previous) => ({ ...previous, page }))}
          />
        </>
      )}
    </div>
  );
}
