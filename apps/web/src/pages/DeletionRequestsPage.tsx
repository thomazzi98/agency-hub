import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  SelectField,
  Spinner,
  TextField,
} from '../components/ui';
import { strings } from '../lib/strings';
import { useDeletionRequests, useReviewDeletionRequest } from '../modules/files/api';

const statusLabels: Record<string, string> = {
  pending: strings.deletionRequests.statusPending,
  approved: strings.deletionRequests.statusApproved,
  rejected: strings.deletionRequests.statusRejected,
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export default function DeletionRequestsPage() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const requests = useDeletionRequests(status);
  const review = useReviewDeletionRequest();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">{strings.deletionRequests.title}</h1>

      <Card>
        <SelectField
          label={strings.companies.status}
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as 'pending' | 'approved' | 'rejected' | 'all')
          }
          options={[
            { value: 'pending', label: strings.deletionRequests.statusPending },
            { value: 'approved', label: strings.deletionRequests.statusApproved },
            { value: 'rejected', label: strings.deletionRequests.statusRejected },
            { value: 'all', label: strings.common.all },
          ]}
        />
      </Card>

      {review.isError && <Alert tone="error">{review.error.message}</Alert>}
      {requests.isError && (
        <Alert tone="error" onRetry={() => void requests.refetch()}>
          {requests.error.message}
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}

      {requests.isPending && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      )}

      {requests.data && requests.data.rows.length === 0 && (
        <EmptyState
          title={strings.deletionRequests.empty}
          hint={strings.deletionRequests.emptyHint}
        />
      )}

      {requests.data && requests.data.rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {requests.data.rows.map((request) => (
            <li key={request.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">
                    {request.targetType === 'file'
                      ? strings.deletionRequests.targetFile
                      : strings.deletionRequests.targetContent}
                  </span>
                  <Badge tone={request.status === 'pending' ? 'warning' : 'neutral'}>
                    {statusLabels[request.status] ?? request.status}
                  </Badge>
                </div>

                <p className="text-sm text-slate-700">
                  <span className="text-slate-500">{`${strings.deletionRequests.reason}: `}</span>
                  {request.reason}
                </p>
                <p className="text-xs text-slate-500">
                  {`${strings.deletionRequests.requestedAt} ${formatDateTime(request.createdAt)}`}
                </p>

                {request.status === 'pending' && (
                  <div className="flex flex-col gap-3">
                    <TextField
                      label={strings.deletionRequests.reviewNotes}
                      value={notes[request.id] ?? ''}
                      onChange={(event) =>
                        setNotes((previous) => ({ ...previous, [request.id]: event.target.value }))
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="danger"
                        isLoading={review.isPending && review.variables?.id === request.id}
                        onClick={() => {
                          if (!window.confirm(strings.deletionRequests.confirmApprove)) return;
                          review.mutate(
                            {
                              id: request.id,
                              decision: 'approve',
                              reviewNotes: notes[request.id],
                            },
                            { onSuccess: () => setNotice(strings.deletionRequests.approved) },
                          );
                        }}
                      >
                        {strings.deletionRequests.approve}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (!window.confirm(strings.deletionRequests.confirmReject)) return;
                          review.mutate(
                            {
                              id: request.id,
                              decision: 'reject',
                              reviewNotes: notes[request.id],
                            },
                            { onSuccess: () => setNotice(strings.deletionRequests.rejected) },
                          );
                        }}
                      >
                        {strings.deletionRequests.reject}
                      </Button>
                    </div>
                  </div>
                )}

                {request.reviewNotes && request.status !== 'pending' && (
                  <p className="text-sm text-slate-600">
                    <span className="text-slate-500">{`${strings.deletionRequests.reviewNotes}: `}</span>
                    {request.reviewNotes}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
