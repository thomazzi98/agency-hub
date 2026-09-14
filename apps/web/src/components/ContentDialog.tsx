import { useState, type FormEvent } from 'react';
import { Alert, Button, Modal, SelectField, TextAreaField, TextField } from './ui';
import {
  contentTypeLabel,
  productionStatusLabel,
  strings,
  topicPriorityLabel,
} from '../lib/strings';
import { fromDateTimeInput, toDateTimeInput } from '../lib/dates';
import { useCompanyMembers } from '../modules/companies/api';
import {
  useCreateContent,
  useUpdateContent,
  type Content,
  type ContentPriority,
  type ContentType,
  type ProductionStatus,
} from '../modules/calendar/api';

const types: ContentType[] = [
  'video',
  'image',
  'carousel',
  'story',
  'reels',
  'youtube_short',
  'text',
  'custom',
];

const statuses: ProductionStatus[] = [
  'planned',
  'awaiting_material',
  'in_production',
  'in_review',
  'approved',
  'completed',
  'cancelled',
];

const priorities: ContentPriority[] = ['low', 'medium', 'high'];

export function ContentDialog({
  companyId,
  existing,
  defaultDate,
  onClose,
}: {
  companyId: string;
  existing?: Content;
  defaultDate?: Date;
  onClose: () => void;
}) {
  const create = useCreateContent();
  const update = useUpdateContent();
  const members = useCompanyMembers(companyId);

  const [form, setForm] = useState({
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    type: existing?.type ?? ('custom' as ContentType),
    scheduledAt: toDateTimeInput(existing?.scheduledAt ?? defaultDate ?? new Date()),
    responsibleUserId: existing?.responsibleUserId ?? '',
    productionStatus: existing?.productionStatus ?? ('planned' as ProductionStatus),
    priority: existing?.priority ?? ('medium' as ContentPriority),
    notes: existing?.notes ?? '',
  });

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const blankToNull = (value: string) => (value.trim() ? value.trim() : null);
    const payload = {
      title: form.title.trim(),
      description: blankToNull(form.description),
      type: form.type,
      scheduledAt: fromDateTimeInput(form.scheduledAt),
      responsibleUserId: form.responsibleUserId || null,
      productionStatus: form.productionStatus,
      priority: form.priority,
      notes: blankToNull(form.notes),
    };

    if (existing) {
      update.mutate({ id: existing.id, ...payload }, { onSuccess: onClose });
    } else {
      create.mutate({ ...payload, companyId }, { onSuccess: onClose });
    }
  };

  return (
    <Modal
      title={existing ? strings.calendar.editContent : strings.calendar.newContent}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && <Alert tone="error">{error.message}</Alert>}

        <TextField
          label={strings.calendar.contentTitle}
          required
          maxLength={200}
          value={form.title}
          onChange={(event) => setForm((p) => ({ ...p, title: event.target.value }))}
        />

        <TextField
          label={strings.calendar.scheduledAt}
          type="datetime-local"
          required
          value={form.scheduledAt}
          onChange={(event) => setForm((p) => ({ ...p, scheduledAt: event.target.value }))}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={strings.calendar.type}
            value={form.type}
            onChange={(event) =>
              setForm((p) => ({ ...p, type: event.target.value as ContentType }))
            }
            options={types.map((value) => ({ value, label: contentTypeLabel(value) }))}
          />
          <SelectField
            label={strings.calendar.productionStatus}
            value={form.productionStatus}
            onChange={(event) =>
              setForm((p) => ({ ...p, productionStatus: event.target.value as ProductionStatus }))
            }
            options={statuses.map((value) => ({ value, label: productionStatusLabel(value) }))}
          />
          <SelectField
            label={strings.calendar.priority}
            value={form.priority}
            onChange={(event) =>
              setForm((p) => ({ ...p, priority: event.target.value as ContentPriority }))
            }
            options={priorities.map((value) => ({ value, label: topicPriorityLabel(value) }))}
          />
          <SelectField
            label={strings.calendar.responsible}
            value={form.responsibleUserId}
            onChange={(event) => setForm((p) => ({ ...p, responsibleUserId: event.target.value }))}
            options={[
              { value: '', label: strings.common.none },
              ...(members.data ?? []).map((member) => ({
                value: member.id,
                label: member.name,
              })),
            ]}
          />
        </div>

        <TextAreaField
          label={strings.calendar.description}
          rows={3}
          value={form.description}
          onChange={(event) => setForm((p) => ({ ...p, description: event.target.value }))}
        />

        <Button type="submit" isLoading={pending} disabled={!form.title.trim()}>
          {existing ? strings.common.save : strings.common.create}
        </Button>
      </form>
    </Modal>
  );
}
