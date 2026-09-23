import { useEffect, useState } from 'react';
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
import { formatDateTime } from '../lib/dates';
import { strings } from '../lib/strings';
import {
  startDownload,
  useDeletionRequests,
  useReviewDeletionRequest,
  type DeletionRequestListItem,
} from '../modules/files/api';

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

const statusLabels: Record<string, string> = {
  pending: strings.deletionRequests.statusPending,
  approved: strings.deletionRequests.statusApproved,
  rejected: strings.deletionRequests.statusRejected,
};

/**
 * What is being deleted, where, and at whose request. The queue used to say "Arquivo"
 * and a reason, so an approval was a decision about an item the reviewer could not see.
 */
function RequestSummary({ request }: { request: DeletionRequestListItem }) {
  const kind =
    request.targetType === 'file'
      ? strings.deletionRequests.targetFile
      : strings.deletionRequests.targetContent;

  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500">{kind}</p>
      <p className="truncate text-sm font-medium text-slate-900">
        {request.targetLabel ?? strings.deletionRequests.unknownTarget}
      </p>
      <p className="text-xs text-slate-500">
        {[
          `${strings.deletionRequests.company}: ${request.company.name}`,
          `${strings.deletionRequests.requestedBy}: ${
            request.requestedBy?.name ?? strings.comments.unknownAuthor
          }`,
        ].join(' · ')}
      </p>
    </div>
  );
}

export default function DeletionRequestsPage() {
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const requests = useDeletionRequests(status, page);
  const review = useReviewDeletionRequest();

  // Deciding the last request on a later page leaves that page empty; step back rather
  // than claim there is nothing left to review.
  const emptiedPage = requests.data?.rows.length === 0 && page > 1;
  useEffect(() => {
    if (emptiedPage) setPage((current) => Math.max(1, current - 1));
  }, [emptiedPage]);

  const decide = (request: DeletionRequestListItem, decision: 'approve' | 'reject') => {
    const question =
      decision === 'approve'
        ? strings.deletionRequests.confirmApprove
        : strings.deletionRequests.confirmReject;
    if (!window.confirm(question)) return;

    setNotice(null);
    review.mutate(
      { id: request.id, decision, reviewNotes: notes[request.id] },
      {
        onSuccess: () =>
          setNotice(
            decision === 'approve'
              ? strings.deletionRequests.approved
              : strings.deletionRequests.rejected,
          ),
      },
    );
  };

  const download = (request: DeletionRequestListItem) => {
    setDownloadError(null);
    setDownloadingId(request.id);
    startDownload(request.targetId)
      .catch((error: unknown) =>
        setDownloadError(error instanceof Error ? error.message : strings.app.genericError),
      )
      .finally(() => setDownloadingId(null));
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">{strings.deletionRequests.title}</h1>

      <Card>
        <SelectField
          label={strings.companies.status}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter);
            setPage(1);
          }}
          options={[
            { value: 'pending', label: strings.deletionRequests.statusPending },
            { value: 'approved', label: strings.deletionRequests.statusApproved },
            { value: 'rejected', label: strings.deletionRequests.statusRejected },
            { value: 'all', label: strings.common.all },
          ]}
        />
      </Card>

      {review.isError && <Alert tone="error">{review.error.message}</Alert>}
      {downloadError && <Alert tone="error">{downloadError}</Alert>}
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
        <>
          <ul className="flex flex-col gap-3">
            {requests.data.rows.map((request) => (
              <li key={request.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <RequestSummary request={request} />
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

                  {request.status === 'pending' && request.targetRemoved && (
                    <Alert tone="info">{strings.deletionRequests.targetGone}</Alert>
                  )}

                  {request.status === 'pending' && (
                    <div className="flex flex-col gap-3">
                      <TextField
                        label={strings.deletionRequests.reviewNotes}
                        maxLength={1000}
                        value={notes[request.id] ?? ''}
                        onChange={(event) =>
                          setNotes((previous) => ({
                            ...previous,
                            [request.id]: event.target.value,
                          }))
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        {request.targetType === 'file' && !request.targetRemoved && (
                          <Button
                            variant="secondary"
                            isLoading={downloadingId === request.id}
                            loadingLabel={strings.files.preparingDownload}
                            onClick={() => download(request)}
                          >
                            {strings.deletionRequests.download}
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          isLoading={review.isPending && review.variables?.id === request.id}
                          disabled={review.isPending}
                          onClick={() => decide(request, 'approve')}
                        >
                          {strings.deletionRequests.approve}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={review.isPending}
                          onClick={() => decide(request, 'reject')}
                        >
                          {strings.deletionRequests.reject}
                        </Button>
                      </div>
                    </div>
                  )}

                  {request.status !== 'pending' && request.reviewedAt && (
                    <p className="text-xs text-slate-500">
                      {strings.deletionRequests.reviewedBy(
                        request.reviewedBy?.name ?? strings.comments.unknownAuthor,
                        formatDateTime(request.reviewedAt),
                      )}
                    </p>
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

          {/* The history under "Aprovadas" or "Todas" outgrows one page; without a pager
              everything past the first twenty was unreachable. */}
          <Pagination
            page={requests.data.meta.page}
            pageSize={requests.data.meta.pageSize}
            total={requests.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
