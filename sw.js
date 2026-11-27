// Кэширует оболочку приложения, чтобы оно быстро открывалось и ставилось на телефон.
const CACHE = 'tochka-v38-mobile-start';
const SHELL = [
  'buttons.css?v=1', 'buttons.js?v=1', 'fonts/onest-variable.ttf',
  './', 'index.html', 'download.html', 'showcase.html', 'style.css', 'app.js?v=20261127-mobile1', 'workspace.css?v=20261123-type1', 'workspace.js', 'push.js?v=20261127-guide', 'completeness.js', 'diamond-3d.js', 'golos-cyrillic.woff2', 'golos-latin.woff2', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;                       // запросы к Overpass идут мимо кэша
  if (url.hostname.endsWith('openfreemap.org')) return;          // тайлы карты не кэшируем
  if (url.hostname.endsWith('openstreetmap.org')) return;        // поиск городов — всегда свежий
  // своё приложение: сначала сеть (свежая версия), при отсутствии сети — кэш
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && (url.origin === location.origin || url.hostname === 'unpkg.com')) {
        const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', event => {
  let message = {};
  try { message = event.data?.json() || {}; } catch { /* показываем общий текст */ }
  const city = typeof message.city === 'string' ? message.city : '';
  event.waitUntil(self.registration.showNotification(message.title || 'Новые заведения в «Точке»', {
    body: message.body || 'Откройте карту и посмотрите новые заведения без указанного сайта.',
    icon: new URL('icons/icon-192.png', self.registration.scope).href,
    badge: new URL('icons/icon-192.png', self.registration.scope).href,
    tag: `tochka-new-${city}`,
    data: { url: new URL(`./?pushCity=${encodeURIComponent(city)}`, self.registration.scope).href }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || self.registration.scope;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const windowClient of windows) {
      if (new URL(windowClient.url).origin === self.location.origin && new URL(windowClient.url).pathname.startsWith(new URL(self.registration.scope).pathname)) {
        await windowClient.navigate(target);
        return windowClient.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
