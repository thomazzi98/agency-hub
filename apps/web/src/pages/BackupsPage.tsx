import { useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
} from '../components/ui';
import { formatDateTime } from '../lib/dates';
import { backupStatusLabel, strings } from '../lib/strings';
import type { BadgeTone } from '../lib/tones';
import { useCurrentUser } from '../modules/auth/session';
import {
  useBackups,
  useReauthenticate,
  useRequestBackup,
  type BackupStatus,
} from '../modules/backups/api';

function statusTone(status: BackupStatus): BadgeTone {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  return 'warning';
}

/**
 * The password prompt the server asks for when the last verification has gone stale.
 * Shown only in response to a `reauthentication_required`, never pre-emptively: the
 * server decides whether the step-up is needed, and the screen reacts
 * (10-authentication-and-sessions.md).
 */
function ReauthenticateDialog({
  onConfirmed,
  onClose,
}: {
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const reauthenticate = useReauthenticate();
  const [password, setPassword] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reauthenticate.isPending || !password) return;
    reauthenticate.mutate(password, { onSuccess: onConfirmed });
  };

  return (
    <Modal title={strings.backups.confirmTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">{strings.backups.confirmHint}</p>
        {reauthenticate.error && <Alert tone="error">{reauthenticate.error.message}</Alert>}

        <TextField
          label={strings.backups.password}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Button type="submit" isLoading={reauthenticate.isPending} disabled={!password}>
          {strings.backups.confirm}
        </Button>
      </form>
    </Modal>
  );
}

export default function BackupsPage() {
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === 'agency_admin';

  const backups = useBackups(isAdmin);
  const request = useRequestBackup();

  const [notice, setNotice] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);

  const trigger = () => {
    setNotice(null);
    request.mutate(undefined, {
      onSuccess: () => {
        setNeedsPassword(false);
        setNotice(strings.backups.requested);
      },
      onError: (error) => {
        // The server is the one that knows whether the step-up is stale.
        if (error.code === 'reauthentication_required') setNeedsPassword(true);
      },
    });
  };

  if (!isAdmin) {
    return <Alert tone="error">{strings.errors.forbidden}</Alert>;
  }

  const running = (backups.data ?? []).some(
    (job) => job.status === 'queued' || job.status === 'processing',
  );

  return (
    <div className="flex flex-col gap-4">
      {needsPassword && (
        <ReauthenticateDialog onConfirmed={trigger} onClose={() => setNeedsPassword(false)} />
      )}

      <h1 className="text-xl font-bold text-slate-900">{strings.backups.title}</h1>

      <Card className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">{strings.backups.explain}</p>
        <Alert tone="info">{strings.backups.retention}</Alert>
        <p className="text-xs text-slate-500">{strings.backups.manual}</p>

        {request.error && request.error.code !== 'reauthentication_required' && (
          <Alert tone="error">{request.error.message}</Alert>
        )}
        {notice && <Alert tone="success">{notice}</Alert>}

        {/* Deliberately not disabled while one is running. The server enforces the
            single-flight rule and answers with a readable 409; disabling the button on
            a status this screen polled seconds ago would leave an admin stuck with no
            way to act if that job never finished. */}
        <Button onClick={trigger} isLoading={request.isPending}>
          {strings.backups.request}
        </Button>
        {running && <p className="text-sm text-slate-500">{strings.backups.running}</p>}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">{strings.backups.history}</h2>

        {backups.isPending && <Spinner className="h-4 w-4" />}
        {backups.error && (
          <Alert tone="error" onRetry={() => void backups.refetch()}>
            {backups.error.message}
          </Alert>
        )}

        {backups.data && backups.data.length === 0 && <EmptyState title={strings.backups.empty} />}

        {backups.data && backups.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {backups.data.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {job.fileName ?? formatDateTime(job.createdAt)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {[
                      formatDateTime(job.createdAt),
                      job.fileSizeBytes ? strings.backups.size(job.fileSizeBytes) : null,
                      job.downloadedAt
                        ? strings.backups.downloadedAt(formatDateTime(job.downloadedAt))
                        : null,
                      job.status === 'completed' && !job.downloadable
                        ? strings.backups.expired
                        : job.expiresAt
                          ? strings.backups.expiresAt(formatDateTime(job.expiresAt))
                          : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {job.errorMessage && <p className="text-xs text-rose-600">{job.errorMessage}</p>}
                </div>

                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(job.status)}>{backupStatusLabel(job.status)}</Badge>
                  {job.downloadable && (
                    <a
                      href={`/api/admin/backups/${job.id}/download`}
                      className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white"
                    >
                      {strings.backups.download}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
