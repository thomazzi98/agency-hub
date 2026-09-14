import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Spinner } from '../components/ui';
import { apiRequest } from '../lib/api';
import { strings } from '../lib/strings';

interface SessionSummary {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

const sessionsQueryKey = ['sessions'] as const;

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export default function SessionsPage() {
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: sessionsQueryKey,
    queryFn: () => apiRequest<SessionSummary[]>('/sessions'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: sessionsQueryKey });

  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const revokeAll = useMutation({
    mutationFn: () =>
      apiRequest<{ revokedCount: number }>('/sessions/revoke-all', {
        method: 'POST',
        body: {},
      }),
    onSuccess: invalidate,
  });

  const others = (sessions.data ?? []).filter((session) => !session.isCurrent);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">{strings.sessions.title}</h1>

      {sessions.isError && (
        <Alert tone="error" onRetry={() => void sessions.refetch()}>
          {sessions.error.message}
        </Alert>
      )}
      {(revoke.isError || revokeAll.isError) && (
        <Alert tone="error">{(revoke.error ?? revokeAll.error)?.message}</Alert>
      )}
      {revokeAll.isSuccess && (
        <Alert tone="success">{`${revokeAll.data.revokedCount} sessão(ões) encerrada(s).`}</Alert>
      )}

      {sessions.isPending ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {(sessions.data ?? []).map((session) => (
            <li key={session.id}>
              <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {session.userAgent ?? session.ipAddress ?? session.id}
                  </p>
                  <p className="text-xs text-slate-500">
                    {`${strings.sessions.lastActive}: ${formatDateTime(session.lastActiveAt)}`}
                  </p>
                </div>

                {session.isCurrent ? (
                  <span className="self-start rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                    {strings.sessions.current}
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    isLoading={revoke.isPending && revoke.variables === session.id}
                    loadingLabel={strings.sessions.revoking}
                    onClick={() => {
                      if (window.confirm(strings.sessions.confirmRevoke)) {
                        revoke.mutate(session.id);
                      }
                    }}
                  >
                    {strings.sessions.revoke}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {!sessions.isPending && others.length === 0 && (
        <p className="text-sm text-slate-500">{strings.sessions.empty}</p>
      )}

      {others.length > 0 && (
        <Button
          variant="danger"
          isLoading={revokeAll.isPending}
          onClick={() => {
            if (window.confirm(strings.sessions.confirmRevokeAll)) {
              revokeAll.mutate();
            }
          }}
        >
          {strings.sessions.revokeAll}
        </Button>
      )}
    </div>
  );
}
