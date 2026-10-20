// Кэширует оболочку приложения, чтобы оно быстро открывалось и ставилось на телефон.
const CACHE = 'tochka-v5';
const SHELL = [
  './', 'index.html', 'download.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
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
