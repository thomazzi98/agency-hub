import { useCallback, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CompanySelect } from '../components/CompanySelect';
import { FileUploader } from '../components/FileUploader';
import { CommentThread } from '../components/CommentThread';
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
import { formatDateTime } from '../lib/dates';
import { fileStatusLabel, strings } from '../lib/strings';
import { useCurrentUser, type CurrentUser } from '../modules/auth/session';
import { useAllCompanies } from '../modules/companies/api';
import {
  useCreateFolder,
  useDeleteFolder,
  useFolders,
  useRenameFolder,
  type Folder,
} from '../modules/folders/api';
import {
  startDownload,
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

/**
 * Mirrors the server's rule (apps/api/src/modules/files/routes.ts): your own upload, or
 * an admin, or a manager whose membership in *this* company carries
 * `can_delete_company_files`. Everyone else gets the request-for-deletion path - which a
 * manager holding the override used to be sent down too, needing an admin to approve
 * what they were already allowed to do.
 */
function canDeleteDirectly(currentUser: CurrentUser | null | undefined, file: StoredFile): boolean {
  if (!currentUser) return false;
  if (file.uploadedById === currentUser.id) return true;
  if (currentUser.role === 'agency_admin') return true;
  if (currentUser.role !== 'agency_manager') return false;
  return (
    currentUser.memberships.find((membership) => membership.companyId === file.companyId)
      ?.canDeleteCompanyFiles === true
  );
}

function FileCard({
  file,
  currentUser,
  canChangeStatus,
  isDownloading,
  isDeleting,
  showingNotes,
  onDownload,
  onToggleNotes,
  onStatusChange,
  onDelete,
  onRequestDeletion,
}: {
  file: StoredFile;
  currentUser: CurrentUser | null | undefined;
  canChangeStatus: boolean;
  isDownloading: boolean;
  isDeleting: boolean;
  showingNotes: boolean;
  onDownload: () => void;
  onToggleNotes: () => void;
  onStatusChange: (status: FileStatus) => void;
  onDelete: () => void;
  onRequestDeletion: () => void;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{file.originalName}</p>
          <p className="text-xs text-slate-500">
            {`${formatBytes(file.sizeBytes)} · ${strings.files.uploadedAt} ${formatDateTime(file.uploadedAt)}`}
          </p>
        </div>
        <Badge tone={file.status === 'approved' ? 'success' : 'neutral'}>
          {fileStatusLabel(file.status)}
        </Badge>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Button
          variant="secondary"
          isLoading={isDownloading}
          loadingLabel={strings.files.preparingDownload}
          onClick={onDownload}
        >
          {strings.files.download}
        </Button>

        <Button variant="secondary" onClick={onToggleNotes}>
          {showingNotes ? strings.files.hideNotes : strings.files.showNotes}
        </Button>

        {canChangeStatus && (
          <SelectField
            label={strings.files.changeStatus}
            value={file.status}
            options={statusOptions}
            onChange={(event) => onStatusChange(event.target.value as FileStatus)}
          />
        )}

        {canDeleteDirectly(currentUser, file) ? (
          <Button variant="danger" isLoading={isDeleting} onClick={onDelete}>
            {strings.files.remove}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onRequestDeletion}>
            {strings.files.requestDeletion}
          </Button>
        )}
      </div>

      {showingNotes && (
        <CommentThread target={{ commentableType: 'file', commentableId: file.id }} />
      )}
    </Card>
  );
}

export default function FilesPage() {
  const { data: currentUser } = useCurrentUser();
  const isAgency = currentUser?.role === 'agency_admin' || currentUser?.role === 'agency_manager';
  const canManageFolders = currentUser !== null && currentUser?.role !== 'client_manager';

  const companies = useAllCompanies().data?.rows ?? [];
  const [companyId, setCompanyId] = useState('');
  const [trail, setTrail] = useState<Crumb[]>([{ id: 'root', name: strings.folders.root }]);
  const [newFolderName, setNewFolderName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [deletionTarget, setDeletionTarget] = useState<StoredFile | null>(null);
  const [deletionReason, setDeletionReason] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  /** A name search spans every folder of the company, so it replaces the folder view. */
  const [search, setSearch] = useState('');

  const current = trail[trail.length - 1]!;
  const folderId = current.id === 'root' ? null : current.id;
  const isSearching = search.length > 0;

  const folders = useFolders(
    { companyId, parentFolderId: current.id },
    Boolean(companyId) && !isSearching,
  );
  const files = useFiles(
    isSearching
      ? { page, companyId, status: 'all', search }
      : { page, companyId, folderId: current.id, status: 'all' },
    Boolean(companyId),
  );

  const createFolder = useCreateFolder();
  const renameFolder = useRenameFolder();
  const deleteFolder = useDeleteFolder();
  const updateFile = useUpdateFile();
  const deleteFile = useDeleteFile();
  const requestDeletion = useRequestDeletion();

  /**
   * Split deliberately. A failed *load* is worth a retry — the connection dropped and
   * asking again may well work. A rejected *mutation* is not: "esvazie a pasta antes
   * de excluí-la" will say the same thing however many times it is retried, and
   * offering the button invites someone to keep pressing it.
   */
  const loadError = folders.error ?? files.error;
  const error =
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

  const applySearch = (term: string) => {
    setNotice(null);
    setPage(1);
    setNotesFor(null);
    setSearch(term.trim());
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
    if (downloadingId) return;
    setDownloadError(null);
    setDownloadingId(file.id);
    try {
      await startDownload(file.id);
    } catch (downloadFailure) {
      // It used to fail silently: the button did nothing and nothing said why.
      setDownloadError(
        downloadFailure instanceof Error ? downloadFailure.message : strings.app.genericError,
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const renderFile = (file: StoredFile) => (
    <li key={file.id}>
      <FileCard
        file={file}
        currentUser={currentUser}
        canChangeStatus={isAgency}
        isDownloading={downloadingId === file.id}
        isDeleting={deleteFile.isPending && deleteFile.variables === file.id}
        showingNotes={notesFor === file.id}
        onDownload={() => void download(file)}
        onToggleNotes={() => setNotesFor((open) => (open === file.id ? null : file.id))}
        onStatusChange={(status) =>
          updateFile.mutate(
            { id: file.id, status },
            { onSuccess: () => setNotice(strings.files.statusChanged) },
          )
        }
        onDelete={() => {
          if (window.confirm(strings.files.confirmRemove)) {
            deleteFile.mutate(file.id, {
              onSuccess: () => setNotice(strings.files.removed),
            });
          }
        }}
        onRequestDeletion={() => {
          setDeletionReason('');
          setDeletionTarget(file);
        }}
      />
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">{strings.files.title}</h1>

      <Card className="flex flex-col gap-3">
        <CompanySelect
          value={companyId}
          onChange={(next) => {
            setCompanyId(next);
            // A folder id only means something inside its own company.
            setTrail([{ id: 'root', name: strings.folders.root }]);
            setPage(1);
            setSearchDraft('');
            setSearch('');
          }}
        />

        {companyId && (
          <form
            role="search"
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              applySearch(searchDraft);
            }}
          >
            <div className="flex-1">
              <TextField
                label={strings.files.searchLabel}
                type="search"
                placeholder={strings.files.searchPlaceholder}
                maxLength={200}
                value={searchDraft}
                onChange={(event) => {
                  setSearchDraft(event.target.value);
                  // Emptying the box is how most people "clear" a search.
                  if (!event.target.value.trim() && isSearching) applySearch('');
                }}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={!searchDraft.trim()}>
              {strings.common.search}
            </Button>
          </form>
        )}
      </Card>

      {!companyId && companies.length > 0 && (
        <Alert tone="info">{strings.folders.selectCompany}</Alert>
      )}
      {loadError && (
        <Alert
          tone="error"
          onRetry={() => {
            void files.refetch();
            if (!isSearching) void folders.refetch();
          }}
        >
          {loadError.message}
        </Alert>
      )}
      {error && <Alert tone="error">{error.message}</Alert>}
      {downloadError && <Alert tone="error">{downloadError}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {companyId && isSearching && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">
              {strings.files.searchResults(search)}
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setSearchDraft('');
                applySearch('');
              }}
            >
              {strings.files.clearSearch}
            </Button>
          </div>

          {files.isPending && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" />
              {strings.app.loading}
            </div>
          )}

          {files.data && files.data.rows.length === 0 && (
            <EmptyState title={strings.files.searchEmpty} />
          )}

          {files.data && files.data.rows.length > 0 && (
            <>
              <ul className="flex flex-col gap-3">{files.data.rows.map(renderFile)}</ul>
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

      {companyId && !isSearching && (
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
                          if (renameFolder.isPending || !renaming.name.trim()) return;
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
                            maxLength={160}
                            value={renaming.name}
                            onChange={(event) =>
                              setRenaming({ id: folder.id, name: event.target.value })
                            }
                          />
                        </div>
                        <Button
                          type="submit"
                          isLoading={renameFolder.isPending}
                          disabled={!renaming.name.trim()}
                        >
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
              <ul className="flex flex-col gap-3">{files.data.rows.map(renderFile)}</ul>

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
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (requestDeletion.isPending || deletionReason.trim().length < 5) return;
              requestDeletion.mutate(
                { targetId: deletionTarget.id, reason: deletionReason.trim() },
                {
                  onSuccess: () => {
                    setDeletionTarget(null);
                    setNotice(strings.files.requestSent);
                  },
                },
              );
            }}
          >
            <p className="mb-3 text-sm text-slate-600">{strings.files.requestDeletionHint}</p>
            <p className="mb-3 truncate text-sm font-medium text-slate-900">
              {deletionTarget.originalName}
            </p>
            {requestDeletion.error && (
              <div className="mb-3">
                <Alert tone="error">{requestDeletion.error.message}</Alert>
              </div>
            )}
            <TextField
              label={strings.files.reason}
              hint={strings.files.reasonHint}
              maxLength={1000}
              value={deletionReason}
              onChange={(event) => setDeletionReason(event.target.value)}
            />
            <Button
              type="submit"
              className="mt-3"
              isLoading={requestDeletion.isPending}
              disabled={deletionReason.trim().length < 5}
            >
              {strings.files.sendRequest}
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
