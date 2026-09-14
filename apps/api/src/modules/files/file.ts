export const fileSelect = {
  id: true,
  companyId: true,
  projectId: true,
  folderId: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  uploadedById: true,
  uploadedAt: true,
  deletedAt: true,
} as const;

export interface FileRow {
  id: string;
  companyId: string;
  projectId: string | null;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: bigint;
  status: string;
  uploadedById: string | null;
  uploadedAt: Date;
  deletedAt: Date | null;
}

/** JSON has no BigInt, and a file size is far inside Number.MAX_SAFE_INTEGER (9 PB). */
export function serializeFile(file: FileRow) {
  return { ...file, sizeBytes: Number(file.sizeBytes) };
}
