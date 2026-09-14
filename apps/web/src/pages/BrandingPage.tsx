import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, TextField } from '../components/ui';
import { MINIMUM_CONTRAST_RATIO, contrastRatio, meetsMinimumContrast } from '../lib/color';
import { strings } from '../lib/strings';
import {
  useBranding,
  useUpdateBranding,
  useUploadBrandingAsset,
  type BrandingAssetKind,
  type BrandingInput,
} from '../modules/branding/api';

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

function AssetUpload({
  kind,
  label,
  accept,
  currentUrl,
}: {
  kind: BrandingAssetKind;
  label: string;
  accept: string;
  currentUrl: string;
}) {
  const upload = useUploadBrandingAsset();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {currentUrl && (
          <img
            src={currentUrl}
            alt={label}
            className="h-10 w-auto rounded border border-slate-200"
          />
        )}
        <div className="flex-1">
          <label className="text-sm font-medium text-slate-700" htmlFor={`asset-${kind}`}>
            {label}
          </label>
          <input
            id={`asset-${kind}`}
            type="file"
            accept={accept}
            disabled={upload.isPending}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate({ kind, file });
              event.target.value = '';
            }}
          />
        </div>
      </div>
      {upload.isError && <Alert tone="error">{upload.error.message}</Alert>}
      {upload.isSuccess && <Alert tone="success">{strings.branding.assetUploaded}</Alert>}
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

          <Button type="submit" isLoading={update.isPending} disabled={blocked}>
            {strings.common.save}
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{strings.branding.assets}</h2>
          <p className="mt-1 text-xs text-slate-500">{strings.branding.assetHint}</p>
        </div>

        <AssetUpload
          kind="logo"
          label={strings.branding.logoUrl}
          accept="image/svg+xml,image/png,image/webp"
          currentUrl={form.logoUrl}
        />
        <AssetUpload
          kind="favicon"
          label={strings.branding.faviconUrl}
          accept="image/png,image/x-icon,.ico"
          currentUrl={form.faviconUrl}
        />
        <AssetUpload
          kind="loginImage"
          label={strings.branding.loginImageUrl}
          accept="image/jpeg,image/png,image/webp"
          currentUrl={form.loginImageUrl}
        />
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
