import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, LoadingScreen, TextField } from '../../components/ui';
import { strings } from '../../lib/strings';
import { useChangePassword, useCurrentUser } from './session';

export default function ChangePasswordPage() {
  const { data: currentUser, isPending } = useCurrentUser();
  const changePassword = useChangePassword();
  const navigate = useNavigate();

  const [currentValue, setCurrentValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [mismatch, setMismatch] = useState(false);

  if (isPending) {
    return <LoadingScreen />;
  }

  if (!currentUser) {
    return <Navigate to="/entrar" replace />;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (changePassword.isPending) return;

    if (newValue !== confirmValue) {
      setMismatch(true);
      return;
    }
    setMismatch(false);

    changePassword.mutate(
      { currentPassword: currentValue, newPassword: newValue },
      { onSuccess: () => navigate('/', { replace: true }) },
    );
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Card>
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                {strings.changePassword.title}
              </h1>
              {currentUser.mustChangePassword && (
                <p className="mt-1 text-sm text-slate-500">
                  {strings.changePassword.forcedSubtitle}
                </p>
              )}
            </div>

            {changePassword.isError && <Alert tone="error">{changePassword.error.message}</Alert>}

            <TextField
              label={strings.changePassword.currentPassword}
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              required
              value={currentValue}
              onChange={(event) => setCurrentValue(event.target.value)}
            />

            <TextField
              label={strings.changePassword.newPassword}
              type="password"
              name="newPassword"
              autoComplete="new-password"
              required
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
            />

            <TextField
              label={strings.changePassword.confirmPassword}
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              required
              error={mismatch ? strings.changePassword.mismatch : undefined}
              value={confirmValue}
              onChange={(event) => setConfirmValue(event.target.value)}
            />

            <Button
              type="submit"
              isLoading={changePassword.isPending}
              loadingLabel={strings.changePassword.submitting}
              className="w-full sm:w-full"
            >
              {strings.changePassword.submit}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
