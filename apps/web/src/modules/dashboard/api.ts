import { useQuery } from '@tanstack/react-query';
import { apiRequest, queryString } from '../../lib/api';
import type { ContentPriority, ContentType, ProductionStatus } from '../calendar/api';
import type { PendingRequestStatus } from '../pending-requests/api';

export interface DashboardFileCard {
  id: string;
  companyId: string;
  originalName: string;
  status: string;
  uploadedAt: string;
  uploadedById: string | null;
}

export interface DashboardContentCard {
  id: string;
  companyId: string;
  title: string;
  type: ContentType;
  scheduledAt: string;
  productionStatus: ProductionStatus;
  priority: ContentPriority;
  responsibleUserId: string | null;
}

export interface DashboardRequestCard {
  id: string;
  companyId: string;
  title: string;
  status: PendingRequestStatus;
  priority: ContentPriority;
  dueDate: string | null;
  responsibleUserId: string | null;
}

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  companyId: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface AgencyDashboard {
  activeCompanies: number;
  recentFiles: DashboardFileCard[];
  todayContent: DashboardContentCard[];
  overdueContent: DashboardContentCard[];
  counts: {
    today: number;
    overdue: number;
    inProduction: number;
    awaitingApproval: number;
    requestsAwaitingClient: number;
    requestsOverdue: number;
    pendingPublications: number;
    campaignsNeedingAttention: number;
    unreadNotifications: number;
  };
  requestsOverdueItems: DashboardRequestCard[];
  /** Null for an `agency_manager`: the audit log is admin-only to read. */
  recentActivity: ActivityEntry[] | null;
}

export interface CompanyDashboard {
  companyId: string;
  counts: {
    plannedContent: number;
    inProduction: number;
    openRequests: number;
    /** Every request waiting on the reader; `myRequests` below lists only the first few. */
    myRequests: number;
    activeProjects: number;
    pendingPublications: number;
    unreadNotifications: number;
    campaigns: number;
  };
  upcomingContent: DashboardContentCard[];
  recentFiles: DashboardFileCard[];
  myRequests: DashboardRequestCard[];
}

export interface DashboardFilters {
  companyId?: string;
  responsibleUserId?: string;
  from?: string;
  to?: string;
  priority?: ContentPriority;
  productionStatus?: ProductionStatus;
}

export function useAgencyDashboard(filters: DashboardFilters, enabled = true) {
  return useQuery({
    queryKey: ['dashboard', 'agency', filters],
    queryFn: () => apiRequest<AgencyDashboard>(`/dashboard/agency${queryString({ ...filters })}`),
    enabled,
  });
}

export function useCompanyDashboard(companyId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', 'company', companyId],
    queryFn: () => apiRequest<CompanyDashboard>(`/dashboard/company${queryString({ companyId })}`),
    enabled: Boolean(companyId),
  });
}
