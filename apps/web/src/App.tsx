import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute, CHANGE_PASSWORD_PATH } from './routes/ProtectedRoute';
import LoginPage from './modules/auth/LoginPage';
import ChangePasswordPage from './modules/auth/ChangePasswordPage';
import HomePage from './pages/HomePage';
import SessionsPage from './pages/SessionsPage';
import CompaniesPage from './pages/CompaniesPage';
import CompanyFormPage from './pages/CompanyFormPage';
import UsersPage from './pages/UsersPage';
import UserFormPage from './pages/UserFormPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectFormPage from './pages/ProjectFormPage';
import FilesPage from './pages/FilesPage';
import DeletionRequestsPage from './pages/DeletionRequestsPage';
import CalendarPage from './pages/CalendarPage';
import PublicationsPage from './pages/PublicationsPage';
import PendingRequestsPage from './pages/PendingRequestsPage';
import PendingRequestDetailPage from './pages/PendingRequestDetailPage';
import TopicsPage from './pages/TopicsPage';
import TopicDetailPage from './pages/TopicDetailPage';
import BrandingPage from './pages/BrandingPage';
import { AdminRoute } from './routes/AdminRoute';
import { BrandingProvider } from './modules/branding/BrandingProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401/403 is an authorization answer, not a transient failure worth retrying.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/entrar" element={<LoginPage />} />

            <Route
              path={CHANGE_PASSWORD_PATH}
              element={
                <ProtectedRoute>
                  <ChangePasswordPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <HomePage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/empresas"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <CompaniesPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/empresas/nova"
              element={
                <AdminRoute>
                  <CompanyFormPage />
                </AdminRoute>
              }
            />

            <Route
              path="/empresas/:id"
              element={
                <AdminRoute>
                  <CompanyFormPage />
                </AdminRoute>
              }
            />

            <Route
              path="/projetos"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <ProjectsPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/projetos/novo"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <ProjectFormPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/projetos/:id"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <ProjectFormPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/arquivos"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <FilesPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/calendario"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <CalendarPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/publicacoes"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <PublicationsPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/pendencias"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <PendingRequestsPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/pendencias/:id"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <PendingRequestDetailPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/topicos"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <TopicsPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/topicos/:id"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <TopicDetailPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/exclusoes"
              element={
                <AdminRoute>
                  <DeletionRequestsPage />
                </AdminRoute>
              }
            />

            <Route
              path="/usuarios"
              element={
                <AdminRoute>
                  <UsersPage />
                </AdminRoute>
              }
            />

            <Route
              path="/usuarios/novo"
              element={
                <AdminRoute>
                  <UserFormPage />
                </AdminRoute>
              }
            />

            <Route
              path="/usuarios/:id"
              element={
                <AdminRoute>
                  <UserFormPage />
                </AdminRoute>
              }
            />

            <Route
              path="/sessoes"
              element={
                <ProtectedRoute>
                  <AppShell>
                    <SessionsPage />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/identidade-visual"
              element={
                <AdminRoute>
                  <BrandingPage />
                </AdminRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </BrandingProvider>
    </QueryClientProvider>
  );
}
