import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, LoadingScreen, TextAreaField } from '../components/ui';
import { formatDateOnly, formatDateTime } from '../lib/dates';
import { strings, topicPriorityLabel, topicStatusLabel } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import { useReplyToTopic, useTopic, useUpdateTopic } from '../modules/topics/api';

export default function TopicDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();

  const topic = useTopic(id);
  const reply = useReplyToTopic();
  const update = useUpdateTopic();

  const [body, setBody] = useState('');

  if (topic.isPending) return <LoadingScreen />;
  if (topic.isError) {
    return (
      <Alert tone="error" onRetry={() => void topic.refetch()}>
        {topic.error.message}
      </Alert>
    );
  }
  if (!topic.data) return <Alert tone="error">{strings.errors.not_found}</Alert>;

  const data = topic.data;
  const isCreator = data.creatorId === currentUser?.id;
  const isResponsible = data.responsibleUserId === currentUser?.id;
  const isClosed = data.status === 'resolved' || data.status === 'cancelled';
  const canResolve = isCreator || currentUser?.role === 'agency_admin';

  const handleReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reply.isPending || !body.trim() || !id) return;

    reply.mutate(
      { id, body: body.trim() },
      {
        onSuccess: () => {
          setBody('');
          void topic.refetch();
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-slate-900">{data.title}</h1>
        <Button variant="secondary" onClick={() => navigate('/topicos')}>
          {strings.common.back}
        </Button>
      </div>

      {(reply.isError || update.isError) && (
        <Alert tone="error">{(reply.error ?? update.error)?.message}</Alert>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={data.status === 'resolved' ? 'success' : 'neutral'}>
            {topicStatusLabel(data.status)}
          </Badge>
          <Badge tone={data.priority === 'high' ? 'warning' : 'neutral'}>
            {topicPriorityLabel(data.priority)}
          </Badge>
          {isResponsible && !isClosed && (
            <Badge tone="warning">{strings.topics.youAreResponsible}</Badge>
          )}
        </div>

        <p className="text-sm whitespace-pre-wrap text-slate-800">{data.initialMessage}</p>

        {/* The two people this conversation is between. */}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">{strings.topics.createdBy}</dt>
            <dd className="text-slate-900">
              {data.creator?.name ?? strings.comments.unknownAuthor}
              {isCreator && ` (${strings.topics.you})`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{strings.topics.responsible}</dt>
            <dd className="text-slate-900">
              {data.responsibleUser.name}
              {isResponsible && ` (${strings.topics.you})`}
            </dd>
          </div>
          {data.dueDate && (
            <div>
              <dt className="text-xs text-slate-500">{strings.topics.dueDate}</dt>
              <dd className="text-slate-900">{formatDateOnly(data.dueDate)}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-slate-500">{strings.topics.openedAt}</dt>
            <dd className="text-slate-900">{formatDateTime(data.createdAt)}</dd>
          </div>
        </dl>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-slate-900">{strings.topics.thread}</h2>

        {data.replies.length === 0 ? (
          <p className="text-sm text-slate-500">{strings.topics.noReplies}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.replies.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold text-slate-700">
                  {item.authorId === currentUser?.id
                    ? strings.comments.you
                    : (item.author?.name ?? strings.comments.unknownAuthor)}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-slate-800">{item.body}</p>
                <p className="mt-2 text-xs text-slate-500">{formatDateTime(item.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}

        {isClosed ? (
          <Alert tone="info">{strings.topics.closed}</Alert>
        ) : (
          <form onSubmit={handleReply} className="flex flex-col gap-3">
            <TextAreaField
              label={strings.topics.yourReply}
              rows={3}
              maxLength={5000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" isLoading={reply.isPending} disabled={!body.trim()}>
                {strings.topics.send}
              </Button>

              {canResolve && (
                <Button
                  type="button"
                  variant="secondary"
                  isLoading={update.isPending}
                  onClick={() => {
                    if (!window.confirm(strings.topics.confirmResolve) || !id) return;
                    update.mutate(
                      { id, status: 'resolved' },
                      { onSuccess: () => void topic.refetch() },
                    );
                  }}
                >
                  {strings.topics.resolve}
                </Button>
              )}
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
