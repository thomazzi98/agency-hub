import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CompanySelect } from '../components/CompanySelect';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Modal,
  Pagination,
  SelectField,
  Spinner,
  TextField,
} from '../components/ui';
import { adPlatformLabel, campaignStatusLabel, strings } from '../lib/strings';
import { campaignTone } from '../lib/tones';
import { money } from '../lib/money';
import { useCurrentUser } from '../modules/auth/session';
import {
  AD_PLATFORMS,
  CAMPAIGN_STATUSES,
  useAdAccounts,
  useCampaigns,
  useCreateAdAccount,
  useCreateCampaign,
  type AdPlatform,
  type CampaignStatus,
} from '../modules/campaigns/api';

const statusOptions = [
  { value: 'all', label: strings.common.all },
  ...CAMPAIGN_STATUSES.map((value) => ({ value, label: campaignStatusLabel(value) })),
];

function NewAdAccountDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const create = useCreateAdAccount();
  const [form, setForm] = useState({
    platform: 'meta' as AdPlatform,
    name: '',
    externalAccountId: '',
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;
    create.mutate(
      {
        companyId,
        platform: form.platform,
        name: form.name.trim(),
        externalAccountId: form.externalAccountId.trim() || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title={strings.campaigns.newAdAccount} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {create.error && <Alert tone="error">{create.error.message}</Alert>}

        <SelectField
          label={strings.campaigns.platform}
          value={form.platform}
          onChange={(event) =>
            setForm((p) => ({ ...p, platform: event.target.value as AdPlatform }))
          }
          options={AD_PLATFORMS.map((value) => ({ value, label: adPlatformLabel(value) }))}
        />
        <TextField
          label={strings.campaigns.name}
          required
          maxLength={160}
          value={form.name}
          onChange={(event) => setForm((p) => ({ ...p, name: event.target.value }))}
        />
        <TextField
          label={strings.campaigns.externalAccountId}
          hint={strings.campaigns.externalHint}
          maxLength={120}
          value={form.externalAccountId}
          onChange={(event) => setForm((p) => ({ ...p, externalAccountId: event.target.value }))}
        />

        <Button type="submit" isLoading={create.isPending} disabled={!form.name.trim()}>
          {strings.campaigns.createAccount}
        </Button>
      </form>
    </Modal>
  );
}

function NewCampaignDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const accounts = useAdAccounts(companyId);
  const create = useCreateCampaign();
  const [form, setForm] = useState({
    adAccountId: '',
    name: '',
    objective: '',
    status: 'active' as CampaignStatus,
    dailyBudget: '',
    totalBudget: '',
    visibleToClient: true,
  });

  const toNumber = (value: string) => (value.trim() === '' ? null : Number(value));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;
    create.mutate(
      {
        companyId,
        adAccountId: form.adAccountId,
        name: form.name.trim(),
        objective: form.objective.trim() || null,
        status: form.status,
        dailyBudget: toNumber(form.dailyBudget),
        totalBudget: toNumber(form.totalBudget),
        visibleToClient: form.visibleToClient,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title={strings.campaigns.new} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {create.error && <Alert tone="error">{create.error.message}</Alert>}
        <Alert tone="info">{strings.campaigns.manualNotice}</Alert>

        <SelectField
          label={strings.campaigns.adAccount}
          required
          value={form.adAccountId}
          onChange={(event) => setForm((p) => ({ ...p, adAccountId: event.target.value }))}
          options={[
            { value: '', label: strings.common.select },
            ...(accounts.data ?? []).map((account) => ({
              value: account.id,
              label: `${account.name} · ${adPlatformLabel(account.platform)}`,
            })),
          ]}
        />

        <TextField
          label={strings.campaigns.name}
          required
          maxLength={200}
          value={form.name}
          onChange={(event) => setForm((p) => ({ ...p, name: event.target.value }))}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={strings.campaigns.objective}
            maxLength={160}
            value={form.objective}
            onChange={(event) => setForm((p) => ({ ...p, objective: event.target.value }))}
          />
          <SelectField
            label={strings.campaigns.status}
            value={form.status}
            onChange={(event) =>
              setForm((p) => ({ ...p, status: event.target.value as CampaignStatus }))
            }
            options={CAMPAIGN_STATUSES.map((value) => ({
              value,
              label: campaignStatusLabel(value),
            }))}
          />
          <TextField
            label={`${strings.campaigns.dailyBudget} (${strings.campaigns.manualTag})`}
            type="number"
            min={0}
            step="0.01"
            value={form.dailyBudget}
            onChange={(event) => setForm((p) => ({ ...p, dailyBudget: event.target.value }))}
          />
          <TextField
            label={`${strings.campaigns.totalBudget} (${strings.campaigns.manualTag})`}
            type="number"
            min={0}
            step="0.01"
            value={form.totalBudget}
            onChange={(event) => setForm((p) => ({ ...p, totalBudget: event.target.value }))}
          />
        </div>

        <Checkbox
          label={strings.campaigns.visibleToClient}
          hint={strings.campaigns.visibleHint}
          checked={form.visibleToClient}
          onChange={(event) => setForm((p) => ({ ...p, visibleToClient: event.target.checked }))}
        />

        <Button
          type="submit"
          isLoading={create.isPending}
          disabled={!form.name.trim() || !form.adAccountId}
        >
          {strings.campaigns.create}
        </Button>
      </form>
    </Modal>
  );
}

export default function CampaignsPage() {
  const { data: currentUser } = useCurrentUser();
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState<CampaignStatus | 'all'>('all');
  const [needsAttention, setNeedsAttention] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState<'campaign' | 'account' | null>(null);

  const accounts = useAdAccounts(companyId || undefined);
  const list = useCampaigns(
    { page, companyId: companyId || undefined, status, needsAttention },
    Boolean(companyId),
  );

  // The override is per company, so the answer changes with the selector above.
  const membership = currentUser?.memberships.find((row) => row.companyId === companyId);
  const canManage =
    currentUser?.role === 'agency_admin' ||
    (currentUser?.role === 'agency_manager' && membership?.canManageCampaigns === true);

  return (
    <div className="flex flex-col gap-4">
      {creating === 'campaign' && companyId && (
        <NewCampaignDialog companyId={companyId} onClose={() => setCreating(null)} />
      )}
      {creating === 'account' && companyId && (
        <NewAdAccountDialog companyId={companyId} onClose={() => setCreating(null)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{strings.campaigns.title}</h1>
        {canManage && companyId && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setCreating('account')}>
              {strings.campaigns.newAdAccount}
            </Button>
            <Button
              onClick={() => setCreating('campaign')}
              disabled={(accounts.data ?? []).length === 0}
            >
              {strings.campaigns.new}
            </Button>
          </div>
        )}
      </div>

      {/* A display requirement, not just a data one (09-campaign-management.md). */}
      <Alert tone="info">{strings.campaigns.manualNotice}</Alert>

      <Card className="flex flex-col gap-3">
        <CompanySelect
          value={companyId}
          onChange={(next) => {
            setCompanyId(next);
            setPage(1);
          }}
        />
        <SelectField
          label={strings.campaigns.status}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as CampaignStatus | 'all');
            setPage(1);
          }}
          options={statusOptions}
        />
        <Checkbox
          label={strings.campaigns.needsAttentionOnly}
          checked={needsAttention}
          onChange={(event) => {
            setNeedsAttention(event.target.checked);
            setPage(1);
          }}
        />
      </Card>

      {list.error && <Alert tone="error">{list.error.message}</Alert>}

      {canManage && companyId && (accounts.data ?? []).length === 0 && !accounts.isPending && (
        <Alert tone="info">{strings.campaigns.noAccounts}</Alert>
      )}

      {list.isPending && companyId && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      )}

      {list.data && list.data.rows.length === 0 && (
        <EmptyState title={strings.campaigns.empty} hint={strings.campaigns.emptyHint} />
      )}

      {list.data && list.data.rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {list.data.rows.map((campaign) => (
              <li key={campaign.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to={`/campanhas/${campaign.id}`}
                        className="truncate font-medium text-slate-900 underline-offset-2 hover:underline"
                      >
                        {campaign.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {[adPlatformLabel(campaign.platform), campaign.objective]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {!campaign.visibleToClient && (
                        <Badge tone="muted">{strings.campaigns.hidden}</Badge>
                      )}
                      <Badge tone={campaignTone(campaign.status)}>
                        {campaignStatusLabel(campaign.status)}
                      </Badge>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-slate-500">{strings.campaigns.dailyBudget}</dt>
                      <dd className="text-slate-900">{money(campaign.dailyBudget)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{strings.campaigns.totalBudget}</dt>
                      <dd className="text-slate-900">{money(campaign.totalBudget)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{strings.campaigns.reportedSpend}</dt>
                      <dd className="text-slate-900">{money(campaign.reportedSpend)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{strings.campaigns.reportedBalance}</dt>
                      <dd className="text-slate-900">{money(campaign.reportedBalance)}</dd>
                    </div>
                  </dl>
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
