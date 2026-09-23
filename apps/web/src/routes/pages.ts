import { lazyPage } from '../lib/lazyPage';

/**
 * Every screen fetched on demand, in one place so they can also be fetched ahead.
 *
 * Splitting keeps the first load small - the sign-in screen on a phone no longer
 * downloads every screen and the upload library - but a first visit to a section then
 * waits for its code, and during that wait the router keeps the previous screen up with
 * no sign that the tap registered. `preloadPages` closes that gap: once the app is idle
 * the rest arrive in the background, so by the time someone navigates, the code is
 * already there.
 */
const loaders = {
  SessionsPage: () => import('../pages/SessionsPage'),
  CompaniesPage: () => import('../pages/CompaniesPage'),
  CompanyFormPage: () => import('../pages/CompanyFormPage'),
  UsersPage: () => import('../pages/UsersPage'),
  UserFormPage: () => import('../pages/UserFormPage'),
  ProjectsPage: () => import('../pages/ProjectsPage'),
  ProjectFormPage: () => import('../pages/ProjectFormPage'),
  FilesPage: () => import('../pages/FilesPage'),
  DeletionRequestsPage: () => import('../pages/DeletionRequestsPage'),
  CalendarPage: () => import('../pages/CalendarPage'),
  PublicationsPage: () => import('../pages/PublicationsPage'),
  PendingRequestsPage: () => import('../pages/PendingRequestsPage'),
  NotificationsPage: () => import('../pages/NotificationsPage'),
  CampaignsPage: () => import('../pages/CampaignsPage'),
  BackupsPage: () => import('../pages/BackupsPage'),
  CampaignDetailPage: () => import('../pages/CampaignDetailPage'),
  PendingRequestDetailPage: () => import('../pages/PendingRequestDetailPage'),
  TopicsPage: () => import('../pages/TopicsPage'),
  TopicDetailPage: () => import('../pages/TopicDetailPage'),
  BrandingPage: () => import('../pages/BrandingPage'),
};

export const SessionsPage = lazyPage(loaders.SessionsPage);
export const CompaniesPage = lazyPage(loaders.CompaniesPage);
export const CompanyFormPage = lazyPage(loaders.CompanyFormPage);
export const UsersPage = lazyPage(loaders.UsersPage);
export const UserFormPage = lazyPage(loaders.UserFormPage);
export const ProjectsPage = lazyPage(loaders.ProjectsPage);
export const ProjectFormPage = lazyPage(loaders.ProjectFormPage);
export const FilesPage = lazyPage(loaders.FilesPage);
export const DeletionRequestsPage = lazyPage(loaders.DeletionRequestsPage);
export const CalendarPage = lazyPage(loaders.CalendarPage);
export const PublicationsPage = lazyPage(loaders.PublicationsPage);
export const PendingRequestsPage = lazyPage(loaders.PendingRequestsPage);
export const NotificationsPage = lazyPage(loaders.NotificationsPage);
export const CampaignsPage = lazyPage(loaders.CampaignsPage);
export const BackupsPage = lazyPage(loaders.BackupsPage);
export const CampaignDetailPage = lazyPage(loaders.CampaignDetailPage);
export const PendingRequestDetailPage = lazyPage(loaders.PendingRequestDetailPage);
export const TopicsPage = lazyPage(loaders.TopicsPage);
export const TopicDetailPage = lazyPage(loaders.TopicDetailPage);
export const BrandingPage = lazyPage(loaders.BrandingPage);

let preloaded = false;

/**
 * Fetches the remaining screens once, when the browser has nothing better to do. A
 * failure here is harmless - the screen is fetched again, with its own handling, when
 * it is actually opened.
 */
export function preloadPages(): () => void {
  if (preloaded) return () => undefined;

  const run = () => {
    preloaded = true;
    for (const load of Object.values(loaders)) {
      load().catch(() => undefined);
    }
  };

  // Declared on every Window by the DOM typings, but absent in Safari at runtime.
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 5000 });
    return () => window.cancelIdleCallback(handle);
  }
  // Without it, a short delay keeps the fetching off the first paint.
  const handle = setTimeout(run, 1500);
  return () => clearTimeout(handle);
}
