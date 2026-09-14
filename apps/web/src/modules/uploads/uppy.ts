import Uppy from '@uppy/core';
import AwsS3 from '@uppy/aws-s3';
import {
  abortUploadSession,
  completeUploadSession,
  createUploadSession,
  fetchPartUrls,
  partSizeFor,
  registerPart,
  resumeUploadSession,
  type UploadConfig,
} from './api';

/**
 * Uppy in self-hosted-signing mode: our backend signs each part and the browser PUTs
 * the bytes straight to the storage provider. Uppy's Companion relay is deliberately
 * not used — it would proxy every byte through our own server, which is exactly what
 * this architecture exists to avoid (07-upload-architecture.md#client-library-uppy-final-decision).
 */

export interface UploadTarget {
  companyId: string;
  folderId: string | null;
  projectId: string | null;
}

interface FileMeta {
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * `signPart` must hand the part number to `uploadPartBytes`, which does not receive it.
 * Uppy passes the signature object straight through, so the extra fields ride along —
 * and if that ever stopped being true, registration is skipped rather than broken:
 * completion reconciles against the provider's own ListParts regardless.
 */
interface PartSignature {
  url: string;
  headers?: Record<string, string>;
  sessionId?: string;
  partNumber?: number;
}

/**
 * Uppy types `uploadId` as optional on the resume and completion paths, but by then it
 * is the value `createMultipartUpload` returned. Failing loudly beats silently
 * addressing `undefined`.
 */
function requireSessionId(uploadId: string | undefined): string {
  if (!uploadId) {
    throw new Error('Sessão de envio ausente.');
  }
  return uploadId;
}

function abortError(): Error {
  const error = new Error('Upload aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * A hand-written XHR rather than fetch: only XHR reports upload progress, which is the
 * difference between a visible transfer and a frozen bar on a slow mobile connection.
 */
function uploadPartBytes(options: {
  signature: PartSignature;
  body: Blob | FormData;
  size?: number;
  onProgress: (event: ProgressEvent) => void;
  onComplete?: (etag: string) => void;
  signal?: AbortSignal;
}): Promise<{ ETag: string }> {
  const { signature, body, onProgress, onComplete, signal } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const request = new XMLHttpRequest();
    request.open('PUT', signature.url, true);
    request.responseType = 'text';

    for (const [name, value] of Object.entries(signature.headers ?? {})) {
      request.setRequestHeader(name, value);
    }

    const onAbort = () => request.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event);
    });

    request.addEventListener('abort', () => {
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    });

    request.addEventListener('error', () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Falha de rede ao enviar parte do arquivo.'));
    });

    request.addEventListener('load', () => {
      signal?.removeEventListener('abort', onAbort);

      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Storage rejected the part (HTTP ${request.status}).`));
        return;
      }

      const etag = request.getResponseHeader('ETag');
      if (!etag) {
        reject(new Error('Storage did not return an ETag for the part.'));
        return;
      }

      onComplete?.(etag);

      // Keeps the server's part mirror warm so a later resume is cheap. Correctness
      // never depends on it, so a failure here must not fail the upload.
      if (signature.sessionId && signature.partNumber) {
        void registerPart(
          signature.sessionId,
          signature.partNumber,
          etag,
          options.size ?? (body instanceof Blob ? body.size : 0),
        ).catch(() => undefined);
      }

      resolve({ ETag: etag });
    });

    request.send(body);
  });
}

/** The row the server created once every part was in place. */
export interface UploadedFile {
  id: string;
  originalName: string;
}

export function createUppy(
  config: UploadConfig,
  target: () => UploadTarget,
  /**
   * Called with the file the server created. Uppy's own `upload-success` event knows
   * only that the transfer finished; the id of the row behind it exists solely in the
   * response to `complete`, and a caller that has to attach the file to something else
   * needs exactly that.
   */
  onFileCreated?: (file: UploadedFile) => void,
) {
  const uppy = new Uppy<FileMeta, Record<string, never>>({
    autoProceed: true,
    restrictions: {
      maxFileSize: config.maxFileBytes,
      allowedFileTypes: config.allowedMimeTypes,
    },
  });

  uppy.use(AwsS3, {
    shouldUseMultipart: true,
    // Conservative by default: mobile connections often lose throughput to contention
    // well before they gain from more parallelism.
    limit: 3,
    // 1s, 2s, 4s, 8s, 16s with Uppy's own jitter (07-upload-architecture.md#retry-strategy).
    retryDelays: [1000, 2000, 4000, 8000, 16000],

    getChunkSize: (file) => partSizeFor(file.size ?? 0, config.partSizeBytes),

    createMultipartUpload: async (file) => {
      const where = target();
      const session = await createUploadSession({
        companyId: where.companyId,
        folderId: where.folderId,
        projectId: where.projectId,
        originalName: file.name ?? 'arquivo',
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size ?? 0,
      });

      uppy.setFileMeta(file.id, { sessionId: session.id });
      // Uppy needs a key; ours is server-side only, so the session id stands in as the
      // opaque handle every later call is addressed by.
      return { uploadId: session.id, key: session.id };
    },

    signPart: async (_file, { uploadId, partNumber }) => {
      const sessionId = requireSessionId(uploadId);
      const response = await fetchPartUrls(sessionId, [partNumber]);
      const part = response.parts.find((candidate) => candidate.partNumber === partNumber);
      if (!part) {
        throw new Error(`O servidor não assinou a parte ${partNumber}.`);
      }
      return { url: part.url, sessionId, partNumber } satisfies PartSignature;
    },

    listParts: async (_file, { uploadId }) => {
      const session = await resumeUploadSession(requireSessionId(uploadId));
      return session.committedParts.map((part) => ({
        PartNumber: part.partNumber,
        ETag: part.etag,
        Size: part.sizeBytes,
      }));
    },

    completeMultipartUpload: async (_file, { uploadId }) => {
      const created = await completeUploadSession(requireSessionId(uploadId));
      onFileCreated?.(created);
      return {};
    },

    abortMultipartUpload: async (_file, { uploadId }) => {
      await abortUploadSession(requireSessionId(uploadId));
    },

    uploadPartBytes: uploadPartBytes as never,
  });

  return uppy;
}
