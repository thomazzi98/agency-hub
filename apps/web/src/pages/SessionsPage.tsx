import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Spinner } from '../components/ui';
import { apiRequest } from '../lib/api';
import { formatDateTime } from '../lib/dates';
import { describeDevice } from '../lib/device';
import { strings } from '../lib/strings';
import { CHANGE_PASSWORD_PATH } from '../routes/ProtectedRoute';

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

  const revokeAllButton = (
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
  );

  return (
    <div className="flex flex-col gap-4">
      {/* The bulk action sits beside the heading rather than below the list: on a
          phone, a list of a dozen sessions pushes a footer button off-screen. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{strings.sessions.title}</h1>
        {others.length > 0 && revokeAllButton}
      </div>

      {sessions.isError && (
        <Alert tone="error" onRetry={() => void sessions.refetch()}>
          {sessions.error.message}
        </Alert>
      )}
      {(revoke.isError || revokeAll.isError) && (
        <Alert tone="error">{(revoke.error ?? revokeAll.error)?.message}</Alert>
      )}
      {revokeAll.isSuccess && (
        <Alert tone="success">{strings.sessions.revokedCount(revokeAll.data.revokedCount)}</Alert>
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
                  <p
                    className="truncate text-sm font-medium text-slate-900"
                    title={session.userAgent ?? undefined}
                  >
                    {describeDevice(session.userAgent) ??
                      session.userAgent ??
                      session.ipAddress ??
                      session.id}
                  </p>
                  <p className="text-xs text-slate-500">
                    {[
                      `${strings.sessions.lastActive}: ${formatDateTime(session.lastActiveAt)}`,
                      session.ipAddress ? `IP ${session.ipAddress}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
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

      {/* Account security lives together: the sessions, and the password behind them. */}
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {strings.sessions.passwordTitle}
          </h2>
          <p className="text-sm text-slate-500">{strings.sessions.passwordHint}</p>
        </div>
        <Link
          to={CHANGE_PASSWORD_PATH}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
        >
          {strings.sessions.changePassword}
        </Link>
      </Card>
    </div>
  );
}
