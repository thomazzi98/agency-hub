import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CompanySelect } from '../components/CompanySelect';
import {
  Alert,
  Button,
  Card,
  LoadingScreen,
  SelectField,
  TextAreaField,
  TextField,
} from '../components/ui';
import { projectStatusLabel, projectTypeLabel, strings } from '../lib/strings';
import {
  useCreateProject,
  useProject,
  useUpdateProject,
  type ProjectStatus,
  type ProjectType,
} from '../modules/projects/api';

const typeOptions = (
  ['property', 'product', 'service', 'event', 'campaign', 'internal', 'other'] as const
).map((type) => ({ value: type, label: projectTypeLabel(type) }));

const statusOptions = (['planned', 'active', 'paused', 'completed', 'archived'] as const).map(
  (status) => ({ value: status, label: projectStatusLabel(status) }),
);

interface FormState {
  companyId: string;
  name: string;
  code: string;
  type: ProjectType;
  status: ProjectStatus;
  description: string;
  startDate: string;
  endDate: string;
  notes: string;
}

const emptyForm: FormState = {
  companyId: '',
  name: '',
  code: '',
  type: 'other',
  status: 'active',
  description: '',
  startDate: '',
  endDate: '',
  notes: '',
};

/** The API stores dates only; an ISO timestamp has to be trimmed for a date input. */
const toDateInput = (value: string | null) => (value ? value.slice(0, 10) : '');

export default function ProjectFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const existing = useProject(isEditing ? id : undefined);
  const create = useCreateProject();
  const update = useUpdateProject(id ?? '');

  const [form, setForm] = useState<FormState>(emptyForm);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (existing.data) {
      setForm({
        companyId: existing.data.companyId,
        name: existing.data.name,
        code: existing.data.code ?? '',
        type: existing.data.type,
        status: existing.data.status,
        description: existing.data.description ?? '',
        startDate: toDateInput(existing.data.startDate),
        endDate: toDateInput(existing.data.endDate),
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
  const error = create.error ?? update.error;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSaved(false);

    const blankToNull = (value: string) => (value.trim() ? value.trim() : null);
    const payload = {
      name: form.name.trim(),
      code: blankToNull(form.code),
      type: form.type,
      status: form.status,
      description: blankToNull(form.description),
      startDate: blankToNull(form.startDate),
      endDate: blankToNull(form.endDate),
      notes: blankToNull(form.notes),
    };

    if (isEditing) {
      update.mutate(payload, { onSuccess: () => setSaved(true) });
    } else {
      create.mutate(
        { ...payload, companyId: form.companyId },
        { onSuccess: (project) => navigate(`/projetos/${project.id}`, { replace: true }) },
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">
          {isEditing ? strings.projects.editTitle : strings.projects.newTitle}
        </h1>
        <Button variant="secondary" onClick={() => navigate('/projetos')}>
          {strings.common.back}
        </Button>
      </div>

      {error && <Alert tone="error">{error.message}</Alert>}
      {saved && <Alert tone="success">{strings.projects.updated}</Alert>}

      <Card>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {!isEditing && (
            <CompanySelect
              value={form.companyId}
              onChange={(companyId) => setForm((p) => ({ ...p, companyId }))}
            />
          )}

          <TextField
            label={strings.projects.name}
            required
            maxLength={160}
            value={form.name}
            onChange={(event) => setForm((p) => ({ ...p, name: event.target.value }))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={strings.projects.code}
              maxLength={40}
              value={form.code}
              onChange={(event) => setForm((p) => ({ ...p, code: event.target.value }))}
            />
            <SelectField
              label={strings.projects.type}
              value={form.type}
              onChange={(event) =>
                setForm((p) => ({ ...p, type: event.target.value as ProjectType }))
              }
              options={typeOptions}
            />
            <SelectField
              label={strings.projects.status}
              value={form.status}
              onChange={(event) =>
                setForm((p) => ({ ...p, status: event.target.value as ProjectStatus }))
              }
              options={statusOptions}
            />
            <div />
            <TextField
              label={strings.projects.startDate}
              type="date"
              value={form.startDate}
              onChange={(event) => setForm((p) => ({ ...p, startDate: event.target.value }))}
            />
            <TextField
              label={strings.projects.endDate}
              type="date"
              value={form.endDate}
              onChange={(event) => setForm((p) => ({ ...p, endDate: event.target.value }))}
            />
          </div>

          <TextAreaField
            label={strings.projects.description}
            value={form.description}
            onChange={(event) => setForm((p) => ({ ...p, description: event.target.value }))}
          />
          <TextAreaField
            label={strings.projects.notes}
            rows={3}
            value={form.notes}
            onChange={(event) => setForm((p) => ({ ...p, notes: event.target.value }))}
          />

          <Button
            type="submit"
            isLoading={pending}
            loadingLabel={isEditing ? strings.common.saving : strings.common.creating}
            disabled={!isEditing && !form.companyId}
          >
            {isEditing ? strings.common.save : strings.common.create}
          </Button>
        </form>
      </Card>
    </div>
  );
}
