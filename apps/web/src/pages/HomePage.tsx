import { Card, LoadingScreen } from '../components/ui';
import { roleLabel, strings } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';

export default function HomePage() {
  const { data: currentUser, isPending } = useCurrentUser();

  if (isPending || !currentUser) {
    return <LoadingScreen />;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">{strings.home.title}</h1>

      <Card className="flex flex-col gap-3">
        <p className="text-base text-slate-900">{strings.home.welcome(currentUser.name)}</p>

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{strings.home.roleLabel}</dt>
            <dd className="font-medium text-slate-900">{roleLabel(currentUser.role)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{strings.home.companiesLabel}</dt>
            <dd className="font-medium text-slate-900">
              {currentUser.memberships.length > 0
                ? currentUser.memberships.length
                : strings.home.noCompanies}
            </dd>
          </div>
        </dl>
      </Card>

      <p className="text-sm text-slate-500">{strings.home.underConstruction}</p>
    </div>
  );
}
