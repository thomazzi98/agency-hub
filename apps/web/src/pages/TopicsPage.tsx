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
import { formatDateOnly } from '../lib/dates';
import { strings, topicEmptyLabel, topicPriorityLabel, topicStatusLabel } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import { useCompanyMembers } from '../modules/companies/api';
import {
  useCreateTopic,
  useTopics,
  type TopicPriority,
  type TopicView,
} from '../modules/topics/api';

const views: { value: TopicView; label: string }[] = [
  { value: 'awaiting_me', label: strings.topics.views.awaiting_me },
  { value: 'awaiting_others', label: strings.topics.views.awaiting_others },
  { value: 'created_by_me', label: strings.topics.views.created_by_me },
  { value: 'open', label: strings.topics.views.open },
  { value: 'resolved', label: strings.topics.views.resolved },
  { value: 'all', label: strings.topics.views.all },
];

const priorities: TopicPriority[] = ['low', 'medium', 'high'];

function NewTopicDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateTopic();
  const [companyId, setCompanyId] = useState('');
  const [form, setForm] = useState({
    title: '',
    initialMessage: '',
    responsibleUserId: '',
    priority: 'medium' as TopicPriority,
    dueDate: '',
  });

  // Only people who actually have access to the chosen company can be made responsible;
  // the server refuses anyone else, so offering them would be a dead end.
  const candidates = useCompanyMembers(companyId || undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;

    create.mutate(
      {
        companyId,
        title: form.title.trim(),
        initialMessage: form.initialMessage.trim(),
        responsibleUserId: form.responsibleUserId,
        priority: form.priority,
        dueDate: form.dueDate || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title={strings.topics.newTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {create.isError && <Alert tone="error">{create.error.message}</Alert>}

        <CompanySelect value={companyId} onChange={setCompanyId} />

        <TextField
          label={strings.topics.titleField}
          required
          maxLength={200}
          value={form.title}
          onChange={(event) => setForm((p) => ({ ...p, title: event.target.value }))}
        />
        <TextAreaField
          label={strings.topics.initialMessage}
          rows={3}
          value={form.initialMessage}
          onChange={(event) => setForm((p) => ({ ...p, initialMessage: event.target.value }))}
        />
        <SelectField
          label={strings.topics.responsible}
          value={form.responsibleUserId}
          onChange={(event) => setForm((p) => ({ ...p, responsibleUserId: event.target.value }))}
          options={[
            { value: '', label: strings.common.none },
            ...(candidates.data ?? []).map((user) => ({
              value: user.id,
              label: `${user.name} (${user.email})`,
            })),
          ]}
        />
        <SelectField
          label={strings.topics.priority}
          value={form.priority}
          onChange={(event) =>
            setForm((p) => ({ ...p, priority: event.target.value as TopicPriority }))
          }
          options={priorities.map((value) => ({ value, label: topicPriorityLabel(value) }))}
        />
        <TextField
          label={strings.topics.dueDate}
          type="date"
          value={form.dueDate}
          onChange={(event) => setForm((p) => ({ ...p, dueDate: event.target.value }))}
        />

        <Button
          type="submit"
          isLoading={create.isPending}
          disabled={!companyId || !form.title.trim() || !form.responsibleUserId}
        >
          {strings.topics.create}
        </Button>
      </form>
    </Modal>
  );
}

export default function TopicsPage() {
  const { data: currentUser } = useCurrentUser();
  const canCreate = currentUser?.role === 'agency_admin' || currentUser?.role === 'agency_manager';

  const [view, setView] = useState<TopicView>('awaiting_me');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const topics = useTopics({ page, view });

  return (
    <div className="flex flex-col gap-4">
      {creating && <NewTopicDialog onClose={() => setCreating(false)} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{strings.topics.title}</h1>
        {canCreate && <Button onClick={() => setCreating(true)}>{strings.topics.new}</Button>}
      </div>

      {/* The views the spec requires, as a filter strip rather than a dropdown: on a
          phone this is the primary way in, and one tap beats two. */}
      <nav aria-label={strings.topics.viewsLabel} className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {views.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={view === option.value}
            onClick={() => {
              setView(option.value);
              setPage(1);
            }}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition ${
              view === option.value
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {topics.isError && (
        <Alert tone="error" onRetry={() => void topics.refetch()}>
          {topics.error.message}
        </Alert>
      )}

      {topics.isPending && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      )}

      {topics.data && topics.data.rows.length === 0 && (
        <EmptyState
          title={topicEmptyLabel(view)}
          hint={canCreate ? strings.topics.emptyHint : undefined}
          action={
            canCreate ? (
              <Button onClick={() => setCreating(true)}>{strings.topics.new}</Button>
            ) : undefined
          }
        />
      )}

      {topics.data && topics.data.rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {topics.data.rows.map((topic) => (
              <li key={topic.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link
                      to={`/topicos/${topic.id}`}
                      className="min-w-0 flex-1 truncate font-medium text-slate-900 underline-offset-2 hover:underline"
                    >
                      {topic.title}
                    </Link>
                    <Badge
                      tone={
                        topic.status === 'resolved'
                          ? 'success'
                          : topic.priority === 'high'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {topicStatusLabel(topic.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {[
                      topicPriorityLabel(topic.priority),
                      topic.dueDate
                        ? `${strings.topics.dueDate}: ${formatDateOnly(topic.dueDate)}`
                        : null,
                      strings.topics.replyCount(topic._count?.replies ?? 0),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </Card>
              </li>
            ))}
          </ul>

          <Pagination
            page={topics.data.meta.page}
            pageSize={topics.data.meta.pageSize}
            total={topics.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
