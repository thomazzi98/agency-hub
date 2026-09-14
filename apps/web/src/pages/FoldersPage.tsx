import { useState, type FormEvent } from 'react';
import { CompanySelect } from '../components/CompanySelect';
import { Alert, Button, Card, EmptyState, Spinner, TextField } from '../components/ui';
import { strings } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import { useCompanies } from '../modules/companies/api';
import {
  useCreateFolder,
  useDeleteFolder,
  useFolders,
  useRenameFolder,
  type Folder,
} from '../modules/folders/api';

interface Crumb {
  id: string | 'root';
  name: string;
}

export default function FoldersPage() {
  const { data: currentUser } = useCurrentUser();
  const canCreate = currentUser !== null && currentUser?.role !== 'client_manager';

  const companies = useCompanies({ page: 1, status: 'all' }).data?.rows ?? [];
  const [companyId, setCompanyId] = useState('');
  const [trail, setTrail] = useState<Crumb[]>([{ id: 'root', name: strings.folders.root }]);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const current = trail[trail.length - 1]!;

  const folders = useFolders({ companyId, parentFolderId: current.id }, Boolean(companyId));

  const create = useCreateFolder();
  const rename = useRenameFolder();
  const remove = useDeleteFolder();
  const error = create.error ?? rename.error ?? remove.error ?? folders.error;

  const openFolder = (folder: Folder) => {
    setNotice(null);
    setTrail((previous) => [...previous, { id: folder.id, name: folder.name }]);
  };

  const goToCrumb = (index: number) => {
    setNotice(null);
    setTrail((previous) => previous.slice(0, index + 1));
  };

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending || !newName.trim()) return;

    create.mutate(
      {
        companyId,
        name: newName.trim(),
        parentFolderId: current.id === 'root' ? null : current.id,
      },
      {
        onSuccess: () => {
          setNewName('');
          setNotice(strings.folders.created);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">{strings.folders.title}</h1>

      <Card>
        <CompanySelect
          value={companyId}
          onChange={(next) => {
            setCompanyId(next);
            // A folder id only means something inside its own company.
            setTrail([{ id: 'root', name: strings.folders.root }]);
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

          {canCreate && (
            <Card>
              <form
                onSubmit={handleCreate}
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <div className="flex-1">
                  <TextField
                    label={strings.folders.name}
                    maxLength={160}
                    // Locked while the create is in flight: the field is cleared on
                    // success, which would otherwise silently discard whatever the
                    // user typed in the meantime.
                    disabled={create.isPending}
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                </div>
                <Button type="submit" isLoading={create.isPending} disabled={!newName.trim()}>
                  {strings.folders.new}
                </Button>
              </form>
            </Card>
          )}

          {folders.isPending && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" />
              {strings.app.loading}
            </div>
          )}

          {folders.data && folders.data.length === 0 && (
            <EmptyState
              title={strings.folders.empty}
              hint={canCreate ? strings.folders.emptyHint : strings.folders.emptyReadOnlyHint}
            />
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
                          rename.mutate(
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
                        <Button type="submit" isLoading={rename.isPending}>
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
                          {canCreate && (
                            <Button
                              variant="secondary"
                              onClick={() => setRenaming({ id: folder.id, name: folder.name })}
                            >
                              {strings.folders.rename}
                            </Button>
                          )}
                          {canCreate && (
                            <Button
                              variant="danger"
                              isLoading={remove.isPending && remove.variables === folder.id}
                              onClick={() => {
                                if (window.confirm(strings.folders.confirmRemove)) {
                                  remove.mutate(folder.id, {
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
        </>
      )}
    </div>
  );
}
