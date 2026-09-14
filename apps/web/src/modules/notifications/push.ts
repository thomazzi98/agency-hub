/**
 * Web Push registration in the browser (ADR-0005).
 *
 * Everything here starts with feature detection rather than a browser check: some
 * in-app webviews and older browsers have no Push API at all, and the rule from
 * 08-notifications-and-push.md is that those users never see a permission prompt or a
 * control that cannot work — the app quietly stays in-app-only, exactly as if they had
 * declined. Written as a capability test so it keeps being right as support changes.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/** The VAPID public key travels as base64url; the Push API wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

function encodeKey(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

export interface PushSubscriptionPayload {
  endpoint: string;
  p256dhKey: string;
  authKey: string;
  userAgent: string;
}

/**
 * Asks permission (the caller is responsible for having explained why first — never on
 * page load), subscribes, and returns what the server needs to reach this browser.
 * Returns null when the user declines, which is a normal outcome and not an error.
 */
export async function subscribeToPush(publicKey: string): Promise<PushSubscriptionPayload | null> {
  if (!isPushSupported()) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  return {
    endpoint: subscription.endpoint,
    p256dhKey: encodeKey(subscription.getKey('p256dh')),
    authKey: encodeKey(subscription.getKey('auth')),
    userAgent: navigator.userAgent.slice(0, 400),
  };
}

/** Drops this browser's subscription; the server row is revoked separately. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}
