import { useState } from 'react';
import { Alert, Button, Card, Checkbox, Spinner } from './ui';
import { formatDateTime } from '../lib/dates';
import { notificationTypeLabel, strings } from '../lib/strings';
import {
  useNotificationPreferences,
  usePushConfig,
  usePushDevices,
  useRegisterPushDevice,
  useRevokePushDevice,
  useSetNotificationPreference,
} from '../modules/notifications/api';
import { isPushSupported, pushPermission, subscribeToPush } from '../modules/notifications/push';

/**
 * Push registration and the per-event preferences.
 *
 * Nothing here prompts on load. The explanation is on screen first and the browser is
 * only asked after a deliberate click, which is the rule in
 * 08-notifications-and-push.md — and on a browser with no Push API the control is not
 * rendered at all rather than rendered broken.
 */
export function PushSettings() {
  const config = usePushConfig();
  const devices = usePushDevices(config.data?.enabled === true);
  const preferences = useNotificationPreferences();
  const register = useRegisterPushDevice();
  const revoke = useRevokePushDevice();
  const setPreference = useSetNotificationPreference();

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supported = isPushSupported();
  const permission = pushPermission();

  const handleEnable = async () => {
    if (!config.data?.publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const subscription = await subscribeToPush(config.data.publicKey);
      if (!subscription) {
        setError(strings.notifications.pushDenied);
        return;
      }
      await register.mutateAsync(subscription);
      setNotice(strings.notifications.pushEnabled);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          {strings.notifications.pushTitle}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{strings.notifications.pushExplain}</p>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {/* A preference that silently failed to save would look exactly like one that
          saved, so the mutation's own error is surfaced here too. */}
      {(error ?? setPreference.error?.message ?? revoke.error?.message) && (
        <Alert tone="error">{error ?? setPreference.error?.message ?? revoke.error?.message}</Alert>
      )}

      {config.data && !config.data.enabled && (
        <Alert tone="info">{strings.notifications.pushUnavailable}</Alert>
      )}

      {config.data?.enabled && supported && (
        <>
          {permission === 'denied' ? (
            <Alert tone="info">{strings.notifications.pushDenied}</Alert>
          ) : (
            <Button onClick={() => void handleEnable()} isLoading={busy}>
              {strings.notifications.pushEnable}
            </Button>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-slate-700">
              {strings.notifications.pushDevices}
            </h3>
            {devices.isPending ? (
              <Spinner className="h-4 w-4" />
            ) : devices.data && devices.data.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {devices.data.map((device) => (
                  <li
                    key={device.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-800">
                        {device.userAgent ?? device.fingerprint}
                      </p>
                      <p className="text-xs text-slate-500">{formatDateTime(device.createdAt)}</p>
                    </div>
                    <Button
                      variant="danger"
                      onClick={() => {
                        // Every destructive action confirms first
                        // (22-acceptance-criteria.md #29). Removing a registration
                        // silently stops that device being reachable, and the only
                        // way back is to grant the browser permission again.
                        if (!window.confirm(strings.notifications.pushConfirmRemove)) return;
                        revoke.mutate(device.id, {
                          onSuccess: () => setNotice(strings.notifications.pushRemoved),
                        });
                      }}
                    >
                      {strings.notifications.pushRemove}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">{strings.notifications.pushNoDevices}</p>
            )}
          </section>
        </>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{strings.notifications.settings}</h3>
        <p className="text-xs text-slate-500">{strings.notifications.preferencesHint}</p>

        {preferences.isPending ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <ul className="flex flex-col gap-1">
            {(preferences.data ?? []).map((preference) => (
              <li key={preference.eventType}>
                <Checkbox
                  label={notificationTypeLabel(preference.eventType)}
                  checked={preference.enabled}
                  onChange={(event) =>
                    setPreference.mutate(
                      { eventType: preference.eventType, enabled: event.target.checked },
                      { onSuccess: () => setNotice(strings.notifications.saved) },
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
