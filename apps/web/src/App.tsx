import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute, CHANGE_PASSWORD_PATH } from './routes/ProtectedRoute';
import LoginPage from './modules/auth/LoginPage';
import ChangePasswordPage from './modules/auth/ChangePasswordPage';
import HomePage from './pages/HomePage';
import SessionsPage from './pages/SessionsPage';

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
