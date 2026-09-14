import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CompanySelect } from '../components/CompanySelect';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Pagination,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
} from '../components/ui';
import { formatDate } from '../lib/dates';
import { pendingRequestTone } from '../lib/tones';
import {
  pendingRequestEmptyLabel,
  pendingRequestStatusLabel,
  strings,
  topicPriorityLabel,
} from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import { useCompanyMembers } from '../modules/companies/api';
import { useProjects } from '../modules/projects/api';
import {
  PENDING_REQUEST_STATUSES,
  useCreatePendingRequest,
  usePendingRequestSummary,
  usePendingRequests,
  type PendingRequestStatus,
  type PendingRequestView,
  type Priority,
} from '../modules/pending-requests/api';

const views: PendingRequestView[] = [
  'all',
  'awaiting_me',
  'created_by_me',
  'open',
  'overdue',
  'completed',
];

const statusOptions = [
  { value: 'all', label: strings.common.all },
  ...PENDING_REQUEST_STATUSES.map((value) => ({
    value,
    label: pendingRequestStatusLabel(value),
  })),
];

const priorities: Priority[] = ['low', 'medium', 'high'];

function NewRequestDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const create = useCreatePendingRequest();
  const members = useCompanyMembers(companyId);
  const projects = useProjects({ page: 1, companyId, status: 'all' });

  const [form, setForm] = useState({
    title: '',
    description: '',
    responsibleUserId: '',
    projectId: '',
    dueDate: '',
    priority: 'medium' as Priority,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;

    create.mutate(
      {
        companyId,
        title: form.title.trim(),
        description: form.description.trim(),
        responsibleUserId: form.responsibleUserId,
        projectId: form.projectId || null,
        dueDate: form.dueDate || null,
        priority: form.priority,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title={strings.pendingRequests.new} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {create.error && <Alert tone="error">{create.error.message}</Alert>}

        <TextField
          label={strings.pendingRequests.titleField}
          required
          maxLength={200}
          value={form.title}
          onChange={(event) => setForm((p) => ({ ...p, title: event.target.value }))}
        />

        <TextAreaField
          label={strings.pendingRequests.description}
          required
          rows={3}
          maxLength={5000}
          value={form.description}
          onChange={(event) => setForm((p) => ({ ...p, description: event.target.value }))}
        />

        <SelectField
          label={strings.pendingRequests.responsible}
          required
          value={form.responsibleUserId}
          onChange={(event) => setForm((p) => ({ ...p, responsibleUserId: event.target.value }))}
          options={[
            { value: '', label: strings.common.select },
            ...(members.data ?? []).map((member) => ({ value: member.id, label: member.name })),
          ]}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={strings.pendingRequests.dueDate}
            type="date"
            value={form.dueDate}
            onChange={(event) => setForm((p) => ({ ...p, dueDate: event.target.value }))}
          />
          <SelectField
            label={strings.pendingRequests.priority}
            value={form.priority}
            onChange={(event) =>
              setForm((p) => ({ ...p, priority: event.target.value as Priority }))
            }
            options={priorities.map((value) => ({ value, label: topicPriorityLabel(value) }))}
          />
        </div>

        <SelectField
          label={strings.pendingRequests.project}
          value={form.projectId}
          onChange={(event) => setForm((p) => ({ ...p, projectId: event.target.value }))}
          options={[
            { value: '', label: strings.common.none },
            ...(projects.data?.rows ?? []).map((project) => ({
              value: project.id,
              label: project.name,
            })),
          ]}
        />

        <Button
          type="submit"
          isLoading={create.isPending}
          disabled={!form.title.trim() || !form.description.trim() || !form.responsibleUserId}
        >
          {strings.pendingRequests.create}
        </Button>
      </form>
    </Modal>
  );
}

export default function PendingRequestsPage() {
  const { data: currentUser } = useCurrentUser();
  const canCreate = currentUser?.role === 'agency_admin' || currentUser?.role === 'agency_manager';

  const [companyId, setCompanyId] = useState('');
  const [view, setView] = useState<PendingRequestView>('awaiting_me');
  const [status, setStatus] = useState<PendingRequestStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const list = usePendingRequests(
    { page, view, companyId: companyId || undefined, status },
    Boolean(companyId),
  );
  const summary = usePendingRequestSummary(companyId || undefined, Boolean(companyId));

  return (
    <div className="flex flex-col gap-4">
      {creating && companyId && (
        <NewRequestDialog companyId={companyId} onClose={() => setCreating(false)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{strings.pendingRequests.title}</h1>
        {canCreate && companyId && (
          <Button onClick={() => setCreating(true)}>{strings.pendingRequests.new}</Button>
        )}
      </div>

      <Card>
        <CompanySelect
          value={companyId}
          onChange={(next) => {
            setCompanyId(next);
            setPage(1);
          }}
        />
      </Card>

      {list.error && <Alert tone="error">{list.error.message}</Alert>}

      {companyId && summary.data && (
        <Card className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {[
            [strings.pendingRequests.summary.awaitingMe, summary.data.awaitingMe],
            [strings.pendingRequests.summary.open, summary.data.open],
            [strings.pendingRequests.summary.awaitingClient, summary.data.awaitingClient],
            [strings.pendingRequests.summary.answered, summary.data.answered],
            [strings.pendingRequests.summary.overdue, summary.data.overdue],
          ].map(([label, value]) => (
            <div key={label as string}>
              <p className="text-xs text-slate-500">{label}</p>
              <p className="font-semibold text-slate-900">{value}</p>
            </div>
          ))}
        </Card>
      )}

      {companyId && (
        <>
          <nav
            aria-label={strings.pendingRequests.title}
            className="-mx-1 flex gap-1 overflow-x-auto px-1"
          >
            {views.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => {
                  setView(option);
                  setPage(1);
                }}
                className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition ${
                  view === option
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {strings.pendingRequests.views[option]}
              </button>
            ))}
          </nav>

          <Card>
            <SelectField
              label={strings.pendingRequests.status}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as PendingRequestStatus | 'all');
                setPage(1);
              }}
              options={statusOptions}
            />
          </Card>

          {list.isPending && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" />
              {strings.app.loading}
            </div>
          )}

          {list.data && list.data.rows.length === 0 && (
            <EmptyState title={pendingRequestEmptyLabel(view)} />
          )}

          {list.data && list.data.rows.length > 0 && (
            <>
              <ul className="flex flex-col gap-3">
                {list.data.rows.map((item) => (
                  <li key={item.id}>
                    <Card className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            to={`/pendencias/${item.id}`}
                            className="truncate font-medium text-slate-900 underline-offset-2 hover:underline"
                          >
                            {item.title}
                          </Link>
                          <p className="text-xs text-slate-500">
                            {item.dueDate
                              ? strings.pendingRequests.dueOn(formatDate(item.dueDate))
                              : strings.pendingRequests.noDueDate}
                            {' · '}
                            {topicPriorityLabel(item.priority)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {item.isOverdue && (
                            <Badge tone="danger">{strings.pendingRequests.overdue}</Badge>
                          )}
                          {item.isMine && item.isAwaitingRecipient && (
                            <Badge tone="warning">{strings.pendingRequests.awaitingYou}</Badge>
                          )}
                          <Badge tone={pendingRequestTone(item)}>
                            {pendingRequestStatusLabel(item.status)}
                          </Badge>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>

              <Pagination
                page={list.data.meta.page}
                pageSize={list.data.meta.pageSize}
                total={list.data.meta.total}
                onPageChange={setPage}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
