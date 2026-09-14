import { getEnv } from '../../config/env.js';
import { unprocessable } from '../../shared/errors.js';

/**
 * S3-compatible multipart limits, inherited by Cloudflare R2
 * (07-upload-architecture.md#multipart-constraints-and-chunk-sizing-initial-configuration-values).
 */
export const MAX_PARTS_PER_UPLOAD = 10_000;

/**
 * Headroom below the 10,000-part ceiling. Sizing against 9,000 rather than 10,000
 * means a file that grows slightly between the size the client declares and the bytes
 * it actually sends cannot push the upload over the hard limit.
 */
const PART_COUNT_TARGET = 9_000;

/**
 * Deliberately a formula, not a table: the admin-configurable maximum file size can be
 * raised without anyone having to revisit a hardcoded chunk size.
 */
export function partSizeFor(fileSizeBytes: number): number {
  const configured = getEnv().UPLOAD_PART_SIZE_BYTES;
  const required = Math.ceil(fileSizeBytes / PART_COUNT_TARGET);
  return Math.max(configured, required);
}

export function partCountFor(fileSizeBytes: number, partSizeBytes: number): number {
  return Math.max(1, Math.ceil(fileSizeBytes / partSizeBytes));
}

/**
 * Covers what an agency actually receives: photography, video, audio, documents, and
 * the occasional archive of raw material. Entries ending in `/*` match a whole type.
 */
const DEFAULT_ALLOWED_MIME_TYPES = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];

export function allowedMimeTypes(): string[] {
  const configured = getEnv().UPLOAD_ALLOWED_MIME_TYPES;
  if (!configured) return DEFAULT_ALLOWED_MIME_TYPES;

  return configured
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function isMimeTypeAllowed(mimeType: string): boolean {
  const candidate = mimeType.trim().toLowerCase();

  return allowedMimeTypes().some((allowed) =>
    allowed.endsWith('/*') ? candidate.startsWith(allowed.slice(0, -1)) : candidate === allowed,
  );
}

export interface UploadPolicyDecision {
  partSizeBytes: number;
  partCount: number;
  maxAllowedSizeBytes: number;
}

/**
 * Runs before a single byte moves: an oversized or disallowed file is rejected at
 * session creation, not discovered after a 20 GB transfer
 * (07-upload-architecture.md#failure-scenarios-must-be-explicitly-handled).
 */
export function evaluateUploadPolicy(input: {
  sizeBytes: number;
  mimeType: string;
}): UploadPolicyDecision {
  const maxAllowedSizeBytes = getEnv().UPLOAD_MAX_FILE_BYTES;

  if (input.sizeBytes > maxAllowedSizeBytes) {
    throw unprocessable(
      'file_too_large',
      `O arquivo excede o tamanho máximo permitido (${formatBytes(maxAllowedSizeBytes)}).`,
    );
  }

  if (!isMimeTypeAllowed(input.mimeType)) {
    throw unprocessable('file_type_not_allowed', 'Este tipo de arquivo não é aceito.');
  }

  const partSizeBytes = partSizeFor(input.sizeBytes);
  const partCount = partCountFor(input.sizeBytes, partSizeBytes);

  if (partCount > MAX_PARTS_PER_UPLOAD) {
    throw unprocessable('file_too_large', 'O arquivo excede o tamanho máximo permitido.');
  }

  return { partSizeBytes, partCount, maxAllowedSizeBytes };
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
