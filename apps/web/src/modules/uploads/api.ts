import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';

export interface UploadConfig {
  maxFileBytes: number;
  partSizeBytes: number;
  presignBatchSize: number;
  maxActiveSessionsPerCompany: number;
  allowedMimeTypes: string[];
}

export interface UploadSession {
  id: string;
  companyId: string;
  projectId: string | null;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  partSizeBytes: number;
  partCount: number;
  status: 'pending' | 'in_progress' | 'completed' | 'aborted' | 'expired';
  expiresAt: string;
}

export interface CommittedPart {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

export function useUploadConfig() {
  return useQuery({
    queryKey: ['uploads', 'config'],
    queryFn: () => apiRequest<UploadConfig>('/uploads/config'),
    staleTime: 10 * 60 * 1000,
  });
}

export function createUploadSession(input: {
  companyId: string;
  folderId: string | null;
  projectId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}) {
  return apiRequest<UploadSession>('/uploads', { method: 'POST', body: input });
}

export function fetchPartUrls(sessionId: string, partNumbers: number[]) {
  return apiRequest<{ parts: { partNumber: number; url: string }[]; expiresInSeconds: number }>(
    `/uploads/${sessionId}/parts?partNumbers=${partNumbers.join(',')}`,
  );
}

export function registerPart(
  sessionId: string,
  partNumber: number,
  etag: string,
  sizeBytes: number,
) {
  return apiRequest<{ partNumber: number }>(`/uploads/${sessionId}/parts/${partNumber}`, {
    method: 'POST',
    body: { etag, sizeBytes },
  });
}

export function resumeUploadSession(sessionId: string) {
  return apiRequest<UploadSession & { committedParts: CommittedPart[] }>(`/uploads/${sessionId}`);
}

export function completeUploadSession(sessionId: string) {
  return apiRequest<{ id: string; originalName: string }>(`/uploads/${sessionId}/complete`, {
    method: 'POST',
  });
}

export function abortUploadSession(sessionId: string) {
  return apiRequest<{ id: string }>(`/uploads/${sessionId}/abort`, { method: 'POST' });
}

/** Mirrors the server's formula so the browser splits the file exactly as expected. */
export function partSizeFor(fileSizeBytes: number, configuredPartSize: number): number {
  return Math.max(configuredPartSize, Math.ceil(fileSizeBytes / 9000));
}

export function isMimeTypeAllowed(mimeType: string, allowed: string[]): boolean {
  const candidate = mimeType.trim().toLowerCase();
  return allowed.some((entry) =>
    entry.endsWith('/*') ? candidate.startsWith(entry.slice(0, -1)) : candidate === entry,
  );
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
