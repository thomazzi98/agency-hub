import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  LoadingScreen,
  Modal,
  SelectField,
  TextField,
} from '../components/ui';
import { roleLabel, strings } from '../lib/strings';
import { useCompanies } from '../modules/companies/api';
import {
  useCreateUser,
  useGrantMembership,
  useResetUserPassword,
  useRevokeMembership,
  useUpdateMembership,
  useUpdateUser,
  useUser,
  type Role,
} from '../modules/users/api';

const roleOptions: { value: Role; label: string }[] = [
  { value: 'agency_admin', label: roleLabel('agency_admin') },
  { value: 'agency_manager', label: roleLabel('agency_manager') },
  { value: 'client_manager', label: roleLabel('client_manager') },
  { value: 'contributor', label: roleLabel('contributor') },
];

/**
 * The checkbox reflects the click immediately and reverts if the request fails.
 * Waiting for the server round-trip would leave the control visibly unresponsive on
 * a slow mobile connection, which reads as a broken toggle rather than a pending one.
 */
function MembershipToggle({
  label,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => Promise<void>;
}) {
  const [optimistic, setOptimistic] = useState(checked);

  useEffect(() => {
    setOptimistic(checked);
  }, [checked]);

  return (
    <Checkbox
      label={label}
      checked={optimistic}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.checked;
        setOptimistic(next);
        void onToggle(next).catch(() => setOptimistic(!next));
      }}
    />
  );
}

function TemporaryPasswordDialog({ password, onClose }: { password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <Modal title={strings.users.temporaryPasswordTitle} onClose={onClose}>
      <Alert tone="info">{strings.users.temporaryPasswordWarning}</Alert>
      <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2.5 font-mono text-base break-all text-slate-900">
        {password}
      </p>
      <Button
        variant="secondary"
        className="mt-3"
        onClick={() => {
          void navigator.clipboard?.writeText(password).then(() => setCopied(true));
        }}
      >
        {copied ? strings.common.copied : strings.common.copy}
      </Button>
    </Modal>
  );
}

export default function UserFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const existing = useUser(isEditing ? id : undefined);
  const companies = useCompanies({ page: 1, status: 'all' });

  const create = useCreateUser();
  const update = useUpdateUser(id ?? '');
  const resetPassword = useResetUserPassword(id ?? '');
  const grant = useGrantMembership();
  const updateMembership = useUpdateMembership();
  const revoke = useRevokeMembership();

  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'contributor' as Role,
    status: 'active' as 'active' | 'inactive',
    initialPassword: '',
  });
  const [companyToAdd, setCompanyToAdd] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data) {
      setForm({
        name: existing.data.name,
        email: existing.data.email,
        role: existing.data.role,
        status: existing.data.status,
        initialPassword: '',
      });
    }
  }, [existing.data]);

  if (isEditing && existing.isPending) {
    return <LoadingScreen />;
  }
  if (isEditing && existing.isError) {
    return <Alert tone="error">{existing.error.message}</Alert>;
  }

  const activeMemberships = (existing.data?.memberships ?? []).filter(
    (membership) => membership.status === 'active',
  );
  const availableCompanies = (companies.data?.rows ?? []).filter(
    (company) => !activeMemberships.some((membership) => membership.companyId === company.id),
  );
  const companyName = (companyId: string) =>
    companies.data?.rows.find((company) => company.id === companyId)?.name ?? companyId;

  const pending = create.isPending || update.isPending;
  const error =
    create.error ??
    update.error ??
    resetPassword.error ??
    grant.error ??
    revoke.error ??
    updateMembership.error;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSaved(null);

    if (isEditing) {
      update.mutate(
        {
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
          status: form.status,
        },
        { onSuccess: () => setSaved(strings.users.updated) },
      );
      return;
    }

    create.mutate(
      {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        status: form.status,
        initialPassword: form.initialPassword.trim() || undefined,
        memberships: [],
      },
      {
        onSuccess: (user) => {
          setTemporaryPassword(user.temporaryPassword);
          navigate(`/usuarios/${user.id}`, { replace: true });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {temporaryPassword && (
        <TemporaryPasswordDialog
          password={temporaryPassword}
          onClose={() => setTemporaryPassword(null)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">
          {isEditing ? strings.users.editTitle : strings.users.newTitle}
        </h1>
        <Button variant="secondary" onClick={() => navigate('/usuarios')}>
          {strings.common.back}
        </Button>
      </div>

      {error && <Alert tone="error">{error.message}</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}

      <Card>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <TextField
            label={strings.users.name}
            required
            maxLength={160}
            value={form.name}
            onChange={(event) => setForm((p) => ({ ...p, name: event.target.value }))}
          />
          <TextField
            label={strings.users.email}
            type="email"
            required
            value={form.email}
            onChange={(event) => setForm((p) => ({ ...p, email: event.target.value }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={strings.users.role}
              value={form.role}
              onChange={(event) => setForm((p) => ({ ...p, role: event.target.value as Role }))}
              options={roleOptions}
            />
            <SelectField
              label={strings.users.status}
              value={form.status}
              onChange={(event) =>
                setForm((p) => ({ ...p, status: event.target.value as 'active' | 'inactive' }))
              }
              options={[
                { value: 'active', label: strings.users.statusActive },
                { value: 'inactive', label: strings.users.statusInactive },
              ]}
            />
          </div>

          {!isEditing && (
            <TextField
              label={strings.users.initialPassword}
              type="password"
              autoComplete="new-password"
              hint={strings.users.initialPasswordHint}
              value={form.initialPassword}
              onChange={(event) => setForm((p) => ({ ...p, initialPassword: event.target.value }))}
            />
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              isLoading={pending}
              loadingLabel={isEditing ? strings.common.saving : strings.common.creating}
            >
              {isEditing ? strings.common.save : strings.common.create}
            </Button>

            {isEditing && (
              <Button
                type="button"
                variant="secondary"
                isLoading={resetPassword.isPending}
                onClick={() => {
                  if (window.confirm(strings.users.confirmResetPassword)) {
                    resetPassword.mutate(undefined, {
                      onSuccess: (result) => setTemporaryPassword(result.temporaryPassword),
                    });
                  }
                }}
              >
                {strings.users.resetPassword}
              </Button>
            )}
          </div>
        </form>
      </Card>

      {isEditing && (
        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{strings.memberships.title}</h2>
            <p className="mt-1 text-xs text-slate-500">{strings.memberships.permissionsNote}</p>
          </div>

          {activeMemberships.length === 0 ? (
            <EmptyState title={strings.memberships.empty} />
          ) : (
            <ul className="flex flex-col gap-3">
              {activeMemberships.map((membership) => (
                <li
                  key={membership.id}
                  className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">
                      {companyName(membership.companyId)}
                    </p>
                    <Button
                      variant="danger"
                      isLoading={revoke.isPending && revoke.variables === membership.id}
                      onClick={() => {
                        if (window.confirm(strings.memberships.confirmRevoke)) {
                          revoke.mutate(membership.id, {
                            onSuccess: () => {
                              setSaved(strings.memberships.revoked);
                              void existing.refetch();
                            },
                          });
                        }
                      }}
                    >
                      {strings.memberships.revoke}
                    </Button>
                  </div>

                  <div className="flex flex-col gap-2">
                    <MembershipToggle
                      label={strings.memberships.canManageCampaigns}
                      checked={membership.canManageCampaigns}
                      disabled={updateMembership.isPending}
                      onToggle={async (next) => {
                        await updateMembership.mutateAsync({
                          id: membership.id,
                          canManageCampaigns: next,
                        });
                        setSaved(strings.memberships.updated);
                        await existing.refetch();
                      }}
                    />
                    <MembershipToggle
                      label={strings.memberships.canDeleteCompanyFiles}
                      checked={membership.canDeleteCompanyFiles}
                      disabled={updateMembership.isPending}
                      onToggle={async (next) => {
                        await updateMembership.mutateAsync({
                          id: membership.id,
                          canDeleteCompanyFiles: next,
                        });
                        setSaved(strings.memberships.updated);
                        await existing.refetch();
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {availableCompanies.length > 0 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <SelectField
                  label={strings.memberships.company}
                  value={companyToAdd}
                  onChange={(event) => setCompanyToAdd(event.target.value)}
                  options={[
                    { value: '', label: strings.common.none },
                    ...availableCompanies.map((company) => ({
                      value: company.id,
                      label: company.name,
                    })),
                  ]}
                />
              </div>
              <Button
                disabled={!companyToAdd}
                isLoading={grant.isPending}
                onClick={() =>
                  grant.mutate(
                    {
                      userId: id ?? '',
                      companyId: companyToAdd,
                      canManageCampaigns: false,
                      canDeleteCompanyFiles: false,
                    },
                    {
                      onSuccess: () => {
                        setCompanyToAdd('');
                        setSaved(strings.memberships.granted);
                        void existing.refetch();
                      },
                    },
                  )
                }
              >
                {strings.memberships.add}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{strings.memberships.noCompaniesLeft}</p>
          )}
        </Card>
      )}
    </div>
  );
}
