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
import { AdminRoute } from './routes/AdminRoute';

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

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
