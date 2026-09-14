import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { strings } from '../lib/strings';
import { useCurrentUser, useLogout } from '../modules/auth/session';
import { useBrand } from '../modules/branding/context';

const navigation = [
  { to: '/', label: strings.home.title, end: true, adminOnly: false },
  { to: '/empresas', label: strings.companies.title, end: false, adminOnly: false },
  { to: '/projetos', label: strings.projects.title, end: false, adminOnly: false },
  { to: '/arquivos', label: strings.files.title, end: false, adminOnly: false },
  { to: '/topicos', label: strings.topics.title, end: false, adminOnly: false },
  { to: '/exclusoes', label: strings.deletionRequests.title, end: false, adminOnly: true },
  { to: '/usuarios', label: strings.users.title, end: false, adminOnly: true },
  { to: '/sessoes', label: strings.sessions.title, end: false, adminOnly: false },
  { to: '/identidade-visual', label: strings.branding.title, end: false, adminOnly: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { data: currentUser } = useCurrentUser();
  const brand = useBrand();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-base font-bold">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.appName} className="h-7 w-auto" />
            ) : (
              <span style={{ color: brand.secondaryColor }}>{brand.appName}</span>
            )}
          </Link>

          {/* A phone cannot fit every section in one row, and a wrapping nav makes the
              sticky header eat the screen. The strip scrolls sideways instead — the one
              place horizontal scrolling is the right answer. */}
          <nav
            className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1 sm:order-2 sm:w-auto sm:overflow-visible"
            aria-label="Principal"
          >
            {navigation
              .filter((item) => !item.adminOnly || currentUser?.role === 'agency_admin')
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `shrink-0 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition ${
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
          </nav>

          <div className="order-2 ml-auto flex items-center gap-3 sm:order-3">
            {currentUser && (
              <span className="hidden text-sm text-slate-500 sm:inline">{currentUser.email}</span>
            )}
            <button
              type="button"
              onClick={() => {
                logout.mutate(undefined, {
                  onSettled: () => {
                    window.location.assign('/entrar');
                  },
                });
              }}
              disabled={logout.isPending}
              className="rounded-md px-2 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            >
              {strings.app.logout}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
