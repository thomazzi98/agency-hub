import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Alert } from '../components/ui';
import { strings } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import { ProtectedRoute } from './ProtectedRoute';

function AdminOnly({ children }: { children: ReactNode }) {
  const { data: currentUser } = useCurrentUser();

  if (!currentUser) {
    return <Navigate to="/entrar" replace />;
  }

  // Purely a UX guard — the API refuses these operations regardless of what the
  // frontend renders (16-security-requirements.md#server-side-authorization).
  if (currentUser.role !== 'agency_admin') {
    return <Alert tone="error">{strings.errors.forbidden}</Alert>;
  }

  return <>{children}</>;
}

export function AdminRoute({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <AppShell>
        <AdminOnly>{children}</AdminOnly>
      </AppShell>
    </ProtectedRoute>
  );
}
