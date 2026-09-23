import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Spinner, TextAreaField } from './ui';
import { formatDateTime } from '../lib/dates';
import { strings } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
  type Comment,
  type CommentTarget,
} from '../modules/comments/api';
import { startDownload } from '../modules/files/api';
import { formatBytes } from '../modules/uploads/api';

/**
 * The file a comment carried. A pending request answered "segue o material" is only
 * answered if the material can be opened from the answer - it used to be linked in the
 * database and shown nowhere.
 */
function Attachment({
  attachment,
  onError,
}: {
  attachment: NonNullable<Comment['attachment']>;
  onError: (message: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
      <span className="min-w-0 truncate text-sm text-slate-700">
        {`${strings.comments.attachment}: ${attachment.originalName} · ${formatBytes(attachment.sizeBytes)}`}
      </span>
      {attachment.removed ? (
        <span className="text-xs text-slate-500">{strings.comments.attachmentRemoved}</span>
      ) : (
        <Button
          variant="secondary"
          isLoading={downloading}
          loadingLabel={strings.files.preparingDownload}
          onClick={() => {
            setDownloading(true);
            startDownload(attachment.id)
              .catch((error: unknown) =>
                onError(error instanceof Error ? error.message : strings.app.genericError),
              )
              .finally(() => setDownloading(false));
          }}
        >
          {strings.files.download}
        </Button>
      )}
    </div>
  );
}

/**
 * The same thread on every resource that can carry notes, so the behaviour a user
 * learns in one place holds in all of them.
 */
export function CommentThread({ target }: { target: CommentTarget }) {
  const { data: currentUser } = useCurrentUser();
  const comments = useComments(target);
  const create = useCreateComment();
  const update = useUpdateComment();
  const remove = useDeleteComment();

  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const error = comments.error ?? create.error ?? update.error ?? remove.error;
  const rows = comments.data?.rows ?? [];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending || !body.trim()) return;

    create.mutate(
      { ...target, body: body.trim() },
      // Cleared only once the server has it, so a failure does not lose what was typed.
      { onSuccess: () => setBody('') },
    );
  };

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-slate-900">{strings.comments.title}</h2>

      {error && <Alert tone="error">{error.message}</Alert>}
      {downloadError && <Alert tone="error">{downloadError}</Alert>}

      {comments.isPending ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">{strings.comments.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((comment) => {
            const isMine = comment.authorId === currentUser?.id;

            return (
              <li key={comment.id} className="rounded-lg border border-slate-200 p-3">
                {editing?.id === comment.id ? (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (update.isPending || !editing.body.trim()) return;
                      update.mutate(
                        { id: comment.id, body: editing.body.trim() },
                        { onSuccess: () => setEditing(null) },
                      );
                    }}
                  >
                    <TextAreaField
                      label={strings.comments.body}
                      rows={3}
                      maxLength={5000}
                      value={editing.body}
                      onChange={(event) => setEditing({ id: comment.id, body: event.target.value })}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        isLoading={update.isPending}
                        disabled={!editing.body.trim()}
                      >
                        {strings.common.save}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                        {strings.common.cancel}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-slate-700">
                      {isMine
                        ? strings.comments.you
                        : (comment.author?.name ?? strings.comments.unknownAuthor)}
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-slate-800">
                      {comment.body}
                    </p>
                    {comment.attachment && (
                      <Attachment attachment={comment.attachment} onError={setDownloadError} />
                    )}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-slate-500">
                        {formatDateTime(comment.createdAt)}
                        {comment.updatedAt !== comment.createdAt && ` · ${strings.comments.edited}`}
                      </span>

                      {isMine && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="text-xs font-semibold text-brand-700 underline underline-offset-2"
                            onClick={() => setEditing({ id: comment.id, body: comment.body })}
                          >
                            {strings.common.edit}
                          </button>
                          <button
                            type="button"
                            className="text-xs font-semibold text-red-600 underline underline-offset-2"
                            onClick={() => {
                              if (window.confirm(strings.comments.confirmRemove)) {
                                remove.mutate(comment.id);
                              }
                            }}
                          >
                            {strings.comments.remove}
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <TextAreaField
          label={strings.comments.newComment}
          rows={3}
          maxLength={5000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <Button type="submit" isLoading={create.isPending} disabled={!body.trim()}>
          {strings.comments.send}
        </Button>
      </form>
    </Card>
  );
}
