// РљСЌС€РёСЂСѓРµС‚ РѕР±РѕР»РѕС‡РєСѓ РїСЂРёР»РѕР¶РµРЅРёСЏ, С‡С‚РѕР±С‹ РѕРЅРѕ Р±С‹СЃС‚СЂРѕ РѕС‚РєСЂС‹РІР°Р»РѕСЃСЊ Рё СЃС‚Р°РІРёР»РѕСЃСЊ РЅР° С‚РµР»РµС„РѕРЅ.
const CACHE = 'tochka-v20';
const SHELL = [
  './', 'index.html', 'download.html', 'showcase.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
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
  if (e.request.method !== 'GET') return;                       // Р·Р°РїСЂРѕСЃС‹ Рє Overpass РёРґСѓС‚ РјРёРјРѕ РєСЌС€Р°
  if (url.hostname.endsWith('openfreemap.org')) return;          // С‚Р°Р№Р»С‹ РєР°СЂС‚С‹ РЅРµ РєСЌС€РёСЂСѓРµРј
  if (url.hostname.endsWith('openstreetmap.org')) return;        // РїРѕРёСЃРє РіРѕСЂРѕРґРѕРІ вЂ” РІСЃРµРіРґР° СЃРІРµР¶РёР№
  // СЃРІРѕС‘ РїСЂРёР»РѕР¶РµРЅРёРµ: СЃРЅР°С‡Р°Р»Р° СЃРµС‚СЊ (СЃРІРµР¶Р°СЏ РІРµСЂСЃРёСЏ), РїСЂРё РѕС‚СЃСѓС‚СЃС‚РІРёРё СЃРµС‚Рё вЂ” РєСЌС€
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && (url.origin === location.origin || url.hostname === 'unpkg.com')) {
        const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
