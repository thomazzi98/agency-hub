import { useState, type ReactNode } from 'react';
import { Alert, Card, LoadingScreen, SelectField, Spinner, TextField } from '../components/ui';
import { CompanySelect } from '../components/CompanySelect';
import { ContentRows, FileRows, Panel, RequestRows, StatTile } from '../components/DashboardPanels';
import { endOfDay, formatDateTime, startOfDateInput, toDateInput } from '../lib/dates';
import {
  auditActionLabel,
  productionStatusLabel,
  strings,
  topicPriorityLabel,
} from '../lib/strings';
import { useCurrentUser, type CurrentUser } from '../modules/auth/session';
import { useAllCompanies } from '../modules/companies/api';
import {
  useAgencyDashboard,
  useCompanyDashboard,
  type DashboardFilters,
} from '../modules/dashboard/api';
import type { ContentPriority, ProductionStatus } from '../modules/calendar/api';

const priorities: ContentPriority[] = ['low', 'medium', 'high'];
const statuses: ProductionStatus[] = [
  'planned',
  'awaiting_material',
  'in_production',
  'in_review',
  'approved',
  'completed',
  'cancelled',
];

/**
 * The agency view: every tile is something somebody has to act on, and every tile is a
 * link to the screen that acts on it.
 */
function AgencyDashboard({ currentUser }: { currentUser: { name: string } }) {
  const companies = useAllCompanies();
  const [filters, setFilters] = useState<DashboardFilters>({});
  const dashboard = useAgencyDashboard(filters);

  const set = (changes: Partial<DashboardFilters>) =>
    setFilters((current) => {
      const next = { ...current, ...changes };
      // An empty control means "no filter", not an empty-string filter.
      for (const key of Object.keys(next) as (keyof DashboardFilters)[]) {
        if (!next[key]) delete next[key];
      }
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{strings.home.title}</h1>
        {/* Who you are signed in as, then what is waiting. On a shared machine the
            first line is the one that matters. */}
        <p className="text-sm text-slate-600">{strings.home.welcome(currentUser.name)}</p>
        <p className="text-sm text-slate-500">{strings.dashboard.question}</p>
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-700">{strings.dashboard.filters}</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={strings.projects.company}
            value={filters.companyId ?? ''}
            onChange={(event) => set({ companyId: event.target.value })}
            options={[
              { value: '', label: strings.dashboard.allCompanies },
              ...(companies.data?.rows ?? []).map((company) => ({
                value: company.id,
                label: company.name,
              })),
            ]}
          />
          <SelectField
            label={strings.dashboard.productionStatus}
            value={filters.productionStatus ?? ''}
            onChange={(event) => set({ productionStatus: event.target.value as ProductionStatus })}
            options={[
              { value: '', label: strings.common.all },
              ...statuses.map((value) => ({ value, label: productionStatusLabel(value) })),
            ]}
          />
          {/* The chosen days are the viewer's days: a UTC boundary started "from the
              23rd" at 21:00 on the 22nd and ended "until the 23rd" at 21:00 on it. */}
          <TextField
            label={strings.dashboard.from}
            type="date"
            value={filters.from ? toDateInput(new Date(filters.from)) : ''}
            onChange={(event) =>
              set({
                from: event.target.value
                  ? startOfDateInput(event.target.value).toISOString()
                  : undefined,
              })
            }
          />
          <TextField
            label={strings.dashboard.to}
            type="date"
            value={filters.to ? toDateInput(new Date(filters.to)) : ''}
            onChange={(event) =>
              set({
                to: event.target.value
                  ? endOfDay(startOfDateInput(event.target.value)).toISOString()
                  : undefined,
              })
            }
          />
          <SelectField
            label={strings.dashboard.priority}
            value={filters.priority ?? ''}
            onChange={(event) => set({ priority: event.target.value as ContentPriority })}
            options={[
              { value: '', label: strings.common.all },
              ...priorities.map((value) => ({ value, label: topicPriorityLabel(value) })),
            ]}
          />
        </div>

        <button
          type="button"
          onClick={() => setFilters({})}
          className="self-start text-xs font-semibold text-brand-700 underline underline-offset-2"
        >
          {strings.dashboard.clear}
        </button>
      </Card>

      {dashboard.error && (
        <Alert tone="error" onRetry={() => void dashboard.refetch()}>
          {dashboard.error.message}
        </Alert>
      )}

      {dashboard.isPending && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      )}

      {dashboard.data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile
              label={strings.dashboard.activeCompanies}
              value={dashboard.data.activeCompanies}
              to="/empresas"
            />
            <StatTile
              label={strings.dashboard.today}
              value={dashboard.data.counts.today}
              to="/calendario"
            />
            <StatTile
              label={strings.dashboard.overdue}
              value={dashboard.data.counts.overdue}
              tone="danger"
              to="/calendario"
            />
            <StatTile
              label={strings.dashboard.inProduction}
              value={dashboard.data.counts.inProduction}
              to="/calendario"
            />
            <StatTile
              label={strings.dashboard.awaitingApproval}
              value={dashboard.data.counts.awaitingApproval}
              tone="warning"
              to="/calendario"
            />
            <StatTile
              label={strings.dashboard.requestsAwaitingClient}
              value={dashboard.data.counts.requestsAwaitingClient}
              tone="warning"
              to="/pendencias"
            />
            <StatTile
              label={strings.dashboard.requestsOverdue}
              value={dashboard.data.counts.requestsOverdue}
              tone="danger"
              to="/pendencias"
            />
            <StatTile
              label={strings.dashboard.pendingPublications}
              value={dashboard.data.counts.pendingPublications}
              to="/publicacoes"
            />
            <StatTile
              label={strings.dashboard.campaigns}
              value={dashboard.data.counts.campaignsNeedingAttention}
              tone="danger"
              to="/campanhas"
            />
            <StatTile
              label={strings.dashboard.unread}
              value={dashboard.data.counts.unreadNotifications}
              to="/notificacoes"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel
              title={strings.dashboard.overdueContent}
              count={dashboard.data.overdueContent.length}
              to="/calendario"
              empty={strings.dashboard.allClear}
            >
              <ContentRows items={dashboard.data.overdueContent} />
            </Panel>

            <Panel
              title={strings.dashboard.todayContent}
              count={dashboard.data.todayContent.length}
              to="/calendario"
            >
              <ContentRows items={dashboard.data.todayContent} />
            </Panel>

            <Panel
              title={strings.dashboard.overdueRequests}
              count={dashboard.data.requestsOverdueItems.length}
              to="/pendencias"
              empty={strings.dashboard.allClear}
            >
              <RequestRows items={dashboard.data.requestsOverdueItems} />
            </Panel>

            <Panel
              title={strings.dashboard.recentFiles}
              count={dashboard.data.recentFiles.length}
              to="/arquivos"
            >
              <FileRows items={dashboard.data.recentFiles} />
            </Panel>

            {dashboard.data.recentActivity && (
              <Panel
                title={strings.dashboard.recentActivity}
                count={dashboard.data.recentActivity.length}
              >
                {dashboard.data.recentActivity.map((entry) => (
                  <li
                    key={entry.id}
                    className="border-b border-slate-100 pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <p className="text-slate-800">{auditActionLabel(entry.action)}</p>
                    <p className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</p>
                  </li>
                ))}
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The client's view: their company, fewer panels, no filters to learn. */
function CompanyDashboard({
  companyId,
  currentUser,
  companyPicker,
}: {
  companyId: string;
  currentUser: { name: string; role: string };
  /** Offered only to someone who belongs to more than one company. */
  companyPicker?: ReactNode;
}) {
  const dashboard = useCompanyDashboard(companyId || undefined);

  const heading = (
    <div>
      <h1 className="text-xl font-bold text-slate-900">{strings.home.title}</h1>
      {/* Who you are signed in as, then what is waiting. On a shared machine the
          first line is the one that matters. */}
      <p className="text-sm text-slate-600">{strings.home.welcome(currentUser.name)}</p>
      <p className="text-sm text-slate-500">{strings.dashboard.question}</p>
    </div>
  );

  if (!companyId || dashboard.isPending) {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        {companyPicker}
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {strings.app.loading}
        </div>
      </div>
    );
  }
  if (dashboard.error) {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        {companyPicker}
        <Alert tone="error" onRetry={() => void dashboard.refetch()}>
          {dashboard.error.message}
        </Alert>
      </div>
    );
  }
  if (!dashboard.data) return null;

  const { counts } = dashboard.data;

  return (
    <div className="flex flex-col gap-4">
      {heading}
      {companyPicker}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile
          label={strings.dashboard.myRequests}
          value={counts.myRequests}
          tone="warning"
          to="/pendencias"
        />
        <StatTile
          label={strings.dashboard.plannedContent}
          value={counts.plannedContent}
          to="/calendario"
        />
        <StatTile
          label={strings.dashboard.inProduction}
          value={counts.inProduction}
          to="/calendario"
        />
        <StatTile
          label={strings.dashboard.openRequests}
          value={counts.openRequests}
          to="/pendencias"
        />
        <StatTile
          label={strings.dashboard.activeProjects}
          value={counts.activeProjects}
          to="/projetos"
        />
        <StatTile
          label={strings.dashboard.pendingPublications}
          value={counts.pendingPublications}
          to="/publicacoes"
        />
        {/* Campaigns are the agency's and the client's; a contributor sees none. */}
        {currentUser.role !== 'contributor' && (
          <StatTile label={strings.campaigns.title} value={counts.campaigns} to="/campanhas" />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title={strings.dashboard.myRequests}
          count={dashboard.data.myRequests.length}
          to="/pendencias"
        >
          <RequestRows items={dashboard.data.myRequests} />
        </Panel>

        <Panel
          title={strings.dashboard.upcoming}
          count={dashboard.data.upcomingContent.length}
          to="/calendario"
        >
          <ContentRows items={dashboard.data.upcomingContent} />
        </Panel>

        <Panel
          title={strings.dashboard.recentFiles}
          count={dashboard.data.recentFiles.length}
          to="/arquivos"
        >
          <FileRows items={dashboard.data.recentFiles} />
        </Panel>
      </div>
    </div>
  );
}

/**
 * Any role may belong to several companies (06-permissions-and-authorization.md), so a
 * client or contributor in more than one gets to choose which one this is about - it
 * used to show the first membership and offer no way to see the others.
 */
function ClientHome({ currentUser }: { currentUser: CurrentUser }) {
  const memberships = currentUser.memberships;
  const [chosen, setChosen] = useState('');

  if (memberships.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-bold text-slate-900">{strings.home.title}</h1>
        <Alert tone="info">{strings.dashboard.noCompany}</Alert>
      </div>
    );
  }

  if (memberships.length === 1) {
    return <CompanyDashboard companyId={memberships[0]!.companyId} currentUser={currentUser} />;
  }

  return (
    <CompanyDashboard
      companyId={chosen}
      currentUser={currentUser}
      companyPicker={
        <Card>
          <CompanySelect value={chosen} onChange={setChosen} />
        </Card>
      }
    />
  );
}

export default function HomePage() {
  const { data: currentUser, isPending } = useCurrentUser();

  if (isPending || !currentUser) {
    return <LoadingScreen />;
  }

  if (currentUser.role === 'agency_admin' || currentUser.role === 'agency_manager') {
    return <AgencyDashboard currentUser={currentUser} />;
  }

  return <ClientHome currentUser={currentUser} />;
}
