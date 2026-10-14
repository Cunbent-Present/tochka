'use strict';
/* Точка — 3D-карта салонов красоты и барбершопов по всей России.
   Карта: MapLibre GL + OpenFreeMap (векторные тайлы, 3D-дома).
   Заведения: OpenStreetMap (Overpass API), лицензия ODbL. Поиск городов: Nominatim. */

const CATS = {
  barber: { name: 'Барбершоп',       color: '#2F6496', syn: ['барбер', 'барбершоп', 'мужская стрижка', 'борода', 'barber'] },
  beauty: { name: 'Салон красоты',   color: '#B0457A', syn: ['салон', 'салон красоты', 'парикмахер', 'стрижка', 'окрашивание', 'укладка', 'beauty'] },
  nails:  { name: 'Маникюр',         color: '#C2702E', syn: ['маникюр', 'ногти', 'nail', 'педикюр'] },
  brows:  { name: 'Брови и ресницы', color: '#7A5BB5', syn: ['брови', 'ресницы', 'brow', 'lash', 'ламинирование'] },
  tattoo: { name: 'Тату',            color: '#59636D', syn: ['тату', 'татуировка', 'пирсинг', 'tattoo'] },
  spa:    { name: 'СПА и массаж',    color: '#2F8A72', syn: ['спа', 'массаж', 'spa', 'massage'] }
};
const CITIES = [
  ['Москва', 55.7558, 37.6173], ['Санкт-Петербург', 59.9343, 30.3351], ['Новосибирск', 55.0084, 82.9357],
  ['Екатеринбург', 56.8389, 60.6057], ['Казань', 55.7961, 49.1064], ['Нижний Новгород', 56.3269, 44.0059],
  ['Челябинск', 55.1644, 61.4368], ['Красноярск', 56.0153, 92.8932], ['Самара', 53.1959, 50.1002],
  ['Уфа', 54.7388, 55.9721], ['Ростов-на-Дону', 47.2357, 39.7015], ['Омск', 54.9885, 73.3242],
  ['Краснодар', 45.0355, 38.9753], ['Воронеж', 51.6720, 39.1843], ['Пермь', 58.0105, 56.2502],
  ['Волгоград', 48.7080, 44.5133], ['Тюмень', 57.1530, 65.5343], ['Сочи', 43.6028, 39.7342],
  ['Калининград', 54.7104, 20.4522], ['Владивосток', 43.1155, 131.8855]
];
const MIN_LOAD_ZOOM = 12.5;
const CELL = 0.02;
const CACHE_KEY = 'tochka-places-v1';
const CACHE_DAYS = 7;
const CACHE_MAX = 6000;            // столько заведений максимум держим в памяти браузера
const NOTES_KEY = 'tochka-notes';
const VIEW_KEY = 'tochka-view';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const DARK = matchMedia('(prefers-color-scheme: dark)').matches;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
};
function distM(a, b) { // расстояние в метрах между [lat,lon]
  const R = 6371e3, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ---------- данные OSM ---------- */
function categorize(t) {
  const name = norm(t.name);
  if (t.shop === 'tattoo') return 'tattoo';
  if (t.shop === 'massage' || t.amenity === 'spa' || t.leisure === 'spa' || t.amenity === 'massage') return 'spa';
  if (t.shop === 'hairdresser') {
    if (t.male === 'yes' && t.female !== 'yes') return 'barber';
    if (/барбер|barber/.test(name) || t.hairdresser === 'barber') return 'barber';
    return 'beauty';
  }
  if (t.shop === 'beauty') {
    const b = norm(t.beauty);
    if (/nails|manicure/.test(b) || /маникюр|ногт|nail/.test(name)) return 'nails';
    if (/eyelash|brow|lash/.test(b) || /бров|ресниц|brow|lash/.test(name)) return 'brows';
    if (/tattoo/.test(b)) return 'tattoo';
    if (/spa|massage/.test(b)) return 'spa';
    return 'beauty';
  }
  return 'beauty';
}
function parseEl(el) {
  const t = el.tags || {};
  if (!t.name) return null;
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const street = t['addr:street'], house = t['addr:housenumber'], city = t['addr:city'];
  return {
    id: el.type[0] + el.id,
    osm: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name: t.name, cat: categorize(t), lat, lon,
    addr: [street, house].filter(Boolean).join(', '),
    city: city || '',
    phone: t.phone || t['contact:phone'] || '',
    site: t.website || t['contact:website'] || t.url || '',
    email: t.email || t['contact:email'] || '',
    hours: t.opening_hours || '',
    vk: t['contact:vk'] || '', tg: t['contact:telegram'] || '', inst: t['contact:instagram'] || '',
    operator: t.operator || ''
  };
}

const places = new Map();
const loadedCells = new Set();
(function restoreCache() {
  const c = store.get(CACHE_KEY, null);
  if (!c || Date.now() - c.t > CACHE_DAYS * 864e5) return;
  c.cells.forEach(k => loadedCells.add(k));
  c.places.forEach(p => places.set(p.id, p));
})();
let saveTimer;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    let list = [...places.values()];
    let cells = [...loadedCells];
    if (list.length > CACHE_MAX) { list = list.slice(-CACHE_MAX); cells = []; }
    if (!store.set(CACHE_KEY, { t: Date.now(), cells, places: list })) store.set(CACHE_KEY, null);
  }, 800);
}

async function overpass(q) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

let loading = false, pending = false;
async function loadView() {
  if (loading) { pending = true; return; }
  if (map.getZoom() < MIN_LOAD_ZOOM) { setStatus(visibleInView().length ? '' : 'Приблизьте карту, чтобы загрузить заведения'); return; }
  // При наклоне карты видно далеко до горизонта — грузим только область вокруг центра
  const b = map.getBounds(), c = map.getCenter();
  const S = Math.max(b.getSouth(), c.lat - 0.1), N = Math.min(b.getNorth(), c.lat + 0.1);
  const W = Math.max(b.getWest(), c.lng - 0.18), E = Math.min(b.getEast(), c.lng + 0.18);
  const missing = [];
  for (let i = Math.floor(S / CELL); i <= Math.floor(N / CELL); i++)
    for (let j = Math.floor(W / CELL); j <= Math.floor(E / CELL); j++) {
      const k = i + ':' + j;
      if (!loadedCells.has(k)) missing.push([i, j, k]);
    }
  if (!missing.length) return;
  const s = Math.min(...missing.map(m => m[0])) * CELL, n = (Math.max(...missing.map(m => m[0])) + 1) * CELL;
  const w = Math.min(...missing.map(m => m[1])) * CELL, e = (Math.max(...missing.map(m => m[1])) + 1) * CELL;
  const bb = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  const q = `[out:json][timeout:25];(nwr["shop"~"^(hairdresser|beauty|massage|tattoo)$"](${bb});nwr["amenity"~"^(spa|massage)$"](${bb});nwr["leisure"="spa"](${bb}););out center tags;`;
  loading = true; setStatus('Загружаю заведения…');
  try {
    const data = await overpass(q);
    let added = 0;
    for (const el of data.elements || []) { const p = parseEl(el); if (p && !places.has(p.id)) { places.set(p.id, p); added++; } }
    missing.forEach(m => loadedCells.add(m[2]));
    saveCache(); setStatus('');
    if (added) applyFilter();
  } catch {
    setStatus('Не удалось загрузить данные. Проверьте интернет и подвигайте карту.');
  } finally {
    loading = false;
    if (pending) { pending = false; loadView(); }
  }
}

/* ---------- карта ---------- */
if (typeof maplibregl.supported === 'function' && !maplibregl.supported()) {
  document.getElementById('map').innerHTML = '<div class="empty">Ваш браузер не поддерживает 3D-карту (WebGL). Обновите браузер или откройте Точку в Chrome.</div>';
}
const saved = store.get(VIEW_KEY, null);
const map = new maplibregl.Map({
  container: 'map',
  style: DARK ? STYLE_DARK : STYLE_LIGHT,
  center: saved ? [saved.lng, saved.lat] : [37.6173, 55.7558],
  zoom: saved ? saved.zoom : 14,
  pitch: saved ? saved.pitch : 52,
  bearing: saved ? saved.bearing : -14,
  maxPitch: 65,
  attributionControl: { compact: true }
});
let styleLoaded = false, triedFallback = false;
map.on('error', e => {
  if (!styleLoaded && DARK && !triedFallback) { triedFallback = true; map.setStyle(STYLE_LIGHT); return; }
  if (!styleLoaded) setStatus('Не удалось загрузить карту. Проверьте интернет.');
  console.warn(e && e.error);
});

// Объёмные метки: каплевидный пин с бликом и тенью, рисуется на canvas в двойном разрешении
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function pinImage(color, big) {
  const s = big ? 1.25 : 1, W = Math.round(60 * s), H = Math.round(80 * s);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d'); x.scale(s, s);
  // тень на «земле»
  const g0 = x.createRadialGradient(30, 74, 1, 30, 74, 14);
  g0.addColorStop(0, 'rgba(0,0,0,.35)'); g0.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g0; x.beginPath(); x.ellipse(30, 74, 14, 5, 0, 0, Math.PI * 2); x.fill();
  // тело пина
  x.beginPath();
  x.moveTo(30, 72);
  x.bezierCurveTo(24, 60, 6, 50, 6, 30);
  x.arc(30, 30, 24, Math.PI, 0);
  x.bezierCurveTo(54, 50, 36, 60, 30, 72);
  x.closePath();
  const g1 = x.createLinearGradient(8, 6, 52, 60);
  g1.addColorStop(0, shade(color, 0.32)); g1.addColorStop(0.55, color); g1.addColorStop(1, shade(color, -0.35));
  x.fillStyle = g1; x.fill();
  x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
  // внутренний «шар»
  const g2 = x.createRadialGradient(26, 25, 1, 30, 30, 10);
  g2.addColorStop(0, '#fff'); g2.addColorStop(1, '#e6e9ec');
  x.fillStyle = g2; x.beginPath(); x.arc(30, 30, 9, 0, Math.PI * 2); x.fill();
  // блик
  x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.ellipse(20, 16, 7, 4, -0.6, 0, Math.PI * 2); x.fill();
  return { width: W, height: H, data: x.getImageData(0, 0, W, H).data };
}

const PIN_LAYERS = ['clusters', 'points', 'selected'];
function setupLayers() {
  styleLoaded = true;
  for (const [k, v] of Object.entries(CATS)) {
    if (!map.hasImage('pin-' + k)) map.addImage('pin-' + k, pinImage(v.color, false), { pixelRatio: 2 });
    if (!map.hasImage('pinb-' + k)) map.addImage('pinb-' + k, pinImage(v.color, true), { pixelRatio: 2 });
  }
  const layers = map.getStyle().layers || [];
  const firstSymbol = (layers.find(l => l.type === 'symbol') || {}).id;
  // 3D-дома: если в стиле их нет, добавляем свои
  if (!layers.some(l => l.type === 'fill-extrusion') && map.getSource('openmaptiles')) {
    try {
      map.addLayer({
        id: 't-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
        paint: {
          'fill-extrusion-color': DARK ? '#2B353D' : '#D8DBD2',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.88
        }
      }, firstSymbol);
    } catch (e) { console.warn(e); }
  }
  if (!map.getSource('places')) {
    map.addSource('places', { type: 'geojson', data: geo([]), cluster: true, clusterRadius: 46, clusterMaxZoom: 15 });
  }
  if (!map.getLayer('clusters')) {
    map.addLayer({
      id: 'clusters', type: 'circle', source: 'places', filter: ['has', 'point_count'],
      paint: {
        'circle-color': DARK ? '#E7ECEE' : '#1B2126',
        'circle-radius': ['step', ['get', 'point_count'], 16, 20, 20, 60, 25],
        'circle-stroke-width': 3, 'circle-stroke-color': DARK ? '#192026' : '#FFFFFF',
        'circle-pitch-alignment': 'map'
      }
    });
    map.addLayer({
      id: 'cluster-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true },
      paint: { 'text-color': DARK ? '#11161A' : '#FFFFFF' }
    });
    map.addLayer({
      id: 'points', type: 'symbol', source: 'places', filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['concat', 'pin-', ['get', 'cat']], 'icon-anchor': 'bottom', 'icon-allow-overlap': true,
        'text-field': ['step', ['zoom'], '', 16, ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 12,
        'text-anchor': 'left', 'text-offset': [1.2, -1.6], 'text-optional': true, 'text-max-width': 12
      },
      paint: { 'text-color': DARK ? '#E7ECEE' : '#1B2126', 'text-halo-color': DARK ? '#11161A' : '#FFFFFF', 'text-halo-width': 1.6 }
    });
    map.addLayer({
      id: 'selected', type: 'symbol', source: 'places', filter: ['==', ['get', 'id'], sel || ''],
      layout: { 'icon-image': ['concat', 'pinb-', ['get', 'cat']], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true }
    });
  }
  pushData();
}
map.on('style.load', setupLayers);
map.on('load', () => { loadView(); updateCity(); drawList(); });

const geo = list => ({
  type: 'FeatureCollection',
  features: list.map(p => ({ type: 'Feature', properties: { id: p.id, cat: p.cat, name: p.name }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }))
});
function pushData() { const s = map.getSource('places'); if (s) s.setData(geo(visible)); }
function markSelected() { if (map.getLayer('selected')) map.setFilter('selected', ['==', ['get', 'id'], sel || '']); }

map.on('click', 'clusters', e => {
  const f = e.features[0];
  map.getSource('places').getClusterExpansionZoom(f.properties.cluster_id)
    .then(z => map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 }))
    .catch(() => map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 }));
});
map.on('click', 'points', e => select(e.features[0].properties.id));
map.on('click', e => {
  const hit = map.queryRenderedFeatures(e.point, { layers: PIN_LAYERS.filter(l => map.getLayer(l)) });
  if (!hit.length) closeCard();
});
for (const l of PIN_LAYERS) {
  map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
}

let mt;
map.on('moveend', () => {
  clearTimeout(mt);
  mt = setTimeout(() => {
    const c = map.getCenter();
    store.set(VIEW_KEY, { lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
    loadView(); drawList(); updateCity(); syncTilt();
  }, 350);
});

$('#zin').onclick = () => map.zoomIn();
$('#zout').onclick = () => map.zoomOut();
function syncTilt() { const on = map.getPitch() > 5; $('#tilt').textContent = on ? '2D' : '3D'; $('#tilt').setAttribute('aria-pressed', on); }
$('#tilt').onclick = () => {
  const flat = map.getPitch() > 5;
  map.easeTo({ pitch: flat ? 0 : 55, bearing: flat ? 0 : -14, duration: REDUCE ? 0 : 900 });
};
$('#loc').onclick = () => {
  if (!navigator.geolocation) return toast('Геолокация недоступна');
  navigator.geolocation.getCurrentPosition(
    pos => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 15.5, essential: true }),
    () => toast('Не удалось определить местоположение'), { enableHighAccuracy: true, timeout: 10000 });
};
syncTilt();

/* ---------- город ---------- */
function updateCity() {
  const c = map.getCenter();
  let best = null, bd = Infinity;
  for (const [n, la, lo] of CITIES) { const d = distM([c.lat, c.lng], [la, lo]); if (d < bd) { bd = d; best = n; } }
  $('#cityName').textContent = bd < 45000 ? best : (map.getZoom() < 6 ? 'Россия' : 'Карта');
}
function flyToCity(lat, lon, zoom = 13.6) {
  closeSheet(); closeCard();
  map.flyTo({ center: [lon, lat], zoom, pitch: map.getPitch() > 5 ? 52 : 0, essential: true, duration: REDUCE ? 0 : 2200 });
}
$('#clist').innerHTML = CITIES.map(([n], i) => `<button type="button" data-i="${i}">${esc(n)}</button>`).join('');
$('#clist').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { const [, la, lo] = CITIES[+b.dataset.i]; flyToCity(la, lo); } };
function openSheet() { $('#cp').hidden = false; $('#cq').value = ''; $('#cres').innerHTML = ''; setTimeout(() => $('#cq').focus(), 50); }
function closeSheet() { $('#cp').hidden = true; }
$('#city').onclick = openSheet;
$('#cpx').onclick = closeSheet;
$('#cp').addEventListener('click', e => { if (e.target.id === 'cp') closeSheet(); });

let gt, gq = 0;
$('#cq').addEventListener('input', () => {
  clearTimeout(gt);
  const q = $('#cq').value.trim();
  if (q.length < 3) { $('#cres').innerHTML = ''; return; }
  const local = CITIES.filter(([n]) => norm(n).startsWith(norm(q)));
  if (local.length) $('#cres').innerHTML = local.map(([n, la, lo]) => `<button class="res" type="button" data-lat="${la}" data-lon="${lo}" data-z="13.6">${esc(n)}</button>`).join('');
  gt = setTimeout(() => geocode(q), 550);
});
$('#cq').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(gt); geocode($('#cq').value.trim()); } });
async function geocode(q) {
  if (q.length < 2) return;
  const my = ++gq;
  $('#cres').innerHTML = '<div class="small">Ищу…</div>';
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ru&accept-language=ru&limit=6&q=${encodeURIComponent(q)}`);
    const d = await r.json();
    if (my !== gq) return;
    $('#cres').innerHTML = d.length ? d.map(x => {
      const big = ['city', 'town', 'administrative', 'state', 'county'].includes(x.type) || x.addresstype === 'city' || x.addresstype === 'town';
      const [first, ...rest] = x.display_name.split(', ');
      return `<button class="res" type="button" data-lat="${x.lat}" data-lon="${x.lon}" data-z="${big ? 13.6 : 16.2}">${esc(first)}<small>${esc(rest.slice(0, 3).join(', '))}</small></button>`;
    }).join('') : '<div class="small">Ничего не нашлось. Попробуйте написать иначе.</div>';
  } catch {
    if (my === gq) $('#cres').innerHTML = '<div class="small">Поиск сейчас недоступен. Выберите город из списка ниже.</div>';
  }
}
$('#cres').onclick = e => { const b = e.target.closest('[data-lat]'); if (b) flyToCity(+b.dataset.lat, +b.dataset.lon, +b.dataset.z); };

/* ---------- избранное ---------- */
const FAV_KEY = 'tochka-favs';
let favs = store.get(FAV_KEY, {});
for (const p of Object.values(favs)) if (!places.has(p.id)) places.set(p.id, p);
const isFav = id => !!favs[id];
function toggleFav(id) {
  const p = places.get(id); if (!p) return;
  if (favs[id]) { delete favs[id]; toast('Убрано из избранного'); }
  else { favs[id] = p; toast('Добавлено в избранное'); }
  store.set(FAV_KEY, favs);
  if (favOnly) applyFilter(); else drawList();
}

/* ---------- фильтр и поиск ---------- */
let cat = 'all', noSite = false, favOnly = false, sel = null, visible = [];
function matches(p, q) {
  if (favOnly && !favs[p.id]) return false;
  if (cat !== 'all' && p.cat !== cat) return false;
  if (noSite && p.site) return false;
  if (!q) return true;
  const c = CATS[p.cat];
  const hay = norm([p.name, p.addr, p.city, p.operator, c.name, ...c.syn].join(' ')).replace(/[,.]/g, ' ');
  return q.split(/\s+/).every(w => hay.includes(w)) || c.syn.some(s => q.includes(norm(s)));
}
function applyFilter() {
  const q = norm($('#q').value.trim()).replace(/[,.]/g, ' ');
  $('#clear').hidden = !q;
  visible = [...places.values()].filter(p => matches(p, q));
  pushData();
  if (sel && !visible.find(p => p.id === sel)) closeCard();
  drawList();
}
let ft; $('#q').addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(applyFilter, 200); });
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyFilter(); $('#q').blur(); } });
$('#clear').onclick = () => { $('#q').value = ''; applyFilter(); };

const chips = $('#chips');
function chip(label, color, on, onclick, extra = '') {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip ' + extra; b.setAttribute('aria-pressed', on);
  b.innerHTML = (color ? `<span class="dot" style="background:${color}"></span>` : '') + esc(label);
  b.onclick = () => onclick(b); chips.appendChild(b); return b;
}
const catChips = [];
const pickCat = k => b => { cat = k; catChips.forEach(x => x.setAttribute('aria-pressed', x === b)); applyFilter(); };
catChips.push(chip('Все', null, true, pickCat('all')));
for (const [k, v] of Object.entries(CATS)) catChips.push(chip(v.name, v.color, false, pickCat(k)));
const sep = document.createElement('span'); sep.className = 'chip-sep'; chips.appendChild(sep);
chip('Без сайта', null, false, b => { noSite = !noSite; b.setAttribute('aria-pressed', noSite); applyFilter(); }, 'nosite');
chip('★ Избранное', null, false, b => {
  favOnly = !favOnly; b.setAttribute('aria-pressed', favOnly);
  if (favOnly && !Object.keys(favs).length) toast('Пока пусто: нажмите ☆ в карточке заведения');
  applyFilter();
  if (favOnly && visible.length && innerWidth > 760) fitTo(visible);
}, 'favchip');
function fitTo(list) {
  if (list.length === 1) { map.flyTo({ center: [list[0].lon, list[0].lat], zoom: 16, essential: true }); return; }
  const b = new maplibregl.LngLatBounds();
  list.forEach(p => b.extend([p.lon, p.lat]));
  map.fitBounds(b, { padding: 80, maxZoom: 16, duration: REDUCE ? 0 : 1200 });
}

// «Скачать» в углу — прячем, если Точка уже открыта как установленное приложение
const inApp = matchMedia('(display-mode: standalone)').matches || navigator.standalone || window.Capacitor ||
  /Electron|; wv\)/.test(navigator.userAgent);
if (inApp) $('#dl').hidden = true;

/* ---------- список ---------- */
function visibleInView() {
  let b; try { b = map.getBounds(); } catch { return []; }
  return visible.filter(p => b.contains([p.lon, p.lat]));
}
function drawList() {
  const c = map.getCenter(), cc = [c.lat, c.lng];
  const src = favOnly ? visible : visibleInView();
  const inView = src.map(p => ({ p, d: distM(cc, [p.lat, p.lon]) })).sort((a, z) => a.d - z.d).slice(0, 150);
  const dist = d => d < 1000 ? Math.round(d / 10) * 10 + ' м' : (d / 1000).toFixed(1).replace('.', ',') + ' км';
  const L = $('#list');
  L.innerHTML = `<div class="list-head"><b>${favOnly ? 'Избранное' : 'На экране'}: ${inView.length}</b><span class="small">загружено ${places.size}</span></div>` +
    (inView.length ? inView.map(({ p, d }) => `
      <button type="button" class="item${p.id === sel ? ' sel' : ''}" data-id="${p.id}">
        <span class="bar" style="background:${CATS[p.cat].color}"></span>
        <span><div class="nm">${isFav(p.id) ? '<span class="favmark">★</span> ' : ''}${esc(p.name)}</div>
        <div class="sub">${esc(CATS[p.cat].name)}${p.addr ? ' · ' + esc(p.addr) : ''} · ${dist(d)}</div>
        ${p.site ? '' : '<div class="flag">Нет сайта</div>'}</span>
      </button>`).join('')
    : `<div class="empty">${favOnly ? 'В избранном пока ничего нет. Откройте заведение и нажмите ☆ рядом с названием.' : map.getZoom() < MIN_LOAD_ZOOM ? 'Приблизьте карту или выберите город, чтобы загрузить заведения.' : 'Здесь ничего не нашлось. Сдвиньте карту или измените поиск.'}</div>`);
  L.querySelectorAll('.item').forEach(b => b.onclick = () => { select(b.dataset.id, true); $('#main').classList.remove('showlist'); $('#lt').textContent = 'Список'; });
}
$('#lt').onclick = () => { const m = $('#main'); m.classList.toggle('showlist'); $('#lt').textContent = m.classList.contains('showlist') ? 'Карта' : 'Список'; };

/* ---------- карточка ---------- */
const DAYS = { Mo: 'Пн', Tu: 'Вт', We: 'Ср', Th: 'Чт', Fr: 'Пт', Sa: 'Сб', Su: 'Вс', PH: 'праздники', off: 'выходной', closed: 'закрыто' };
const ruHours = h => h === '24/7' ? 'Круглосуточно' : h.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|off|closed)\b/g, m => DAYS[m]).replace(/;\s*/g, '; ');
const handle = (v, base) => /^https?:/.test(v) ? v : base + v.replace(/^@/, '');
function contactText(p) {
  return [
    `${p.name} (${CATS[p.cat].name})`,
    (p.addr || p.city) && `Адрес: ${[p.city, p.addr].filter(Boolean).join(', ')}`,
    p.phone && `Тел.: ${p.phone}`,
    p.site && `Сайт: ${p.site}`, p.email && `Email: ${p.email}`,
    p.tg && `Telegram: ${p.tg}`, p.vk && `VK: ${p.vk}`, p.inst && `Instagram: ${p.inst}`
  ].filter(Boolean).join('\n');
}
function select(id, fly) {
  const p = places.get(id); if (!p) return;
  sel = id; markSelected();
  const mobile = innerWidth <= 760;
  if (fly || map.getZoom() < 15.5) {
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16.5), offset: mobile ? [0, -110] : [140, 0], essential: true, duration: REDUCE ? 0 : 1200 });
  } else if (mobile) {
    map.easeTo({ center: [p.lon, p.lat], offset: [0, -110] });
  }
  const c = CATS[p.cat];
  const row = (k, v, btn = '') => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span>${btn || '<span></span>'}</div>`;
  const phones = p.phone ? p.phone.split(/[;,]\s*/).map(t => `<a class="tel" href="tel:${esc(t.replace(/[^\d+]/g, ''))}">${esc(t)}</a>`).join('<br>') : '';
  const soc = [
    p.tg && `<a href="${esc(handle(p.tg, 'https://t.me/'))}" target="_blank" rel="noopener">Telegram</a>`,
    p.vk && `<a href="${esc(handle(p.vk, 'https://vk.com/'))}" target="_blank" rel="noopener">VK</a>`,
    p.inst && `<a href="${esc(handle(p.inst, 'https://instagram.com/'))}" target="_blank" rel="noopener">Instagram</a>`
  ].filter(Boolean).join(' · ');
  const addr = [p.city, p.addr].filter(Boolean).join(', ');
  $('#card').innerHTML = `
    <div class="card-h"><div>
      <span class="tag" style="color:${c.color}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span>
      <h2>${esc(p.name)}</h2></div>
      <div class="card-btns"><button class="star" type="button" id="fav" aria-pressed="${isFav(p.id)}" aria-label="В избранное">${isFav(p.id) ? '★' : '☆'}</button>
      <button class="x" type="button" id="cx" aria-label="Закрыть">×</button></div></div>
    <div class="rows">
      ${row('Адрес', addr ? esc(addr) : '<span class="small">не указан</span>')}
      ${p.phone ? row('Телефон', phones, `<button class="mini" type="button" data-copy="${esc(p.phone)}">Копировать</button>`) : row('Телефон', '<span class="small">не указан</span>')}
      ${p.hours ? row('Часы', esc(ruHours(p.hours))) : ''}
      ${row('Сайт', p.site ? `<a href="${esc(/^https?:/.test(p.site) ? p.site : 'https://' + p.site)}" target="_blank" rel="noopener">${esc(p.site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : '<span class="nosite-v">Нет</span><small>можно предложить сделать сайт</small>')}
      ${p.email ? row('Email', esc(p.email), `<button class="mini" type="button" data-copy="${esc(p.email)}">Копировать</button>`) : ''}
      ${soc ? row('Соцсети', soc) : ''}
      ${p.operator ? row('Компания', esc(p.operator)) : ''}
    </div>
    <div class="acts">
      <button class="btn pri" type="button" id="tonote">В блокнот</button>
      <button class="btn" type="button" data-copy="${esc(contactText(p))}">Копировать контакты</button>
      <a class="btn" href="https://yandex.ru/maps/?rtext=~${p.lat},${p.lon}" target="_blank" rel="noopener">Маршрут</a>
    </div>
    <div class="src">Источник: OpenStreetMap. Нашли ошибку? <a href="${p.osm}" target="_blank" rel="noopener">Исправить на карте OSM</a></div>`;
  $('#card').hidden = false;
  $('#cx').onclick = closeCard;
  $('#fav').onclick = () => { toggleFav(p.id); const on = isFav(p.id); $('#fav').textContent = on ? '★' : '☆'; $('#fav').setAttribute('aria-pressed', on); };
  // перезапуск «всплытия» карточки
  const cardEl = $('#card'); cardEl.classList.remove('pop'); void cardEl.offsetWidth; cardEl.classList.add('pop');
  $('#tonote').onclick = () => { notePlace = p; openNotes(); const t = $('#nt'); t.value = contactText(p) + '\n'; t.focus(); t.setSelectionRange(t.value.length, t.value.length); };
  drawList();
}
function closeCard() {
  if (!sel && $('#card').hidden) return;
  sel = null; markSelected(); $('#card').hidden = true; drawList();
}

/* ---------- копирование и тост ---------- */
document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (b) copy(b.dataset.copy); });
function copy(t) {
  const fb = () => {
    const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0';
    document.body.appendChild(a); a.select();
    try { document.execCommand('copy'); toast('Скопировано'); } catch { toast('Не удалось скопировать'); }
    a.remove();
  };
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('Скопировано'), fb); else fb();
}
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 1700); }
function setStatus(m) { const s = $('#status'); s.textContent = m; s.hidden = !m; }

/* ---------- блокнот ---------- */
let notes = store.get(NOTES_KEY, []);
let notePlace = null;    // заведение, из карточки которого открыли блокнот
const STATUSES = [['new', 'Новый'], ['sent', 'Написал'], ['reply', 'Ответил'], ['deal', 'Договорились'], ['no', 'Отказ']];
const stName = s => (STATUSES.find(x => x[0] === s) || STATUSES[0])[1];
const saveNotes = () => { if (!store.set(NOTES_KEY, notes)) toast('Не удалось сохранить: память браузера заполнена'); };
function drawNotes() {
  $('#cnt').textContent = notes.length;
  $('#nl').innerHTML = notes.length ? notes.map(n => `
    <div class="note"><div class="nt-top">
      <button class="st st-${n.s || 'new'}" type="button" data-st="${n.d}" title="Нажмите, чтобы сменить статус">${stName(n.s)}</button>
      <span class="small">${new Date(n.d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
      <p>${esc(n.t)}</p>
      <div class="nf">
      ${n.lat != null ? `<button class="mini" type="button" data-go="${n.d}">На карте</button>` : '<span></span>'}
      <div><button class="mini" type="button" data-copy="${esc(n.t)}">Копировать</button>
      <button class="mini" type="button" data-del="${n.d}">Удалить</button></div></div></div>`).join('')
    : '<div class="hint">Пока пусто. Записывайте сюда телефоны, имена и кому написать. Или откройте заведение на карте и нажмите «В блокнот» — контакты подставятся сами.</div>';
  $('#nl').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    notes = notes.filter(n => n.d !== +b.dataset.del); saveNotes(); drawNotes(); toast('Заметка удалена');
  });
  $('#nl').querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
    const n = notes.find(x => x.d === +b.dataset.st); if (!n) return;
    const i = STATUSES.findIndex(x => x[0] === (n.s || 'new'));
    n.s = STATUSES[(i + 1) % STATUSES.length][0]; saveNotes(); drawNotes();
  });
  $('#nl').querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const n = notes.find(x => x.d === +b.dataset.go); if (!n) return;
    $('#np').classList.remove('on');
    if (n.pid && !places.has(n.pid) && n.place) places.set(n.pid, n.place);
    if (n.pid && places.has(n.pid)) select(n.pid, true);
    else map.flyTo({ center: [n.lon, n.lat], zoom: 16.5, essential: true });
  });
}
$('#nf').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('#nt').value.trim(); if (!t) { $('#nt').focus(); return; }
  const n = { t, d: Date.now(), s: 'new' };
  if (notePlace) { n.pid = notePlace.id; n.lat = notePlace.lat; n.lon = notePlace.lon; n.place = notePlace; notePlace = null; }
  notes.unshift(n); saveNotes(); $('#nt').value = ''; drawNotes(); toast('Сохранено');
});
$('#copyall').onclick = () => notes.length ? copy(notes.map(n => n.t).join('\n\n———\n\n')) : toast('Блокнот пуст');
function openNotes() { $('#np').classList.add('on'); }
$('#fab').onclick = () => { const on = $('#np').classList.toggle('on'); if (on) $('#nt').focus(); };
$('#npx').onclick = () => { $('#np').classList.remove('on'); if (!$('#nt').value.trim()) notePlace = null; };
addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('#np').classList.remove('on'); closeSheet(); }
  // «/» — быстро перейти к поиску (как на многих сайтах)
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); $('#q').focus(); }
});

/* ---------- старт ---------- */
drawNotes();
visible = [...places.values()];
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
