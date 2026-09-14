import { useState } from 'react';
import { CompanySelect } from '../components/CompanySelect';
import { PublicationDialog } from '../components/PublicationDialog';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Pagination,
  SelectField,
  Spinner,
} from '../components/ui';
import { formatDateTime } from '../lib/dates';
import { publicationTone } from '../lib/tones';
import { networkLabel, publicationStatusLabel, strings } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import {
  NETWORKS,
  PUBLICATION_STATUSES,
  usePublicationList,
  type PublicationNetwork,
  type PublicationStatus,
  type PublicationWithContent,
} from '../modules/publications/api';

const networkOptions = [
  { value: '', label: strings.common.all },
  ...NETWORKS.map((value) => ({ value, label: networkLabel(value) })),
];

const statusOptions = [
  { value: 'all', label: strings.common.all },
  ...PUBLICATION_STATUSES.map((value) => ({ value, label: publicationStatusLabel(value) })),
];

/**
 * The cross-content view of the publication log: what is still owed, what went out,
 * and where. The calendar answers "what about this content item"; this answers "what
 * is left to post" (03-functional-requirements.md#production-tracking).
 */
export default function PublicationsPage() {
  const { data: currentUser } = useCurrentUser();
  const canManage = currentUser?.role === 'agency_admin' || currentUser?.role === 'agency_manager';

  const [companyId, setCompanyId] = useState('');
  const [network, setNetwork] = useState<PublicationNetwork | ''>('');
  const [status, setStatus] = useState<PublicationStatus | 'all'>('all');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PublicationWithContent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = usePublicationList(
    {
      page,
      companyId: companyId || undefined,
      network: network || undefined,
      status,
      pending: pendingOnly,
    },
    Boolean(companyId),
  );

  const resetPage = () => setPage(1);

  return (
    <div className="flex flex-col gap-4">
      {editing && (
        <PublicationDialog
          companyId={editing.content.companyId}
          contentId={editing.contentId}
          network={editing.network}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setNotice(strings.publications.saved)}
          onRemoved={() => setNotice(strings.publications.removed)}
        />
      )}

      <h1 className="text-xl font-bold text-slate-900">{strings.publications.title}</h1>

      <Card className="flex flex-col gap-3">
        <CompanySelect
          value={companyId}
          onChange={(next) => {
            setCompanyId(next);
            resetPage();
          }}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={strings.publications.network}
            value={network}
            onChange={(event) => {
              setNetwork(event.target.value as PublicationNetwork | '');
              resetPage();
            }}
            options={networkOptions}
          />
          <SelectField
            label={strings.publications.status}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as PublicationStatus | 'all');
              resetPage();
            }}
            options={statusOptions}
          />
        </div>

        <Checkbox
          label={strings.publications.pendingOnly}
          checked={pendingOnly}
          onChange={(event) => {
            setPendingOnly(event.target.checked);
            resetPage();
          }}
        />
      </Card>

      {list.error && (
        <Alert tone="error" onRetry={() => void list.refetch()}>
          {list.error.message}
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}

      {list.isPending && companyId && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      )}

      {list.data && list.data.rows.length === 0 && (
        <EmptyState title={strings.publications.empty} hint={strings.publications.emptyHint} />
      )}

      {list.data && list.data.rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {list.data.rows.map((row) => (
              <li key={row.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{row.content.title}</p>
                      <p className="text-xs text-slate-500">
                        {[
                          networkLabel(row.network),
                          row.publishedAt ? formatDateTime(row.publishedAt) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <Badge tone={publicationTone(row.status)}>
                      {publicationStatusLabel(row.status)}
                    </Badge>
                  </div>

                  {row.notes && <p className="text-sm text-slate-600">{row.notes}</p>}

                  <p className="text-xs text-slate-400">
                    {strings.publications.lastUpdate(formatDateTime(row.updatedAt))}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {row.link && (
                      <a
                        href={row.link}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm font-medium text-brand-700 underline"
                      >
                        {strings.publications.openLink}
                      </a>
                    )}
                    {canManage && (
                      <Button variant="secondary" onClick={() => setEditing(row)}>
                        {strings.publications.edit}
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <Pagination
            page={list.data.meta.page}
            pageSize={list.data.meta.pageSize}
            total={list.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
