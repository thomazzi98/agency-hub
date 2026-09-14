import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  LoadingScreen,
  SelectField,
  TextAreaField,
  TextField,
} from '../components/ui';
import { formatDateTime, toDateTimeInput, fromDateTimeInput } from '../lib/dates';
import { adPlatformLabel, campaignFieldLabel, campaignStatusLabel, strings } from '../lib/strings';
import { campaignTone } from '../lib/tones';
import { useCurrentUser } from '../modules/auth/session';
import { useCompanyMembers } from '../modules/companies/api';
import {
  CAMPAIGN_STATUSES,
  useCampaign,
  useUpdateCampaign,
  type CampaignStatus,
} from '../modules/campaigns/api';
import { money } from '../lib/money';

interface CampaignForm {
  name: string;
  objective: string;
  status: string;
  dailyBudget: string;
  totalBudget: string;
  reportedSpend: string;
  reportedBalance: string;
  lastCheckedAt: string;
  responsibleUserId: string;
  notes: string;
  changeNote: string;
  visibleToClient: string;
}

/** Renders a history value the way the field it belongs to should read. */
function historyValue(field: string, value: string | null): string {
  if (value === null) return strings.campaigns.noValue;
  if (field === 'status') return campaignStatusLabel(value);
  if (field === 'platform') return adPlatformLabel(value);
  if (field === 'visibleToClient') return value === 'true' ? strings.common.yes : strings.common.no;
  if (['dailyBudget', 'totalBudget', 'reportedSpend', 'reportedBalance'].includes(field)) {
    return money(value);
  }
  if (field === 'lastCheckedAt') return formatDateTime(value);
  return value;
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: currentUser } = useCurrentUser();
  const campaign = useCampaign(id);
  const update = useUpdateCampaign();
  const members = useCompanyMembers(campaign.data?.companyId);

  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Every field as text while it is being edited, including the money ones: a
   * half-typed "12." is not a number yet, and coercing on each keystroke would fight
   * the person typing. Converted once, on submit.
   */
  const [form, setForm] = useState<CampaignForm | null>(null);

  if (campaign.isPending) return <LoadingScreen />;
  if (campaign.error) return <Alert tone="error">{campaign.error.message}</Alert>;
  if (!campaign.data) return null;

  const item = campaign.data;
  const membership = currentUser?.memberships.find((row) => row.companyId === item.companyId);
  const canManage =
    currentUser?.role === 'agency_admin' ||
    (currentUser?.role === 'agency_manager' && membership?.canManageCampaigns === true);

  const editing: CampaignForm = form ?? {
    name: item.name,
    objective: item.objective ?? '',
    status: item.status,
    dailyBudget: item.dailyBudget ?? '',
    totalBudget: item.totalBudget ?? '',
    reportedSpend: item.reportedSpend ?? '',
    reportedBalance: item.reportedBalance ?? '',
    lastCheckedAt: item.lastCheckedAt ? toDateTimeInput(item.lastCheckedAt) : '',
    responsibleUserId: item.responsibleUserId ?? '',
    notes: item.notes ?? '',
    changeNote: '',
    visibleToClient: item.visibleToClient ? 'true' : 'false',
  };

  const set = (changes: Partial<CampaignForm>) =>
    setForm((current) => ({ ...(current ?? editing), ...changes }));

  const toNumber = (value: string) => (value.trim() === '' ? null : Number(value));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending) return;

    update.mutate(
      {
        id: item.id,
        name: editing.name.trim(),
        objective: editing.objective.trim() || null,
        status: editing.status as CampaignStatus,
        dailyBudget: toNumber(editing.dailyBudget),
        totalBudget: toNumber(editing.totalBudget),
        reportedSpend: toNumber(editing.reportedSpend),
        reportedBalance: toNumber(editing.reportedBalance),
        lastCheckedAt: editing.lastCheckedAt ? fromDateTimeInput(editing.lastCheckedAt) : null,
        responsibleUserId: editing.responsibleUserId || null,
        notes: editing.notes.trim() || null,
        visibleToClient: editing.visibleToClient === 'true',
        changeNote: editing.changeNote.trim() || null,
      },
      {
        onSuccess: () => {
          setNotice(strings.campaigns.saved);
          // Dropped so the form re-seeds from what the server actually stored.
          setForm(null);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/campanhas"
        className="text-sm font-medium text-brand-700 underline underline-offset-2"
      >
        {strings.campaigns.backToList}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">{item.name}</h1>
        <div className="flex flex-wrap gap-1">
          {!item.visibleToClient && <Badge tone="muted">{strings.campaigns.hidden}</Badge>}
          <Badge tone={campaignTone(item.status)}>{campaignStatusLabel(item.status)}</Badge>
        </div>
      </div>

      <Alert tone="info">{strings.campaigns.manualNotice}</Alert>
      {notice && <Alert tone="success">{notice}</Alert>}
      {update.error && <Alert tone="error">{update.error.message}</Alert>}

      {canManage ? (
        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <TextField
              label={strings.campaigns.name}
              required
              maxLength={200}
              value={editing.name}
              onChange={(event) => set({ name: event.target.value })}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label={strings.campaigns.objective}
                maxLength={160}
                value={editing.objective}
                onChange={(event) => set({ objective: event.target.value })}
              />
              <SelectField
                label={strings.campaigns.status}
                value={editing.status}
                onChange={(event) => set({ status: event.target.value })}
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
                value={editing.dailyBudget}
                onChange={(event) => set({ dailyBudget: event.target.value })}
              />
              <TextField
                label={`${strings.campaigns.totalBudget} (${strings.campaigns.manualTag})`}
                type="number"
                min={0}
                step="0.01"
                value={editing.totalBudget}
                onChange={(event) => set({ totalBudget: event.target.value })}
              />
              <TextField
                label={`${strings.campaigns.reportedSpend} (${strings.campaigns.manualTag})`}
                type="number"
                min={0}
                step="0.01"
                value={editing.reportedSpend}
                onChange={(event) => set({ reportedSpend: event.target.value })}
              />
              <TextField
                label={`${strings.campaigns.reportedBalance} (${strings.campaigns.manualTag})`}
                type="number"
                min={0}
                step="0.01"
                value={editing.reportedBalance}
                onChange={(event) => set({ reportedBalance: event.target.value })}
              />
              <TextField
                label={strings.campaigns.lastCheckedAt}
                type="datetime-local"
                value={editing.lastCheckedAt}
                onChange={(event) => set({ lastCheckedAt: event.target.value })}
              />
              <SelectField
                label={strings.campaigns.responsible}
                value={editing.responsibleUserId}
                onChange={(event) => set({ responsibleUserId: event.target.value })}
                options={[
                  { value: '', label: strings.common.none },
                  ...(members.data ?? []).map((member) => ({
                    value: member.id,
                    label: member.name,
                  })),
                ]}
              />
            </div>

            <Checkbox
              label={strings.campaigns.visibleToClient}
              hint={strings.campaigns.visibleHint}
              checked={editing.visibleToClient === 'true'}
              onChange={(event) =>
                set({ visibleToClient: event.target.checked ? 'true' : 'false' })
              }
            />

            <TextAreaField
              label={strings.campaigns.notes}
              rows={3}
              maxLength={5000}
              value={editing.notes}
              onChange={(event) => set({ notes: event.target.value })}
            />

            <TextField
              label={strings.campaigns.changeNote}
              hint={strings.campaigns.changeNoteHint}
              maxLength={500}
              value={editing.changeNote}
              onChange={(event) => set({ changeNote: event.target.value })}
            />

            <Button type="submit" isLoading={update.isPending}>
              {strings.common.save}
            </Button>
          </form>
        </Card>
      ) : (
        <Card>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            {(
              [
                [strings.campaigns.platform, adPlatformLabel(item.platform)],
                [strings.campaigns.objective, item.objective ?? strings.campaigns.noValue],
                [strings.campaigns.dailyBudget, money(item.dailyBudget)],
                [strings.campaigns.totalBudget, money(item.totalBudget)],
                [strings.campaigns.reportedSpend, money(item.reportedSpend)],
                [strings.campaigns.reportedBalance, money(item.reportedBalance)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {/* The reason this module exists: who changed what, and why. */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">{strings.campaigns.history}</h2>

        {item.history.length === 0 ? (
          <p className="text-sm text-slate-500">{strings.campaigns.historyEmpty}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {item.history.map((entry) => (
              <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                <p className="text-sm text-slate-900">
                  <span className="font-medium">{campaignFieldLabel(entry.fieldName)}</span>{' '}
                  {strings.campaigns.from}{' '}
                  <span className="text-slate-600">
                    {historyValue(entry.fieldName, entry.oldValue)}
                  </span>{' '}
                  {strings.campaigns.to}{' '}
                  <span className="text-slate-900">
                    {historyValue(entry.fieldName, entry.newValue)}
                  </span>
                </p>
                {entry.note && (
                  <p className="text-sm whitespace-pre-wrap text-slate-600">{entry.note}</p>
                )}
                <p className="text-xs text-slate-400">{formatDateTime(entry.createdAt)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
