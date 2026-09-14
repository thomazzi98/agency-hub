import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, LoadingScreen, TextAreaField } from '../components/ui';
import { strings, topicPriorityLabel, topicStatusLabel } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import { useReplyToTopic, useTopic, useUpdateTopic } from '../modules/topics/api';

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export default function TopicDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();

  const topic = useTopic(id);
  const reply = useReplyToTopic();
  const update = useUpdateTopic();

  const [body, setBody] = useState('');

  if (topic.isPending) return <LoadingScreen />;
  if (topic.isError) return <Alert tone="error">{topic.error.message}</Alert>;
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
        <p className="text-xs text-slate-500">{formatDateTime(data.createdAt)}</p>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-slate-900">{strings.topics.thread}</h2>

        {data.replies.length === 0 ? (
          <p className="text-sm text-slate-500">{strings.topics.noReplies}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.replies.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm whitespace-pre-wrap text-slate-800">{item.body}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {formatDateTime(item.createdAt)}
                  {item.authorId === currentUser?.id && ` · ${strings.topics.you}`}
                </p>
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
