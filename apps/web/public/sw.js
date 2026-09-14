/*
 * Service worker for Web Push (docs/decisions/0005-push-notifications.md).
 *
 * It does exactly two things: show what the server sent, and open the page it points
 * at. No caching and no offline behaviour — the app is not a PWA, and a stale cached
 * shell would be a worse problem than the one it solved.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Agency Hub', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Agency Hub', {
      body: payload.body || '',
      // The payload deliberately carries no more than a lock-screen preview should:
      // opening the app is what shows the content.
      tag: payload.notificationId || undefined,
      renotify: Boolean(payload.notificationId),
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse a tab that is already open rather than piling up new ones.
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
