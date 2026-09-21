// Push handlers, imported into the generated service worker (vite-plugin-pwa importScripts).
// Payloads are small JSON: { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Kalib', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Kalib';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'kalib',
    renotify: false,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => 'focus' in c);
      if (client) {
        if ('navigate' in client && url !== '/') client.navigate(url);
        return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
