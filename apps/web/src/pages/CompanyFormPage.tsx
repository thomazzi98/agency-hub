import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, LoadingScreen, TextAreaField, TextField } from '../components/ui';
import { strings } from '../lib/strings';
import {
  useCompany,
  useCreateCompany,
  useSetCompanyStatus,
  useUpdateCompany,
  type CompanyInput,
} from '../modules/companies/api';

const emptyForm: CompanyInput = {
  name: '',
  segment: '',
  responsibleName: '',
  email: '',
  phone: '',
  notes: '',
};

/** Empty optional fields are sent as null, so clearing one actually clears it. */
function toPayload(form: CompanyInput): CompanyInput {
  const blankToNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

  return {
    name: form.name.trim(),
    segment: blankToNull(form.segment),
    responsibleName: blankToNull(form.responsibleName),
    email: blankToNull(form.email),
    phone: blankToNull(form.phone),
    notes: blankToNull(form.notes),
  };
}

export default function CompanyFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const existing = useCompany(isEditing ? id : undefined);
  const create = useCreateCompany();
  const update = useUpdateCompany(id ?? '');
  const setStatus = useSetCompanyStatus(id ?? '');

  const [form, setForm] = useState<CompanyInput>(emptyForm);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (existing.data) {
      setForm({
        name: existing.data.name,
        segment: existing.data.segment ?? '',
        responsibleName: existing.data.responsibleName ?? '',
        email: existing.data.email ?? '',
        phone: existing.data.phone ?? '',
        notes: existing.data.notes ?? '',
      });
    }
  }, [existing.data]);

  if (isEditing && existing.isPending) {
    return <LoadingScreen />;
  }

  if (isEditing && existing.isError) {
    return <Alert tone="error">{existing.error.message}</Alert>;
  }

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error ?? setStatus.error;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSaved(false);

    const payload = toPayload(form);

    if (isEditing) {
      update.mutate(payload, { onSuccess: () => setSaved(true) });
    } else {
      create.mutate(payload, {
        onSuccess: (company) => navigate(`/empresas/${company.id}`, { replace: true }),
      });
    }
  };

  const field = (key: keyof CompanyInput) => ({
    value: (form[key] as string | null) ?? '',
    onChange: (event: { target: { value: string } }) =>
      setForm((previous) => ({ ...previous, [key]: event.target.value })),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">
          {isEditing ? strings.companies.editTitle : strings.companies.newTitle}
        </h1>
        <Button variant="secondary" onClick={() => navigate('/empresas')}>
          {strings.common.back}
        </Button>
      </div>

      {error && <Alert tone="error">{error.message}</Alert>}
      {saved && <Alert tone="success">{strings.companies.updated}</Alert>}

      <Card>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <TextField label={strings.companies.name} required maxLength={160} {...field('name')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={strings.companies.segment} maxLength={120} {...field('segment')} />
            <TextField
              label={strings.companies.responsibleName}
              maxLength={160}
              {...field('responsibleName')}
            />
            <TextField label={strings.companies.email} type="email" {...field('email')} />
            <TextField label={strings.companies.phone} maxLength={40} {...field('phone')} />
          </div>
          <TextAreaField label={strings.companies.notes} {...field('notes')} />

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              isLoading={pending}
              loadingLabel={isEditing ? strings.common.saving : strings.common.creating}
            >
              {isEditing ? strings.common.save : strings.common.create}
            </Button>

            {isEditing && existing.data && (
              <Button
                type="button"
                variant={existing.data.status === 'active' ? 'danger' : 'secondary'}
                isLoading={setStatus.isPending}
                onClick={() => {
                  const archiving = existing.data.status === 'active';
                  const message = archiving
                    ? strings.companies.confirmArchive
                    : strings.companies.confirmRestore;
                  if (window.confirm(message)) {
                    setStatus.mutate(archiving ? 'archive' : 'restore', {
                      onSuccess: () => void existing.refetch(),
                    });
                  }
                }}
              >
                {existing.data.status === 'active'
                  ? strings.companies.archive
                  : strings.companies.restore}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
