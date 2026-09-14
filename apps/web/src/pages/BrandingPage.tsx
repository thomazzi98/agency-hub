import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, TextField } from '../components/ui';
import { MINIMUM_CONTRAST_RATIO, contrastRatio, meetsMinimumContrast } from '../lib/color';
import { strings } from '../lib/strings';
import { useBranding, useUpdateBranding, type BrandingInput } from '../modules/branding/api';

interface FormState {
  appName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  faviconUrl: string;
  loginImageUrl: string;
  loginMessage: string;
}

const emptyForm: FormState = {
  appName: '',
  primaryColor: '#1d4ed8',
  secondaryColor: '#0f172a',
  logoUrl: '',
  faviconUrl: '',
  loginImageUrl: '',
  loginMessage: '',
};

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const readable = meetsMinimumContrast(value);
  const ratio = contrastRatio(value, '#ffffff');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-3">
        <input
          type="color"
          aria-label={`${label} (seletor)`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
        />
        <div className="flex-1">
          <TextField
            label={label}
            value={value}
            maxLength={7}
            onChange={(event) => onChange(event.target.value)}
            error={readable ? undefined : strings.branding.contrastError}
          />
        </div>
      </div>
      {readable && (
        <p className="text-xs text-slate-500">
          {strings.branding.contrastOk(ratio.toFixed(1), MINIMUM_CONTRAST_RATIO)}
        </p>
      )}
    </div>
  );
}

export default function BrandingPage() {
  const branding = useBranding();
  const update = useUpdateBranding();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (branding.data) {
      setForm({
        appName: branding.data.appName,
        primaryColor: branding.data.primaryColor,
        secondaryColor: branding.data.secondaryColor,
        logoUrl: branding.data.logoUrl ?? '',
        faviconUrl: branding.data.faviconUrl ?? '',
        loginImageUrl: branding.data.loginImageUrl ?? '',
        loginMessage: branding.data.loginMessage ?? '',
      });
    }
  }, [branding.data]);

  const blocked =
    !meetsMinimumContrast(form.primaryColor) || !meetsMinimumContrast(form.secondaryColor);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending || blocked) return;
    setSaved(false);

    const blankToNull = (value: string) => (value.trim() ? value.trim() : null);
    const payload: BrandingInput = {
      appName: form.appName.trim(),
      primaryColor: form.primaryColor.toLowerCase(),
      secondaryColor: form.secondaryColor.toLowerCase(),
      logoUrl: blankToNull(form.logoUrl),
      faviconUrl: blankToNull(form.faviconUrl),
      loginImageUrl: blankToNull(form.loginImageUrl),
      loginMessage: blankToNull(form.loginMessage),
    };

    update.mutate(payload, { onSuccess: () => setSaved(true) });
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">{strings.branding.title}</h1>

      {update.isError && <Alert tone="error">{update.error.message}</Alert>}
      {saved && <Alert tone="success">{strings.branding.saved}</Alert>}

      <Card>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <TextField
            label={strings.branding.appName}
            required
            maxLength={60}
            value={form.appName}
            onChange={(event) => setForm((p) => ({ ...p, appName: event.target.value }))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField
              label={strings.branding.primaryColor}
              value={form.primaryColor}
              onChange={(next) => setForm((p) => ({ ...p, primaryColor: next }))}
            />
            <ColorField
              label={strings.branding.secondaryColor}
              value={form.secondaryColor}
              onChange={(next) => setForm((p) => ({ ...p, secondaryColor: next }))}
            />
          </div>

          <TextField
            label={strings.branding.loginMessage}
            maxLength={280}
            value={form.loginMessage}
            onChange={(event) => setForm((p) => ({ ...p, loginMessage: event.target.value }))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={strings.branding.logoUrl}
              type="url"
              hint={strings.branding.assetHint}
              value={form.logoUrl}
              onChange={(event) => setForm((p) => ({ ...p, logoUrl: event.target.value }))}
            />
            <TextField
              label={strings.branding.faviconUrl}
              type="url"
              value={form.faviconUrl}
              onChange={(event) => setForm((p) => ({ ...p, faviconUrl: event.target.value }))}
            />
          </div>

          <TextField
            label={strings.branding.loginImageUrl}
            type="url"
            value={form.loginImageUrl}
            onChange={(event) => setForm((p) => ({ ...p, loginImageUrl: event.target.value }))}
          />

          <Button type="submit" isLoading={update.isPending} disabled={blocked}>
            {strings.common.save}
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">{strings.branding.preview}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: form.primaryColor }}
          >
            {strings.branding.previewButton}
          </span>
          <span
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: form.secondaryColor }}
          >
            {form.appName || strings.app.name}
          </span>
        </div>
      </Card>
    </div>
  );
}
