import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Pagination,
  Spinner,
} from '../components/ui';
import { PushSettings } from '../components/PushSettings';
import { formatDateTime } from '../lib/dates';
import { notificationTypeLabel, strings } from '../lib/strings';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '../modules/notifications/api';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useNotifications({ page, unreadOnly });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  /**
   * Opening navigates and marks read in one action
   * (08-notifications-and-push.md#readunread-behavior) — the destination comes from
   * the server, so the client never has to know how a resource maps to a route.
   */
  const open = (id: string, link: string) => {
    markRead.mutate(id, { onSuccess: () => navigate(link) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{strings.notifications.title}</h1>
        <Button
          variant="secondary"
          isLoading={markAll.isPending}
          onClick={() =>
            markAll.mutate(undefined, { onSuccess: () => setNotice(strings.notifications.allRead) })
          }
        >
          {strings.notifications.markAllRead}
        </Button>
      </div>

      <Card>
        <Checkbox
          label={strings.notifications.unreadOnly}
          checked={unreadOnly}
          onChange={(event) => {
            setUnreadOnly(event.target.checked);
            setPage(1);
          }}
        />
      </Card>

      {/* A failed load can be retried; a rejected mutation cannot — see FilesPage. */}
      {list.error && (
        <Alert tone="error" onRetry={() => void list.refetch()}>
          {list.error.message}
        </Alert>
      )}
      {(markRead.error ?? markAll.error) && (
        <Alert tone="error">{(markRead.error ?? markAll.error)!.message}</Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}

      {list.isPending && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      )}

      {list.data && list.data.rows.length === 0 && (
        <EmptyState
          title={unreadOnly ? strings.notifications.emptyUnread : strings.notifications.empty}
        />
      )}

      {list.data && list.data.rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.rows.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item.id, item.link)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    item.readAt
                      ? 'border-slate-200 bg-white'
                      : 'border-brand-200 bg-brand-50/60 hover:border-brand-300'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 font-medium text-slate-900">{item.title}</span>
                    {!item.readAt && (
                      <Badge tone="warning">{notificationTypeLabel(item.type)}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{item.message}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(item.createdAt)}</p>
                </button>
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

      <PushSettings />
    </div>
  );
}
