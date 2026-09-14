import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CommentThread } from '../components/CommentThread';
import { FileUploader } from '../components/FileUploader';
import {
  Alert,
  Badge,
  Button,
  Card,
  LoadingScreen,
  SelectField,
  TextAreaField,
} from '../components/ui';
import { formatDate, formatDateTime } from '../lib/dates';
import { pendingRequestTone } from '../lib/tones';
import { pendingRequestStatusLabel, strings, topicPriorityLabel } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import {
  PENDING_REQUEST_STATUSES,
  usePendingRequest,
  useRespondToPendingRequest,
  useUpdatePendingRequest,
  type PendingRequestStatus,
} from '../modules/pending-requests/api';
import type { UploadedFile } from '../modules/uploads/uppy';

export default function PendingRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: currentUser } = useCurrentUser();
  const request = usePendingRequest(id);
  const respond = useRespondToPendingRequest();
  const update = useUpdatePendingRequest();

  const [body, setBody] = useState('');
  const [attachment, setAttachment] = useState<UploadedFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (request.isPending) return <LoadingScreen />;
  if (request.error) return <Alert tone="error">{request.error.message}</Alert>;
  if (!request.data) return null;

  const item = request.data;
  const isCreator = item.createdById === currentUser?.id;
  const canManage =
    isCreator || currentUser?.role === 'agency_admin' || currentUser?.role === 'agency_manager';
  const isClosed = item.status === 'completed' || item.status === 'cancelled';

  const handleRespond = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (respond.isPending || !body.trim()) return;

    respond.mutate(
      { id: item.id, body: body.trim(), attachmentFileId: attachment?.id ?? null },
      {
        onSuccess: () => {
          setBody('');
          setAttachment(null);
          setNotice(strings.pendingRequests.responded);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/pendencias"
        className="text-sm font-medium text-brand-700 underline underline-offset-2"
      >
        {strings.pendingRequests.backToList}
      </Link>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-900">{item.title}</h1>
          <div className="flex flex-wrap gap-1">
            {item.isOverdue && <Badge tone="danger">{strings.pendingRequests.overdue}</Badge>}
            <Badge tone={pendingRequestTone(item)}>{pendingRequestStatusLabel(item.status)}</Badge>
          </div>
        </div>

        <p className="text-sm whitespace-pre-wrap text-slate-700">{item.description}</p>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">{strings.pendingRequests.dueDate}</dt>
            <dd className="text-slate-900">
              {item.dueDate ? formatDate(item.dueDate) : strings.pendingRequests.noDueDate}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{strings.pendingRequests.priority}</dt>
            <dd className="text-slate-900">{topicPriorityLabel(item.priority)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{strings.pendingRequests.openedAt}</dt>
            <dd className="text-slate-900">{formatDateTime(item.createdAt)}</dd>
          </div>
        </dl>

        {canManage && (
          <SelectField
            label={strings.pendingRequests.status}
            value={item.status}
            onChange={(event) =>
              update.mutate(
                { id: item.id, status: event.target.value as PendingRequestStatus },
                { onSuccess: () => setNotice(strings.pendingRequests.saved) },
              )
            }
            options={PENDING_REQUEST_STATUSES.map((value) => ({
              value,
              label: pendingRequestStatusLabel(value),
            }))}
          />
        )}
      </Card>

      {notice && <Alert tone="success">{notice}</Alert>}
      {(respond.error ?? update.error) && (
        <Alert tone="error">{(respond.error ?? update.error)!.message}</Alert>
      )}

      {!isClosed && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-slate-900">
            {strings.pendingRequests.respondTitle}
          </h2>
          <p className="text-sm text-slate-500">{strings.pendingRequests.respondHint}</p>

          <form onSubmit={handleRespond} className="flex flex-col gap-3">
            <TextAreaField
              label={strings.pendingRequests.respond}
              rows={3}
              maxLength={5000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />

            {attachment ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                <span className="min-w-0 truncate text-sm text-slate-700">
                  {strings.pendingRequests.attached(attachment.originalName)}
                </span>
                <Button type="button" variant="secondary" onClick={() => setAttachment(null)}>
                  {strings.pendingRequests.removeAttachment}
                </Button>
              </div>
            ) : (
              // The file goes through the same resumable upload as everywhere else; the
              // response then carries its id, which is what links it to this request.
              <FileUploader
                target={{ companyId: item.companyId, projectId: item.projectId, folderId: null }}
                onUploaded={setAttachment}
              />
            )}

            <Button type="submit" isLoading={respond.isPending} disabled={!body.trim()}>
              {strings.pendingRequests.respond}
            </Button>
          </form>
        </Card>
      )}

      <CommentThread target={{ commentableType: 'pending_request', commentableId: item.id }} />
    </div>
  );
}
