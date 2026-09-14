import { useState, type FormEvent } from 'react';
import { Alert, Button, Modal, SelectField, TextAreaField, TextField } from './ui';
import { networkLabel, publicationStatusLabel, strings } from '../lib/strings';
import { fromDateTimeInput, toDateTimeInput } from '../lib/dates';
import { useCompanyMembers } from '../modules/companies/api';
import {
  PUBLICATION_STATUSES,
  useRemovePublication,
  useSavePublication,
  type Publication,
  type PublicationNetwork,
  type PublicationStatus,
} from '../modules/publications/api';

export function PublicationDialog({
  companyId,
  contentId,
  network,
  existing,
  onClose,
  onSaved,
  onRemoved,
}: {
  companyId: string;
  contentId: string;
  network: PublicationNetwork;
  existing?: Publication;
  onClose: () => void;
  onSaved?: () => void;
  onRemoved?: () => void;
}) {
  const save = useSavePublication();
  const remove = useRemovePublication();
  const members = useCompanyMembers(companyId);

  const [form, setForm] = useState({
    status: existing?.status ?? ('planned' as PublicationStatus),
    publishedAt: existing?.publishedAt ? toDateTimeInput(existing.publishedAt) : '',
    link: existing?.link ?? '',
    responsibleUserId: existing?.responsibleUserId ?? '',
    notes: existing?.notes ?? '',
  });

  // A network nobody is posting to has nothing to date or link, and the server refuses
  // the combination — so the form does not offer it in the first place.
  const detailsDisabled = form.status === 'not_planned';
  const pending = save.isPending || remove.isPending;
  const error = save.error ?? remove.error;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    save.mutate(
      {
        contentId,
        network,
        status: form.status,
        publishedAt:
          detailsDisabled || !form.publishedAt ? null : fromDateTimeInput(form.publishedAt),
        link: detailsDisabled || !form.link.trim() ? null : form.link.trim(),
        responsibleUserId: form.responsibleUserId || null,
        notes: form.notes.trim() || null,
      },
      {
        onSuccess: () => {
          onSaved?.();
          onClose();
        },
      },
    );
  };

  const handleRemove = () => {
    if (!window.confirm(strings.publications.confirmRemove)) return;
    remove.mutate(
      { contentId, network },
      {
        onSuccess: () => {
          onRemoved?.();
          onClose();
        },
      },
    );
  };

  return (
    <Modal title={`${strings.publications.title} · ${networkLabel(network)}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && <Alert tone="error">{error.message}</Alert>}

        <SelectField
          label={strings.publications.status}
          value={form.status}
          onChange={(event) =>
            setForm((p) => ({ ...p, status: event.target.value as PublicationStatus }))
          }
          options={PUBLICATION_STATUSES.map((value) => ({
            value,
            label: publicationStatusLabel(value),
          }))}
        />

        <TextField
          label={strings.publications.publishedAt}
          type="datetime-local"
          disabled={detailsDisabled}
          value={form.publishedAt}
          onChange={(event) => setForm((p) => ({ ...p, publishedAt: event.target.value }))}
        />

        <TextField
          label={strings.publications.link}
          type="url"
          inputMode="url"
          placeholder="https://"
          maxLength={2048}
          disabled={detailsDisabled}
          value={form.link}
          onChange={(event) => setForm((p) => ({ ...p, link: event.target.value }))}
        />

        <SelectField
          label={strings.publications.responsible}
          value={form.responsibleUserId}
          onChange={(event) => setForm((p) => ({ ...p, responsibleUserId: event.target.value }))}
          options={[
            { value: '', label: strings.common.none },
            ...(members.data ?? []).map((member) => ({ value: member.id, label: member.name })),
          ]}
        />

        <TextAreaField
          label={strings.publications.notes}
          rows={2}
          maxLength={2000}
          value={form.notes}
          onChange={(event) => setForm((p) => ({ ...p, notes: event.target.value }))}
        />

        <Button type="submit" isLoading={save.isPending}>
          {existing ? strings.common.save : strings.publications.register}
        </Button>

        {existing && (
          <Button
            type="button"
            variant="danger"
            isLoading={remove.isPending}
            onClick={handleRemove}
          >
            {strings.publications.remove}
          </Button>
        )}
      </form>
    </Modal>
  );
}
