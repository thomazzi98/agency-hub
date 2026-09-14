import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Alert, LoadingScreen } from '../components/ui';
import { strings } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';

export const CHANGE_PASSWORD_PATH = '/alterar-senha';

/**
 * A UX guard only: it hides screens the user cannot use. Every rule it mirrors is
 * enforced server-side, which is the actual security boundary
 * (docs/sdd/16-security-requirements.md#server-side-authorization).
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data: currentUser, isPending, isError, refetch } = useCurrentUser();
  const location = useLocation();

  if (isPending) {
    return <LoadingScreen />;
  }

  if (isError) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <Alert tone="error" onRetry={() => void refetch()}>
            {strings.app.networkError}
          </Alert>
        </div>
      </main>
    );
  }

  if (!currentUser) {
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }

  if (currentUser.mustChangePassword && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }

  return <>{children}</>;
}
