import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type Uppy from '@uppy/core';
import { Alert, Button, Card, Spinner } from './ui';
import { strings } from '../lib/strings';
import { formatBytes, useUploadConfig, type UploadConfig } from '../modules/uploads/api';
import { createUppy, type UploadTarget, type UploadedFile } from '../modules/uploads/uppy';

type UploadState =
  'waiting' | 'uploading' | 'paused' | 'processing' | 'completed' | 'cancelled' | 'failed';

interface UploadRow {
  id: string;
  name: string;
  sizeBytes: number;
  uploadedBytes: number;
  state: UploadState;
  error?: string;
}

const ACTIVE_STATES: UploadState[] = ['waiting', 'uploading', 'paused', 'processing'];

function isTypeAllowed(mimeType: string, allowed: string[]): boolean {
  const candidate = mimeType.toLowerCase();
  return allowed.some((entry) =>
    entry.endsWith('/*') ? candidate.startsWith(entry.slice(0, -1)) : candidate === entry,
  );
}

/**
 * Why a chosen file was not queued, in the person's language. Uppy's own restriction
 * messages are English ("You can only upload: image/*, video/*, …"), and they were shown
 * as they came.
 */
function describeRejection(
  file: { name?: string; size?: number | null; type?: string },
  config: UploadConfig,
): string {
  const name = file.name ?? 'arquivo';
  if ((file.size ?? 0) > config.maxFileBytes) {
    return strings.uploads.tooLarge(name, formatBytes(config.maxFileBytes));
  }
  if (!isTypeAllowed(file.type || 'application/octet-stream', config.allowedMimeTypes)) {
    return strings.uploads.typeNotAllowed(name);
  }
  return strings.uploads.alreadyQueued(name);
}

/**
 * Drives Uppy headlessly: the file bytes go straight to storage, and this component
 * only renders the queue. Pause, resume and cancel are first-class because a phone on
 * mobile data is the expected case, not the exception
 * (07-upload-architecture.md#mobile-considerations).
 */
export function FileUploader({
  target,
  onUploaded,
}: {
  target: UploadTarget;
  onUploaded: (file: UploadedFile) => void;
}) {
  const config = useUploadConfig();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const uppyRef = useRef<Uppy<never, never> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Uppy is created in an effect, so a file can be chosen a tick before it exists.
   * Holding those files and flushing them on ready is the difference between a
   * slightly late upload and one that silently never happened.
   */
  const pendingRef = useRef<File[]>([]);
  const [ready, setReady] = useState(false);

  // Read through refs so a changing prop never re-runs the effect below. Recreating
  // Uppy mid-transfer would abandon every part already in flight, and `onUploaded`
  // changes identity on any parent render.
  const targetRef = useRef(target);
  targetRef.current = target;
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const updateRow = useCallback((id: string, changes: Partial<UploadRow>) => {
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }, []);

  useEffect(() => {
    if (!config.data) return;
    const uploadConfig = config.data;

    const uppy = createUppy(
      uploadConfig,
      () => targetRef.current,
      (file) => onUploadedRef.current(file),
    );

    uppy.on('file-added', (file) => {
      setRows((previous) => [
        ...previous,
        {
          id: file.id,
          name: file.name ?? 'arquivo',
          sizeBytes: file.size ?? 0,
          uploadedBytes: 0,
          state: 'waiting',
        },
      ]);
    });

    uppy.on('upload-progress', (file, progress) => {
      if (!file) return;
      updateRow(file.id, {
        state: 'uploading',
        uploadedBytes: progress.bytesUploaded ?? 0,
      });
    });

    // The created row is announced by `createUppy`'s own callback, which is the only
    // place its id exists. This event just closes out the progress row.
    uppy.on('upload-success', (file) => {
      if (!file) return;
      updateRow(file.id, { state: 'completed', uploadedBytes: file.size ?? 0 });
    });

    uppy.on('upload-error', (file, uploadError) => {
      if (!file) return;
      updateRow(file.id, { state: 'failed', error: uploadError.message });
    });

    uppy.on('restriction-failed', (file) => {
      if (file) setError(describeRejection(file, uploadConfig));
    });

    uppyRef.current = uppy as unknown as Uppy<never, never>;
    setReady(true);

    for (const file of pendingRef.current) {
      uppy.addFile({ name: file.name, type: file.type, data: file });
    }
    pendingRef.current = [];

    return () => {
      setReady(false);
      void uppy.destroy();
      uppyRef.current = null;
    };
    // Deliberately depends only on the config: this effect owns the Uppy instance for
    // the life of the screen, and re-running it would destroy an in-flight upload.
  }, [config.data, updateRow]);

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const uppy = uppyRef.current;

    for (const file of Array.from(event.target.files ?? [])) {
      if (!uppy) {
        pendingRef.current.push(file);
        continue;
      }
      try {
        uppy.addFile({ name: file.name, type: file.type, data: file });
      } catch {
        // A restriction, or the same file already in the queue: Uppy throws either way,
        // in English, so the reason is worked out here instead.
        setError(
          config.data
            ? describeRejection({ name: file.name, size: file.size, type: file.type }, config.data)
            : strings.app.genericError,
        );
      }
    }
    // Lets the same file be chosen again after a cancel.
    event.target.value = '';
  };

  /**
   * Closing or reloading the tab mid-transfer abandons it, and a large file on mobile
   * data is a long transfer. The browser asks first, in its own words.
   */
  const hasActiveUploads = rows.some((row) => ACTIVE_STATES.includes(row.state));
  useEffect(() => {
    if (!hasActiveUploads) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a value here to show the prompt at all.
      event.returnValue = strings.uploads.leaveWarning;
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasActiveUploads]);

  const pause = (row: UploadRow) => {
    uppyRef.current?.pauseResume(row.id);
    updateRow(row.id, { state: row.state === 'paused' ? 'uploading' : 'paused' });
  };

  const cancel = (row: UploadRow) => {
    if (!window.confirm(strings.uploads.confirmCancel)) return;
    uppyRef.current?.removeFile(row.id);
    updateRow(row.id, { state: 'cancelled' });
  };

  const clearFinished = () => {
    setRows((previous) => previous.filter((row) => ACTIVE_STATES.includes(row.state)));
  };

  if (config.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" />
        {strings.app.loading}
      </div>
    );
  }

  if (config.isError) {
    return <Alert tone="error">{config.error.message}</Alert>;
  }

  const finished = rows.filter((row) => !ACTIVE_STATES.includes(row.state));

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-slate-900">{strings.uploads.title}</h2>
        <p className="text-xs text-slate-500">
          {strings.uploads.limitHint(formatBytes(config.data?.maxFileBytes ?? 0))}
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div>
        <input
          ref={inputRef}
          id="file-uploader-input"
          type="file"
          multiple
          className="sr-only"
          onChange={handleFiles}
        />
        <label
          htmlFor="file-uploader-input"
          aria-busy={!ready}
          className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 sm:w-auto ${
            ready ? '' : 'opacity-70'
          }`}
        >
          {strings.uploads.choose}
        </label>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const percent =
              row.sizeBytes > 0
                ? Math.min(100, Math.round((row.uploadedBytes / row.sizeBytes) * 100))
                : 0;

            return (
              <li
                key={row.id}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                    {row.name}
                  </p>
                  <span className="text-xs text-slate-500">{strings.uploads.state[row.state]}</span>
                </div>

                <div
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${strings.uploads.progressOf} ${row.name}`}
                  className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
                >
                  <div
                    className={`h-full transition-all ${
                      row.state === 'failed' ? 'bg-red-500' : 'bg-brand-600'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">
                    {`${formatBytes(row.uploadedBytes)} / ${formatBytes(row.sizeBytes)} · ${percent}%`}
                  </span>

                  {ACTIVE_STATES.includes(row.state) && (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => pause(row)}>
                        {row.state === 'paused' ? strings.uploads.resume : strings.uploads.pause}
                      </Button>
                      <Button variant="danger" onClick={() => cancel(row)}>
                        {strings.uploads.cancel}
                      </Button>
                    </div>
                  )}
                </div>

                {row.error && (
                  <p role="alert" className="text-xs font-medium text-red-600">
                    {row.error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {finished.length > 0 && (
        <Button variant="secondary" onClick={clearFinished}>
          {strings.uploads.clearFinished}
        </Button>
      )}
    </Card>
  );
}
