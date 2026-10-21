const CACHE = 'checkmed-shell-v06';
const ASSETS = ['./', './index.html', './styles.css', './core.js', './app.js', './manifest.json', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('checkmed-shell-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    } catch {
      return (await cache.match(request)) || (request.mode === 'navigate' ? await cache.match('./index.html') : Response.error());
    }
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.focus();
    let target;
    try { target = new URL(event.notification.data?.url || './', self.registration.scope); if (target.origin !== self.location.origin) target = new URL(self.registration.scope); }
    catch { target = new URL(self.registration.scope); }
    return self.clients.openWindow(target.href);
  }));
});
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || '' }; }
  const isAlarm = payload.type === 'alarm';
  const title = payload.title || (isAlarm ? 'Hora do seu medicamento' : 'CheckMed');
  const options = { body: payload.body || 'Abra o CheckMed para ver seu lembrete.', icon: './icon-192.png', badge: './icon-192.png', tag: payload.tag || `checkmed-${Date.now()}`, data: { url: payload.url || './' }, renotify: Boolean(payload.renotify), requireInteraction: isAlarm };
  if (isAlarm) options.vibrate = [250, 150, 250, 150, 500];
  event.waitUntil(self.registration.showNotification(title, options));
});
