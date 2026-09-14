import { useCallback, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CompanySelect } from '../components/CompanySelect';
import { FileUploader } from '../components/FileUploader';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Pagination,
  SelectField,
  Spinner,
  TextField,
} from '../components/ui';
import { fileStatusLabel, strings } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import { useCompanies } from '../modules/companies/api';
import {
  useCreateFolder,
  useDeleteFolder,
  useFolders,
  useRenameFolder,
  type Folder,
} from '../modules/folders/api';
import {
  fetchDownloadUrl,
  useDeleteFile,
  useFiles,
  useRequestDeletion,
  useUpdateFile,
  type FileStatus,
  type StoredFile,
} from '../modules/files/api';
import { formatBytes } from '../modules/uploads/api';

interface Crumb {
  id: string | 'root';
  name: string;
}

const statusOptions = (
  ['received', 'in_review', 'editing', 'edit_complete', 'approved', 'archived'] as const
).map((status) => ({ value: status, label: fileStatusLabel(status) }));

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export default function FilesPage() {
  const { data: currentUser } = useCurrentUser();
  const isAgency = currentUser?.role === 'agency_admin' || currentUser?.role === 'agency_manager';
  const canManageFolders = currentUser !== null && currentUser?.role !== 'client_manager';

  const companies = useCompanies({ page: 1, status: 'all' }).data?.rows ?? [];
  const [companyId, setCompanyId] = useState('');
  const [trail, setTrail] = useState<Crumb[]>([{ id: 'root', name: strings.folders.root }]);
  const [newFolderName, setNewFolderName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [deletionTarget, setDeletionTarget] = useState<StoredFile | null>(null);
  const [deletionReason, setDeletionReason] = useState('');

  const current = trail[trail.length - 1]!;
  const folderId = current.id === 'root' ? null : current.id;

  const folders = useFolders({ companyId, parentFolderId: current.id }, Boolean(companyId));
  const files = useFiles(
    { page, companyId, folderId: current.id, status: 'all' },
    Boolean(companyId),
  );

  const createFolder = useCreateFolder();
  const renameFolder = useRenameFolder();
  const deleteFolder = useDeleteFolder();
  const updateFile = useUpdateFile();
  const deleteFile = useDeleteFile();
  const requestDeletion = useRequestDeletion();

  const error =
    folders.error ??
    files.error ??
    createFolder.error ??
    renameFolder.error ??
    deleteFolder.error ??
    updateFile.error ??
    deleteFile.error ??
    requestDeletion.error;

  const queryClient = useQueryClient();
  // Invalidating by key keeps this callback stable; closing over the query object
  // would give it a new identity on every render.
  const refreshFiles = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['files'] });
  }, [queryClient]);

  const openFolder = (folder: Folder) => {
    setNotice(null);
    setPage(1);
    setTrail((previous) => [...previous, { id: folder.id, name: folder.name }]);
  };

  const goToCrumb = (index: number) => {
    setNotice(null);
    setPage(1);
    setTrail((previous) => previous.slice(0, index + 1));
  };

  const handleCreateFolder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createFolder.isPending || !newFolderName.trim()) return;

    createFolder.mutate(
      { companyId, name: newFolderName.trim(), parentFolderId: folderId },
      {
        onSuccess: () => {
          setNewFolderName('');
          setNotice(strings.folders.created);
        },
      },
    );
  };

  const download = async (file: StoredFile) => {
    const url = await fetchDownloadUrl(file.id);
    // Opened rather than fetched: the signed URL points straight at storage, so the
    // bytes never pass through this application.
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">{strings.files.title}</h1>

      <Card>
        <CompanySelect
          value={companyId}
          onChange={(next) => {
            setCompanyId(next);
            // A folder id only means something inside its own company.
            setTrail([{ id: 'root', name: strings.folders.root }]);
            setPage(1);
          }}
        />
      </Card>

      {!companyId && companies.length > 0 && (
        <Alert tone="info">{strings.folders.selectCompany}</Alert>
      )}
      {error && <Alert tone="error">{error.message}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {companyId && (
        <>
          <nav aria-label="Caminho" className="flex flex-wrap items-center gap-1 text-sm">
            {trail.map((crumb, index) => (
              <span key={crumb.id} className="flex items-center gap-1">
                {index > 0 && <span className="text-slate-400">/</span>}
                {index === trail.length - 1 ? (
                  <span className="font-medium text-slate-900">{crumb.name}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => goToCrumb(index)}
                    className="rounded px-1 text-brand-700 underline underline-offset-2"
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          <FileUploader
            target={{ companyId, folderId, projectId: null }}
            onUploaded={refreshFiles}
          />

          {canManageFolders && (
            <Card>
              <form
                onSubmit={handleCreateFolder}
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <div className="flex-1">
                  <TextField
                    label={strings.folders.name}
                    maxLength={160}
                    disabled={createFolder.isPending}
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  isLoading={createFolder.isPending}
                  disabled={!newFolderName.trim()}
                >
                  {strings.folders.new}
                </Button>
              </form>
            </Card>
          )}

          {folders.data && folders.data.length > 0 && (
            <ul className="flex flex-col gap-3">
              {folders.data.map((folder) => (
                <li key={folder.id}>
                  <Card className="flex flex-col gap-3">
                    {renaming?.id === folder.id ? (
                      <form
                        className="flex flex-col gap-3 sm:flex-row sm:items-end"
                        onSubmit={(event) => {
                          event.preventDefault();
                          renameFolder.mutate(
                            { id: folder.id, name: renaming.name.trim() },
                            {
                              onSuccess: () => {
                                setRenaming(null);
                                setNotice(strings.folders.renamed);
                              },
                            },
                          );
                        }}
                      >
                        <div className="flex-1">
                          <TextField
                            label={strings.folders.name}
                            value={renaming.name}
                            onChange={(event) =>
                              setRenaming({ id: folder.id, name: event.target.value })
                            }
                          />
                        </div>
                        <Button type="submit" isLoading={renameFolder.isPending}>
                          {strings.common.save}
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => setRenaming(null)}>
                          {strings.common.cancel}
                        </Button>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{folder.name}</p>
                          <p className="text-xs text-slate-500">
                            {strings.folders.subfolderCount(folder._count?.children ?? 0)}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => openFolder(folder)}>
                            {strings.folders.open}
                          </Button>
                          {canManageFolders && (
                            <Button
                              variant="secondary"
                              onClick={() => setRenaming({ id: folder.id, name: folder.name })}
                            >
                              {strings.folders.rename}
                            </Button>
                          )}
                          {canManageFolders && (
                            <Button
                              variant="danger"
                              isLoading={
                                deleteFolder.isPending && deleteFolder.variables === folder.id
                              }
                              onClick={() => {
                                if (window.confirm(strings.folders.confirmRemove)) {
                                  deleteFolder.mutate(folder.id, {
                                    onSuccess: () => setNotice(strings.folders.removed),
                                  });
                                }
                              }}
                            >
                              {strings.folders.remove}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}

          {files.isPending && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" />
              {strings.app.loading}
            </div>
          )}

          {files.data && files.data.rows.length === 0 && folders.data?.length === 0 && (
            <EmptyState
              title={strings.files.empty}
              hint={canManageFolders ? strings.files.emptyHint : strings.files.emptyReadOnlyHint}
            />
          )}

          {files.data && files.data.rows.length > 0 && (
            <>
              <ul className="flex flex-col gap-3">
                {files.data.rows.map((file) => {
                  const isOwnUpload = file.uploadedById === currentUser?.id;

                  return (
                    <li key={file.id}>
                      <Card className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">
                              {file.originalName}
                            </p>
                            <p className="text-xs text-slate-500">
                              {`${formatBytes(file.sizeBytes)} · ${strings.files.uploadedAt} ${formatDateTime(file.uploadedAt)}`}
                            </p>
                          </div>
                          <Badge tone={file.status === 'approved' ? 'success' : 'neutral'}>
                            {fileStatusLabel(file.status)}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-end gap-2">
                          <Button variant="secondary" onClick={() => void download(file)}>
                            {strings.files.download}
                          </Button>

                          {isAgency && (
                            <SelectField
                              label={strings.files.changeStatus}
                              value={file.status}
                              options={statusOptions}
                              onChange={(event) =>
                                updateFile.mutate(
                                  { id: file.id, status: event.target.value as FileStatus },
                                  { onSuccess: () => setNotice(strings.files.statusChanged) },
                                )
                              }
                            />
                          )}

                          {isOwnUpload || currentUser?.role === 'agency_admin' ? (
                            <Button
                              variant="danger"
                              isLoading={deleteFile.isPending && deleteFile.variables === file.id}
                              onClick={() => {
                                if (window.confirm(strings.files.confirmRemove)) {
                                  deleteFile.mutate(file.id, {
                                    onSuccess: () => setNotice(strings.files.removed),
                                  });
                                }
                              }}
                            >
                              {strings.files.remove}
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setDeletionReason('');
                                setDeletionTarget(file);
                              }}
                            >
                              {strings.files.requestDeletion}
                            </Button>
                          )}
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>

              <Pagination
                page={files.data.meta.page}
                pageSize={files.data.meta.pageSize}
                total={files.data.meta.total}
                onPageChange={setPage}
              />
            </>
          )}
        </>
      )}

      {deletionTarget && (
        <Modal title={strings.files.requestDeletionTitle} onClose={() => setDeletionTarget(null)}>
          <p className="mb-3 text-sm text-slate-600">{strings.files.requestDeletionHint}</p>
          <p className="mb-3 truncate text-sm font-medium text-slate-900">
            {deletionTarget.originalName}
          </p>
          <TextField
            label={strings.files.reason}
            value={deletionReason}
            onChange={(event) => setDeletionReason(event.target.value)}
          />
          <Button
            className="mt-3"
            isLoading={requestDeletion.isPending}
            disabled={deletionReason.trim().length < 5}
            onClick={() =>
              requestDeletion.mutate(
                { targetId: deletionTarget.id, reason: deletionReason.trim() },
                {
                  onSuccess: () => {
                    setDeletionTarget(null);
                    setNotice(strings.files.requestSent);
                  },
                },
              )
            }
          >
            {strings.files.sendRequest}
          </Button>
        </Modal>
      )}
    </div>
  );
}
