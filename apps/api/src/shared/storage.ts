import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getEnv } from '../config/env.js';

/**
 * The whole storage surface the application needs. File bytes never pass through this
 * process: the browser PUTs each part straight to the provider using a presigned URL,
 * and everything here is control plane (07-upload-architecture.md).
 *
 * The same code talks to MinIO in development and Cloudflare R2 in production — both
 * speak the S3 API, so nothing branches on which is behind STORAGE_ENDPOINT.
 */

export interface CommittedPart {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

let client: S3Client | undefined;

export function getStorageClient(): S3Client {
  const env = getEnv();
  client ??= new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    // MinIO serves buckets as a path segment; R2 uses the host. Getting this wrong
    // produces signatures that verify but address the wrong object.
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

/** Tests point the client at a different bucket between runs. */
export function resetStorageClient(): void {
  client?.destroy();
  client = undefined;
}

function bucket(): string {
  return getEnv().STORAGE_BUCKET;
}

/**
 * `{companyId}/{projectId|no-project}/{fileId}/{original name}` — the UUID segments
 * make the key unguessable, which is why objects are never public
 * (16-security-requirements.md#protection-against-unauthorized-file-access).
 */
export function buildStorageKey(input: {
  companyId: string;
  projectId: string | null;
  fileId: string;
  originalName: string;
}): string {
  const safeName = input.originalName
    .normalize('NFKD')
    // Control characters and path separators are stripped so a filename cannot
    // escape its key prefix. \p{Cc} is the Unicode control category.
    .replace(/[\p{Cc}/\\]+/gu, '_')
    .slice(-200);

  return [
    input.companyId,
    input.projectId ?? 'no-project',
    input.fileId,
    safeName || 'arquivo',
  ].join('/');
}

export async function createMultipartUpload(input: {
  storageKey: string;
  mimeType: string;
}): Promise<string> {
  const response = await getStorageClient().send(
    new CreateMultipartUploadCommand({
      Bucket: bucket(),
      Key: input.storageKey,
      ContentType: input.mimeType,
    }),
  );

  if (!response.UploadId) {
    throw new Error('Storage did not return a multipart upload id.');
  }
  return response.UploadId;
}

/** Single object key, single method, short TTL — the minimum scope that can work. */
export async function presignUploadPart(input: {
  storageKey: string;
  providerUploadId: string;
  partNumber: number;
  expiresInSeconds: number;
}): Promise<string> {
  return getSignedUrl(
    getStorageClient(),
    new UploadPartCommand({
      Bucket: bucket(),
      Key: input.storageKey,
      UploadId: input.providerUploadId,
      PartNumber: input.partNumber,
    }),
    { expiresIn: input.expiresInSeconds },
  );
}

export async function presignDownload(input: {
  storageKey: string;
  downloadName: string;
  expiresInSeconds: number;
}): Promise<string> {
  return getSignedUrl(
    getStorageClient(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: input.storageKey,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(
        input.downloadName,
      )}`,
    }),
    { expiresIn: input.expiresInSeconds },
  );
}

/**
 * The provider's own view of what has actually been committed. This — not the
 * `upload_parts` mirror — is the source of truth: a part can succeed at the provider
 * while the browser's follow-up "register this part" call never arrives.
 */
export async function listCommittedParts(input: {
  storageKey: string;
  providerUploadId: string;
}): Promise<CommittedPart[]> {
  const parts: CommittedPart[] = [];
  let partNumberMarker: string | undefined;

  do {
    const response = await getStorageClient().send(
      new ListPartsCommand({
        Bucket: bucket(),
        Key: input.storageKey,
        UploadId: input.providerUploadId,
        PartNumberMarker: partNumberMarker,
      }),
    );

    for (const part of response.Parts ?? []) {
      if (part.PartNumber && part.ETag) {
        parts.push({
          partNumber: part.PartNumber,
          etag: part.ETag,
          sizeBytes: part.Size ?? 0,
        });
      }
    }

    partNumberMarker = response.IsTruncated ? response.NextPartNumberMarker : undefined;
  } while (partNumberMarker);

  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

export async function completeMultipartUpload(input: {
  storageKey: string;
  providerUploadId: string;
  parts: CommittedPart[];
}): Promise<void> {
  await getStorageClient().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: input.storageKey,
      UploadId: input.providerUploadId,
      MultipartUpload: {
        Parts: input.parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
      },
    }),
  );
}

/**
 * Aborting releases the provider-side storage for uncommitted parts, which is billed
 * until it happens — so failures here are worth surfacing, not swallowing.
 */
export async function abortMultipartUpload(input: {
  storageKey: string;
  providerUploadId: string;
}): Promise<void> {
  await getStorageClient().send(
    new AbortMultipartUploadCommand({
      Bucket: bucket(),
      Key: input.storageKey,
      UploadId: input.providerUploadId,
    }),
  );
}

export async function headObject(storageKey: string): Promise<{ sizeBytes: number } | null> {
  try {
    const response = await getStorageClient().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: storageKey }),
    );
    return { sizeBytes: response.ContentLength ?? 0 };
  } catch {
    return null;
  }
}

export async function deleteObject(storageKey: string): Promise<void> {
  await getStorageClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: storageKey }));
}
