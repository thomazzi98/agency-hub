import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert, Button, Card, TextField } from '../../components/ui';
import { strings } from '../../lib/strings';
import { useCurrentUser, useLogin } from './session';

export default function LoginPage() {
  const { data: currentUser } = useCurrentUser();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (currentUser) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (login.isPending) return;
    // The form state is intentionally never cleared on failure.
    login.mutate({ email: email.trim(), password });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-slate-900">{strings.app.name}</h1>
        <p className="mb-6 text-center text-sm text-slate-500">{strings.login.subtitle}</p>

        <Card>
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-slate-900">{strings.login.title}</h2>

            {login.isError && <Alert tone="error">{login.error.message}</Alert>}

            <TextField
              label={strings.login.email}
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <TextField
              label={strings.login.password}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <Button
              type="submit"
              isLoading={login.isPending}
              loadingLabel={strings.login.submitting}
              className="w-full sm:w-full"
            >
              {strings.login.submit}
            </Button>

            <p className="text-center text-xs text-slate-500">{strings.login.noAccountHelp}</p>
          </form>
        </Card>
      </div>
    </main>
  );
}
