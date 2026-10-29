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
const THEME_KEY = 'tochka-theme';
const sysDark = matchMedia('(prefers-color-scheme: dark)');
let themeMode = (() => { try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; } })();
const computeDark = () => themeMode === 'dark' || (themeMode === 'auto' && sysDark.matches);
let DARK = computeDark();
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
    let list = [...places.values()].filter(p => !p.db && !p.mine);
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

/* ---------- своя база (data/*.json, обновляется раз в неделю на GitHub) ----------
   Новый формат — по регионам России: у каждого региона список клеток 1°×1°, где есть заведения.
   Старый формат — по городам с рамкой (s, w, n, e). Пока база пересобирается, понимаем оба. */
const OSM_TYPES = { n: 'node', w: 'way', r: 'relation' };
const dbCells = new Set();       // ячейки 0,02° из старой базы городов — живой сервер для них не нужен
const dbLoading = new Map();
let dbIndex = [], dbRegions = [];
const cellRegions = new Map();   // «55:37» → регионы, у которых там есть заведения
const cellKey = (lat, lon) => Math.floor(lat) + ':' + Math.floor(lon);
const dbReady = fetch('data/index.json', { cache: 'no-cache' })
  .then(r => r.ok ? r.json() : {})
  .then(d => {
    dbIndex = d.cities || [];
    dbRegions = (d.regions || []).filter(r => r.count && r.cells);
    for (const r of dbRegions) for (const k of r.cells) {
      if (!cellRegions.has(k)) cellRegions.set(k, []);
      cellRegions.get(k).push(r);
    }
  })
  .catch(() => {});
function dbCityAt(lat, lon) { return dbIndex.find(c => c.count && lat >= c.s && lat <= c.n && lon >= c.w && lon <= c.e); }
// регионы, которые нужны для видимой области (не дальше ~1° от центра)
function dbRegionsNear(c, b) {
  const S = Math.max(b.getSouth(), c.lat - 1), N = Math.min(b.getNorth(), c.lat + 1);
  const W = Math.max(b.getWest(), c.lng - 1.6), E = Math.min(b.getEast(), c.lng + 1.6);
  const out = new Set();
  for (let la = Math.floor(S); la <= Math.floor(N); la++)
    for (let lo = Math.floor(W); lo <= Math.floor(E); lo++)
      for (const r of cellRegions.get(la + ':' + lo) || []) out.add(r);
  return [...out];
}
// ячейка 0,02° покрыта базой, если загружены все регионы, у которых есть заведения в её клетке 1°
function dbCovers(i, j) {
  const rs = cellRegions.get(cellKey((i + .5) * CELL, (j + .5) * CELL));
  return !!rs && rs.every(r => r.loadedOk);
}
function loadDb(c) {
  if (dbLoading.has(c.slug)) return dbLoading.get(c.slug);
  const pr = fetch(`data/${c.slug}.json?v=${encodeURIComponent(c.updated || '')}`)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(rows => {
      for (const [id, lat, lon, tags] of rows) {
        const p = parseEl({ type: OSM_TYPES[id[0]] || 'node', id: id.slice(1), lat, lon, tags });
        if (p && !places.has(p.id)) { p.db = true; places.set(p.id, p); }
      }
      if (c.s != null) // старая база по городам
        for (let i = Math.ceil(c.s / CELL); i < Math.floor(c.n / CELL); i++)
          for (let j = Math.ceil(c.w / CELL); j < Math.floor(c.e / CELL); j++) dbCells.add(i + ':' + j);
      c.loadedOk = true;
    })
    .catch(() => { c.failedAt = Date.now(); dbLoading.delete(c.slug); });
  dbLoading.set(c.slug, pr);
  return pr;
}
const loadCityDb = loadDb;

let loading = false, pending = false;
async function loadView() {
  if (loading) { pending = true; return; }
  loading = true;
  try {
    await dbReady;
    const c = map.getCenter();
    // 1) своя база — регионы (или города старой базы) грузятся целым файлом, даже на мелком масштабе
    if (map.getZoom() >= 8) {
      const fresh = x => !x.loadedOk && !(x.failedAt > Date.now() - 60000);
      const need = dbRegionsNear(c, map.getBounds()).filter(fresh);
      const city = dbCityAt(c.lat, c.lng);
      if (city && fresh(city) && !dbCovers(Math.floor(c.lat / CELL), Math.floor(c.lng / CELL))) need.push(city);
      if (need.length) {
        setStatus(`Загружаю базу: ${need.slice(0, 2).map(x => x.name).join(', ')}${need.length > 2 ? ' и ещё ' + (need.length - 2) : ''}…`);
        await Promise.all(need.map(loadDb));
        setStatus('');
        if (need.some(x => x.loadedOk)) applyFilter();
      }
    }
    if (map.getZoom() < MIN_LOAD_ZOOM) { setStatus(visibleInView().length ? '' : 'Приблизьте карту, чтобы загрузить заведения'); return; }
    // 2) всё, что вне базы, — живьём с сервера OpenStreetMap (только область вокруг центра)
    const b = map.getBounds();
    const S = Math.max(b.getSouth(), c.lat - 0.1), N = Math.min(b.getNorth(), c.lat + 0.1);
    const W = Math.max(b.getWest(), c.lng - 0.18), E = Math.min(b.getEast(), c.lng + 0.18);
    const missing = [];
    for (let i = Math.floor(S / CELL); i <= Math.floor(N / CELL); i++)
      for (let j = Math.floor(W / CELL); j <= Math.floor(E / CELL); j++) {
        const k = i + ':' + j;
        if (!loadedCells.has(k) && !dbCells.has(k) && !dbCovers(i, j)) missing.push([i, j, k]);
      }
    if (!missing.length) { setStatus(''); return; }
    const s = Math.min(...missing.map(m => m[0])) * CELL, n = (Math.max(...missing.map(m => m[0])) + 1) * CELL;
    const w = Math.min(...missing.map(m => m[1])) * CELL, e = (Math.max(...missing.map(m => m[1])) + 1) * CELL;
    const bb = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
    const q = `[out:json][timeout:25];(nwr["shop"~"^(hairdresser|beauty|massage|tattoo)$"](${bb});nwr["amenity"~"^(spa|massage)$"](${bb});nwr["leisure"="spa"](${bb}););out center tags;`;
    setStatus('Загружаю заведения…');
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
  if (!styleLoaded && DARK && !triedFallback) { triedFallback = true; map.setStyle(STYLE_LIGHT, { diff: false }); return; }
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
function setTheme(mode) {
  themeMode = mode;
  try { localStorage.setItem(THEME_KEY, mode); } catch {}
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  document.querySelectorAll('#theme [data-t]').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === mode));
  restyleMap();
}
function restyleMap() {
  const d = computeDark();
  if (d === DARK) return;
  DARK = d; styleLoaded = false; triedFallback = false;
  map.setStyle(DARK ? STYLE_DARK : STYLE_LIGHT, { diff: false });   // слои меток добавятся заново в style.load
}
{ const onSys = () => { if (themeMode === 'auto') restyleMap(); };   // старые Safari знают только addListener
  if (sysDark.addEventListener) sysDark.addEventListener('change', onSys); else if (sysDark.addListener) sysDark.addListener(onSys); }
map.on('load', () => { loadView(); updateCity(); drawList(); measureDrawer(); setSnap(snap, false); movePill(); });

const geo = list => ({
  type: 'FeatureCollection',
  features: list.map(p => ({ type: 'Feature', properties: { id: p.id, cat: p.cat, name: p.name }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }))
});
function pushData() { const s = map.getSource('places'); if (s) s.setData(geo(visible)); }
function markSelected() { if (map.getLayer('selected')) map.setFilter('selected', ['==', ['get', 'id'], sel || '']); }

map.on('click', 'clusters', e => {
  if (addMode) return;
  const f = e.features[0];
  map.getSource('places').getClusterExpansionZoom(f.properties.cluster_id)
    .then(z => map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 }))
    .catch(() => map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 }));
});
map.on('click', 'points', e => { if (!addMode) select(e.features[0].properties.id); });
map.on('click', e => {
  if (addMode) { openAddForm(e.lngLat); return; }
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
function syncTilt() { const on = map.getPitch() > 5; $('#tilt').textContent = on ? '2D' : '3D'; $('#tilt').setAttribute('aria-pressed', on); const s3 = document.getElementById('sw3d'); if (s3) s3.setAttribute('aria-checked', on); }
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
  else {
    favs[id] = p; toast('Добавлено в избранное');
  }
  store.set(FAV_KEY, favs);
  if (favOnly) applyFilter(); else drawList();
}

/* ---------- потенциал клиента: насколько заведению нужен сайт ---------- */
// Страницы соцсетей, онлайн-записи и справочников — это не собственный сайт
const SOCIAL_HOSTS = /(^|\.)(vk\.com|vk\.ru|vkontakte\.ru|m\.vk\.com|instagram\.com|t\.me|telegram\.me|taplink\.(cc|ws|at|ru)|wa\.me|ok\.ru|youtube\.com|tiktok\.com|facebook\.com|dikidi\.(net|ru|app)|yclients\.com|2gis\.ru|yandex\.ru|avito\.ru|linktr\.ee|zoon\.ru|flamp\.ru)$/i;
function siteKind(p) {
  if (!p.site) return 'none';
  try {
    const host = new URL(/^[a-z]+:\/\//i.test(p.site) ? p.site : 'https://' + p.site).hostname.replace(/^www\./, '');
    return SOCIAL_HOSTS.test(host) ? 'social' : 'own';
  } catch { return 'own'; }
}
const leadCache = new WeakMap();
const LV = { high: 'высокий', mid: 'средний', low: 'низкий' };
function lead(p) {
  let l = leadCache.get(p);
  if (l) return l;
  const kind = siteKind(p), why = [];
  let s = 0;
  if (kind === 'none') { s += 55; why.push('нет сайта'); }
  else if (kind === 'social') { s += 45; why.push('только соцсети или онлайн-запись'); }
  else why.push('уже есть сайт');
  const social = !!(p.tg || p.vk || p.inst || p.email || kind === 'social');
  if (p.phone) { s += 15; why.push('есть телефон'); }
  if (social) { s += 10; why.push('есть соцсети'); }
  if (!p.hours) { s += 10; why.push('не указаны часы работы'); }
  if (!p.addr) { s += 5; why.push('не указан адрес'); }
  if (!p.phone && !social) { s = Math.min(s, 45); why.push('нет контактов — связаться сложно'); }
  s = Math.min(100, s);
  l = { score: s, level: s >= 70 ? 'high' : s >= 50 ? 'mid' : 'low', kind, why };
  leadCache.set(p, l);
  return l;
}
const lvPill = l => `<span class="lv lv-${l.level}" title="Потенциал клиента: ${l.score} из 100">${l.score}</span>`;

/* ---------- свои заведения (видны только на этом устройстве) ---------- */
const MINE_KEY = 'tochka-mine';
let mine = store.get(MINE_KEY, {});
for (const p of Object.values(mine)) places.set(p.id, p);
let addMode = false, pickAt = null, editId = null, pickCity = '';
function startAdd() {
  addMode = true; closeCard(); $('#pick').hidden = false; $('#addp').setAttribute('aria-pressed', 'true');
  map.getCanvas().style.cursor = 'crosshair'; go('v-map'); setSnap(0);
}
function stopAdd() { addMode = false; $('#pick').hidden = true; $('#addp').setAttribute('aria-pressed', 'false'); map.getCanvas().style.cursor = ''; }
$('#addp').onclick = () => addMode ? stopAdd() : startAdd();
$('#pickx').onclick = stopAdd;
$('#aCat').innerHTML = Object.entries(CATS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
function openAddForm(lngLat, p) {
  stopAdd();
  editId = p ? p.id : null;
  pickAt = p ? { lat: p.lat, lon: p.lon } : { lat: lngLat.lat, lon: lngLat.lng };
  pickCity = p ? (p.city || '') : '';
  $('#asTitle').textContent = p ? 'Изменить заведение' : 'Новое заведение';
  $('#aName').value = p?.name || ''; $('#aCat').value = p?.cat || 'beauty'; $('#aAddr').value = p?.addr || '';
  $('#aPhone').value = p?.phone || ''; $('#aSite').value = p?.site || ''; $('#aTg').value = p?.tg || ''; $('#aVk').value = p?.vk || '';
  $('#as').hidden = false;
  setTimeout(() => $('#aName').focus(), 50);
  if (!p) reverseFill(pickAt);
}
async function reverseFill({ lat, lon }) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru&zoom=18&lat=${lat}&lon=${lon}`);
    const a = (await r.json()).address || {};
    const street = [a.road || a.pedestrian || a.footway || a.square, a.house_number].filter(Boolean).join(', ');
    if (street && !$('#aAddr').value) $('#aAddr').value = street;
    pickCity = a.city || a.town || a.village || '';
  } catch { /* адрес можно ввести вручную */ }
}
function closeAdd() { $('#as').hidden = true; editId = null; }
$('#asx').onclick = closeAdd;
$('#as').addEventListener('click', e => { if (e.target.id === 'as') closeAdd(); });
$('#af').addEventListener('submit', e => {
  e.preventDefault();
  const v = id => $(id).value.trim();
  if (!v('#aName')) { $('#aName').focus(); return; }
  const id = editId || 'u' + Date.now();
  const p = {
    id, name: v('#aName'), cat: $('#aCat').value, lat: pickAt.lat, lon: pickAt.lon,
    addr: v('#aAddr'), city: pickCity, phone: v('#aPhone'), site: v('#aSite'), email: '', hours: '',
    tg: v('#aTg'), vk: v('#aVk'), inst: '', operator: '', mine: true
  };
  const wasEdit = !!editId;
  mine[id] = p; store.set(MINE_KEY, mine); places.set(id, p);
  if (favs[id]) { favs[id] = p; store.set(FAV_KEY, favs); }
  closeAdd(); applyFilter(); select(id, true);
  toast(wasEdit ? 'Изменения сохранены' : 'Заведение добавлено');
});
function deleteMine(id) {
  delete mine[id]; store.set(MINE_KEY, mine);
  if (favs[id]) { delete favs[id]; store.set(FAV_KEY, favs); }
  places.delete(id); closeCard(); applyFilter(); toast('Заведение удалено');
}

/* ---------- Аккаунт, 3 дня бесплатно, потом подписка 290 ₽/мес ----------
   Сервер — Supabase: вход по коду из письма, дата регистрации и оплаченный срок хранятся там,
   поэтому очистка браузера не даёт новых бесплатных дней. Повторные аккаунты (та же почта с «+»,
   точки в Gmail, одноразовые ящики) отсекает сам сервер — см. supabase_setup.sql у продавца.
   Пока AUTH не заполнен, Точка работает в бета-режиме: всё открыто, входа нет. */
const AUTH = {
  url: 'https://aficnrxwryphxdgjmyfx.supabase.co',             // адрес проекта Supabase
  anon: 'sb_publishable_jxAB9uHvaD7-Tp_qkdgGiQ_tQswTA_2',     // публичный ключ (его можно хранить в коде)
  live: true          // false — вход включён только в режиме проверки (ссылка …/tochka/?test-login); true — для всех
};
// режим проверки: открыть Точку по ссылке с ?test-login (выключить — ?test-login=off)
try {
  const q = new URLSearchParams(location.search);
  if (q.has('test-login')) {
    if (q.get('test-login') === 'off') localStorage.removeItem('tochka-auth-test'); else localStorage.setItem('tochka-auth-test', '1');
    history.replaceState(null, '', location.pathname + location.hash);
  }
} catch { /* без хранилища — просто без режима проверки */ }
const PLAN = { price: 290, trialDays: 3, tg: 'cunbent' };
const SESSION_KEY = 'tochka-session', ACCT_KEY = 'tochka-acct';
const authTest = (() => { try { return localStorage.getItem('tochka-auth-test') === '1'; } catch { return false; } })();
const authOn = () => !!(AUTH.url && AUTH.anon && (AUTH.live || authTest));
let session = store.get(SESSION_KEY, null);    // { access_token, refresh_token, expires_at, user: { id, email, created_at } }
let acct = store.get(ACCT_KEY, null);          // { state: 'trial' | 'active' | 'expired', until, email, checked }
const isPro = () => !authOn() || !!(session && acct && acct.state !== 'expired' && acct.until > Date.now());
const fmtDate = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const daysLeft = t => Math.max(0, Math.ceil((t - Date.now()) / DAY));

async function api(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(AUTH.url.replace(/\/$/, '') + path, {
    method,
    headers: { apikey: AUTH.anon, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null; try { data = await r.json(); } catch { /* пустой ответ */ }
  if (!r.ok) { const e = new Error((data && (data.msg || data.message || data.error_description || data.error)) || 'HTTP ' + r.status); e.status = r.status; e.code = data && (data.error_code || data.code); throw e; }
  return data;
}
function saveSession(d) {
  session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000,
    user: { id: d.user.id, email: d.user.email, created_at: d.user.created_at } };
  store.set(SESSION_KEY, session);
}
async function token() {
  if (!session) return null;
  if (session.expires_at - Date.now() > 60000) return session.access_token;
  try { saveSession(await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })); return session.access_token; }
  catch (e) { if (e.status === 400 || e.status === 401) signOut(true); return null; }
}
// понятные сообщения вместо технических ошибок сервера
function authError(e) {
  const m = String(e.message || ''), code = String(e.code || '');
  if (e.status === 429 || /rate|limit|security purposes/i.test(m)) return 'Слишком много попыток. Подождите минуту и попробуйте ещё раз.';
  // письмо не ушло (почта отправителя в Supabase настроена неверно) — это не вина пользователя
  if (/sending|smtp|email.*(send|deliver)|send.*email/i.test(m)) return 'Не получилось отправить письмо с кодом. Попробуйте через пару минут. (Для владельца: проверьте настройки SMTP в Supabase.) Подробности: ' + m;
  if (/Database error|TOCHKA_/i.test(m + code)) return 'С этой почтой зарегистрироваться нельзя. Используйте обычный ящик (Яндекс, Mail.ru, Gmail…) без «+» в адресе. Если вы уже регистрировались — войдите с той же почтой.';
  if (/expired|invalid|otp/i.test(m + code)) return 'Код не подошёл или устарел. Проверьте цифры или отправьте код ещё раз.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Нет связи с сервером. Проверьте интернет и попробуйте снова.';
  return 'Не получилось: ' + m;
}
async function loadStatus() {
  if (!authOn() || !session) { applyAccess(); return; }
  const t = await token();
  if (!t) { applyAccess(); return; }
  try {
    // дата регистрации и оплаченный срок — с сервера, а не из копии на устройстве
    const rows = await api(`/rest/v1/subscriptions?select=paid_until,created_at&user_id=eq.${session.user.id}`, { token: t });
    const row = (rows && rows[0]) || {};
    const paid = row.paid_until ? Date.parse(row.paid_until) : 0;
    const trialUntil = Date.parse(row.created_at || session.user.created_at) + PLAN.trialDays * DAY;
    const now = Date.now();
    acct = paid > now ? { state: 'active', until: paid } : trialUntil > now ? { state: 'trial', until: trialUntil } : { state: 'expired', until: Math.max(paid, trialUntil) };
    acct.email = session.user.email; acct.checked = now; acct.paid = paid > 0;
    store.set(ACCT_KEY, acct);
  } catch (e) { console.warn('Статус подписки не обновился:', e.message); }   // без сети — живём по последнему известному статусу
  applyAccess();
}
function signOut(silent) {
  session = null; acct = null; store.set(SESSION_KEY, null); store.set(ACCT_KEY, null);
  closePro(); applyAccess();
  if (!silent) toast('Вы вышли из аккаунта');
}
function orderText() {
  return `Здравствуйте! Хочу оплатить Точку Pro на месяц — ${PLAN.price} ₽. Почта аккаунта: ${session ? session.user.email : '—'}`;
}

/* экран входа / оплаты */
let gateStep = '';
function showGate(step) {
  gateStep = step;
  $('#gate').hidden = false;
  $('#gEmail').hidden = step !== 'email'; $('#gCode').hidden = step !== 'code'; $('#gPay').hidden = step !== 'pay';
  document.body.classList.add('gated');
  if (step === 'pay') {
    $('#gPayTitle').textContent = acct && acct.paid ? 'Подписка закончилась' : 'Пробный период закончился';
    $('#gOrder').textContent = orderText();
    $('#gBuy').href = `https://t.me/${PLAN.tg}`;
    document.querySelectorAll('.gTg').forEach(x => x.textContent = '@' + PLAN.tg);
  }
  if (step === 'email') setTimeout(() => $('#gMail').focus(), 60);
  if (step === 'code') setTimeout(() => $('#gOtp').focus(), 60);
}
function hideGate() { $('#gate').hidden = true; gateStep = ''; document.body.classList.remove('gated'); }
function applyAccess() {
  document.documentElement.classList.toggle('is-pro', authOn() && isPro());
  if (!authOn()) hideGate();
  else if (!session) { if (gateStep !== 'code') showGate('email'); }
  else if (!isPro()) showGate('pay');
  else hideGate();
  try { if (current === 'v-crm') renderCrm(); if (current === 'v-prof') renderProfile(); } catch { /* вкладки ещё не готовы — при запуске */ }
}
$('#gPrice').textContent = `${PLAN.price} ₽ в месяц`;
let mailTo = '', resendAt = 0;
async function sendCode() {
  const email = $('#gMail').value.trim().toLowerCase();
  const msg = $('#gMsg1');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Проверьте адрес почты.'; $('#gMail').focus(); return; }
  if (!$('#gAgree').checked) { msg.textContent = 'Нужно согласие с политикой конфиденциальности.'; return; }
  if (/\+/.test(email.split('@')[0])) { msg.textContent = 'Адреса с «+» не подходят — укажите обычный адрес.'; return; }
  $('#gSend').disabled = true; msg.textContent = 'Отправляю код…';
  try {
    await api('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } });
    mailTo = email; resendAt = Date.now() + 60000;
    $('#gTo').textContent = email; $('#gOtp').value = ''; $('#gMsg2').textContent = '';
    showGate('code');
  } catch (e) { msg.textContent = authError(e); }
  finally { $('#gSend').disabled = false; }
}
$('#gEmail').addEventListener('submit', e => { e.preventDefault(); sendCode(); });
$('#gCode').addEventListener('submit', async e => {
  e.preventDefault();
  const code = $('#gOtp').value.replace(/\D/g, ''), msg = $('#gMsg2');
  if (code.length < 6) { msg.textContent = 'Введите код из письма — 6 цифр.'; return; }
  $('#gVerify').disabled = true; msg.textContent = 'Проверяю…';
  try {
    saveSession(await api('/auth/v1/verify', { method: 'POST', body: { type: 'email', email: mailTo, token: code } }));
    msg.textContent = '';
    await loadStatus();
    if (isPro() && acct && acct.state === 'trial') toast(`Добро пожаловать! Пробный период — до ${fmtDate(acct.until)}`, 3200);
  } catch (err) { msg.textContent = authError(err); }
  finally { $('#gVerify').disabled = false; }
});
$('#gOtp').addEventListener('input', () => { const v = $('#gOtp').value.replace(/\D/g, ''); $('#gOtp').value = v; if (v.length === 6) $('#gCode').requestSubmit(); });
$('#gBack').onclick = () => showGate('email');
$('#gResend').onclick = () => {
  const wait = Math.ceil((resendAt - Date.now()) / 1000);
  if (wait > 0) { $('#gMsg2').textContent = `Отправить ещё раз можно через ${wait} с.`; return; }
  $('#gMail').value = mailTo; showGate('email'); sendCode();
};
$('#gBuy').addEventListener('click', () => copy(orderText(), 'Текст скопирован — вставьте его в чат'));
$('#gCheck').onclick = async () => {
  $('#gMsg3').textContent = 'Проверяю оплату…';
  await loadStatus();
  $('#gMsg3').textContent = isPro() ? '' : 'Оплата ещё не отмечена. Обычно это занимает несколько минут после перевода — проверьте позже.';
  if (isPro()) toast(`Спасибо! Подписка активна до ${fmtDate(acct.until)}`, 3000);
};
$('#gOut').onclick = () => signOut();

/* окно «Подписка» из профиля */
function needPro() { if (isPro()) return false; applyAccess(); return true; }
function openPro() {
  const box = $('#accBox'), acts = $('#accActs');
  if (!authOn()) {
    box.innerHTML = `<b>Бета-версия</b><span class="small">Сейчас всё в Точке бесплатно. Скоро появится вход по почте: 3 дня бесплатно, дальше ${PLAN.price} ₽ в месяц.</span>`;
    acts.innerHTML = '';
  } else {
    const st = acct && acct.state;
    box.innerHTML = `<b>${st === 'active' ? `Подписка активна до ${fmtDate(acct.until)}` : st === 'trial' ? `Пробный период: ${daysLeft(acct.until)} ${plural(daysLeft(acct.until), ['день', 'дня', 'дней'])} — до ${fmtDate(acct.until)}` : 'Подписки нет'}</b>
      <span class="small">Аккаунт: ${esc(session ? session.user.email : '')}. Подписка работает на всех устройствах — войдите с этой почтой на телефоне и на компьютере.</span>
      <span class="small">Продление: ${PLAN.price} ₽ в месяц, оплата в Telegram @${PLAN.tg}. Оплаченный месяц прибавляется к текущему сроку.</span>`;
    acts.innerHTML = `<a class="btn pri" id="accBuy" href="https://t.me/${PLAN.tg}" target="_blank" rel="noopener">${st === 'active' ? 'Продлить' : 'Оплатить'} в Telegram</a>
      <button class="btn" type="button" id="accCheck">Обновить статус</button><button class="btn" type="button" id="accOut">Выйти</button>`;
    $('#accBuy').addEventListener('click', () => copy(orderText(), 'Текст скопирован — вставьте его в чат'));
    $('#accCheck').onclick = async () => { await loadStatus(); openPro(); toast('Статус обновлён'); };
    $('#accOut').onclick = () => signOut();
  }
  $('#pro').hidden = false;
}
function closePro() { $('#pro').hidden = true; }
$('#prox').onclick = closePro;
$('#pro').addEventListener('click', e => { if (e.target.id === 'pro') closePro(); });

// при запуске и потом время от времени сверяемся с сервером
applyAccess();
if (authOn()) {
  loadStatus().then(() => {
    if (acct && acct.state === 'trial' && daysLeft(acct.until) <= 1) setTimeout(() => toast(`Пробный период заканчивается ${fmtDate(acct.until)}. Подписка — ${PLAN.price} ₽ в месяц`, 3600), 1800);
  });
  setInterval(loadStatus, 30 * 60 * 1000);
  setInterval(() => { if (acct && acct.until <= Date.now()) applyAccess(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && acct && Date.now() - (acct.checked || 0) > 10 * 60 * 1000) loadStatus(); });
}

/* ---------- фильтр и поиск ---------- */
let cat = 'all', noSite = false, favOnly = false, sel = null, visible = [];
function matches(p, q) {
  if (favOnly && !favs[p.id]) return false;
  if (cat !== 'all' && p.cat !== cat) return false;
  if (noSite && siteKind(p) === 'own') return false;
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
if (inApp) { $('#railDl').hidden = true; $('#pDl').hidden = true; }

/* ---------- список ---------- */
function visibleInView() {
  let b; try { b = map.getBounds(); } catch { return []; }
  return visible.filter(p => b.contains([p.lon, p.lat]));
}
let sortMode = store.get('tochka-sort', 'near');
const plural = (n, f) => f[(n % 10 === 1 && n % 100 !== 11) ? 0 : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 1 : 2];
const fmtDist = d => d < 1000 ? Math.round(d / 10) * 10 + ' м' : (d / 1000).toFixed(1).replace('.', ',') + ' км';
function itemHtml({ p, d }) {
  const l = lead(p);
  return `<button type="button" class="item${p.id === sel ? ' sel' : ''}" data-id="${p.id}">
    <span class="bar" style="background:${CATS[p.cat].color}"></span>
    <span><div class="nm">${isFav(p.id) ? '<span class="favmark">★</span> ' : ''}${esc(p.name)}</div>
    <div class="sub">${esc(CATS[p.cat].name)}${p.addr ? ' · ' + esc(p.addr) : ''} · ${fmtDist(d)}</div>
    <div class="meta-line">${lvPill(l)}${l.kind === 'none' ? '<span class="flag">Нет сайта</span>' : l.kind === 'social' ? '<span class="flag soft">Только соцсети</span>' : ''}${p.mine ? '<span class="mine-tag">Ваше</span>' : ''}</div></span>
  </button>`;
}
function bindItems(root) {
  root.querySelectorAll('.item').forEach(b => b.onclick = () => { go('v-map'); select(b.dataset.id, true); });
}
function emptyText() {
  return favOnly ? 'В избранном пока ничего нет. Откройте заведение и нажмите ☆ рядом с названием.'
    : map.getZoom() < MIN_LOAD_ZOOM ? 'Приблизьте карту или выберите город, чтобы загрузить заведения.'
    : 'Здесь ничего не нашлось. Сдвиньте карту или измените поиск.';
}
function drawList() {
  const c = map.getCenter(), cc = [c.lat, c.lng];
  const src = favOnly ? visible : visibleInView();
  if (sortMode === 'lead' && !isPro()) sortMode = 'near';
  const rows = src.map(p => ({ p, d: distM(cc, [p.lat, p.lon]), s: lead(p).score }))
    .sort(sortMode === 'lead' ? (a, z) => z.s - a.s || a.d - z.d : (a, z) => a.d - z.d).slice(0, 150);
  if (current === 'v-list') {
    const L = $('#list');
    L.innerHTML = `<div class="list-head"><div><b>${favOnly ? 'Избранное' : 'На карте'}: ${rows.length}</b><div class="small">загружено ${places.size.toLocaleString('ru-RU')}</div></div>
      <div class="seg" role="group" aria-label="Сортировка">
        <button type="button" data-sort="near" aria-pressed="${sortMode === 'near'}">Ближе</button>
        <button type="button" data-sort="lead" aria-pressed="${sortMode === 'lead'}" title="Сначала те, кому больше всего нужен сайт">Лучшие клиенты</button>
      </div></div>` + (rows.length ? rows.map(itemHtml).join('') : `<div class="empty">${emptyText()}</div>`);
    L.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { if (b.dataset.sort === 'lead' && needPro('sort')) return; sortMode = b.dataset.sort; store.set('tochka-sort', sortMode); drawList(); L.scrollTop = 0; });
    bindItems(L);
  }
  if (!sel) drawNear(rows);
}
// шторка без выбранного заведения: «Рядом» со сводкой
function drawNear(rows) {
  const noSiteN = rows.filter(r => lead(r.p).kind !== 'own').length;
  $('#card').innerHTML = `<div class="near-h"><b>${favOnly ? 'Избранное' : 'Рядом'}</b>
    <div class="small">${rows.length ? `${rows.length} ${plural(rows.length, ['заведение', 'заведения', 'заведений'])} · ${noSiteN} без своего сайта` : emptyText()}</div></div>`
    + rows.slice(0, 60).map(itemHtml).join('');
  bindItems($('#card'));
}

/* ---------- шторка на телефоне: мини / половина / весь экран ---------- */
const drawer = $('#drawer');
let SNAP = [112, 400, 700], snap = 0;
const isDesk = () => innerWidth > 760;
function measureDrawer() {
  const h = $('#v-map').offsetHeight;
  SNAP = [112, Math.round(h * .52), h - 8];
}
function setSnap(i, anim = true) {
  snap = Math.max(0, Math.min(2, i));
  if (isDesk()) { drawer.style.transform = ''; return; }
  drawer.classList.toggle('anim', anim && !REDUCE);
  drawer.style.transform = `translateY(${SNAP[2] - SNAP[snap]}px)`;
}
{
  let sd = null;
  const grab = $('#grab');
  grab.addEventListener('pointerdown', e => {
    if (isDesk()) return;
    sd = { y: e.clientY, base: SNAP[2] - SNAP[snap], last: e.clientY, lt: performance.now(), v: 0 };
    grab.setPointerCapture(e.pointerId); drawer.classList.remove('anim');
  });
  grab.addEventListener('pointermove', e => {
    if (!sd) return;
    const y = Math.max(0, Math.min(SNAP[2] - SNAP[0], sd.base + e.clientY - sd.y));
    drawer.style.transform = `translateY(${y}px)`;
    const now = performance.now();
    sd.v = (e.clientY - sd.last) / Math.max(1, now - sd.lt); sd.last = e.clientY; sd.lt = now;
  });
  const end = e => {
    if (!sd) return;
    if (Math.abs(e.clientY - sd.y) < 5) { setSnap(snap === 2 ? 0 : snap + 1); sd = null; return; }   // просто нажатие — следующий уровень
    const visibleH = SNAP[2] - (sd.base + e.clientY - sd.y);
    let i = SNAP.reduce((b, s, k) => Math.abs(s - visibleH) < Math.abs(SNAP[b] - visibleH) ? k : b, 0);
    if (sd.v < -0.5) i = Math.min(2, Math.max(i, snap + 1));
    if (sd.v > 0.5) i = Math.max(0, Math.min(i, snap - 1));
    setSnap(i); sd = null;
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
}

/* ---------- вкладки ---------- */
let current = 'v-map';
function movePill() {
  const t = document.querySelector('.tab[aria-selected="true"]'), pill = $('#tabpill');
  if (!t) return;
  const L = t.offsetLeft, T = t.offsetTop, W = t.offsetWidth, H = t.offsetHeight;
  if (isDesk()) {
    pill.style.width = (W - 4) + 'px'; pill.style.height = (H - 4) + 'px';
    pill.style.transform = `translate(${L + 2}px,${T + 2 - 6}px)`;
  } else {
    const w = Math.min(W - 8, 84);
    pill.style.width = w + 'px'; pill.style.height = '';
    pill.style.transform = `translateX(${L + (W - w) / 2}px)`;
  }
}
function go(v) {
  if (current === v) return;
  current = v;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.v === v));
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('off', el.id !== v));
  movePill();
  if (v === 'v-map') requestAnimationFrame(() => map.resize());
  if (v === 'v-list') { drawList(); $('#list').scrollTop = 0; }
  if (v === 'v-crm') renderCrm();
  if (v === 'v-prof') renderProfile();
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => go(t.dataset.v));
addEventListener('resize', () => { measureDrawer(); setSnap(snap, false); movePill(); });

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
  const mobile = !isDesk();
  if (mobile && snap !== 1) setSnap(1);
  // заведение — в центре свободной части карты (над шторкой или левее панели)
  const off = mobile ? [0, -Math.round(SNAP[1] / 2) + 20] : [-Math.round((parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panelw')) || 380) / 2) - 14, 0];
  if (fly || map.getZoom() < 15.5) {
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16.5), offset: off, essential: true, duration: REDUCE ? 0 : 1200 });
  } else {
    map.easeTo({ center: [p.lon, p.lat], offset: off, duration: REDUCE ? 0 : 500 });
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
  const l = lead(p);
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
      ${row('Сайт', p.site ? `<a href="${esc(/^https?:/.test(p.site) ? p.site : 'https://' + p.site)}" target="_blank" rel="noopener">${esc(p.site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>${l.kind === 'social' ? '<small>это соцсеть или онлайн-запись, своего сайта нет</small>' : ''}` : '<span class="nosite-v">Нет</span><small>можно предложить сделать сайт</small>')}
      ${row('Потенциал', `${lvPill(l)} <b class="lv-t lv-t-${l.level}">${LV[l.level]}</b><small>${esc(l.why.join(' · '))}</small>`)}
      ${p.email ? row('Email', esc(p.email), `<button class="mini" type="button" data-copy="${esc(p.email)}">Копировать</button>`) : ''}
      ${soc ? row('Соцсети', soc) : ''}
      ${p.operator ? row('Компания', esc(p.operator)) : ''}
    </div>
    <div class="acts">
      <button class="btn pri" type="button" id="write">Написать</button>
      <button class="btn" type="button" id="tonote">В блокнот</button>
      <button class="btn" type="button" data-copy="${esc(contactText(p))}">Копировать контакты</button>
      <a class="btn" href="https://yandex.ru/maps/?rtext=~${p.lat},${p.lon}" target="_blank" rel="noopener">Маршрут</a>
    </div>
    ${p.mine ? `<div class="mine-bar"><span>Это место добавили вы. Его видно только на этом устройстве.</span>
      <div class="mine-acts"><button class="mini" type="button" id="medit">Изменить</button><button class="mini" type="button" id="mdel">Удалить</button>
      <a class="mini" href="https://www.openstreetmap.org/edit#map=19/${p.lat}/${p.lon}" target="_blank" rel="noopener">Добавить на OpenStreetMap для всех</a></div></div>`
    : `<div class="src">Источник: OpenStreetMap${p.db ? ' (база Точки)' : ''}. Нашли ошибку? <a href="${p.osm}" target="_blank" rel="noopener">Исправить на карте OSM</a></div>`}`;
  $('#card').scrollTop = 0;
  $('#cx').onclick = closeCard;
  $('#fav').onclick = () => { toggleFav(p.id); const on = isFav(p.id); $('#fav').textContent = on ? '★' : '☆'; $('#fav').setAttribute('aria-pressed', on); };
  // перезапуск «всплытия» карточки
  const cardEl = $('#card'); cardEl.classList.remove('pop'); void cardEl.offsetWidth; cardEl.classList.add('pop');
  $('#write').onclick = () => openMsg(p);
  if (p.mine) {
    $('#medit').onclick = () => openAddForm(null, p);
    $('#mdel').onclick = e => {
      const b = e.currentTarget;
      if (b.dataset.sure) deleteMine(p.id);
      else { b.dataset.sure = '1'; b.textContent = 'Точно удалить?'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Удалить'; b.classList.remove('danger'); } }, 4000); }
    };
  }
  $('#tonote').onclick = () => { notePlace = p; openNotes(); const t = $('#nt'); t.value = contactText(p) + '\n'; t.focus(); t.setSelectionRange(t.value.length, t.value.length); };
  drawList();
}
function closeCard() {
  if (!sel) return;
  sel = null; markSelected(); drawList();
  if (!isDesk()) setSnap(0);
}

/* ---------- копирование и тост ---------- */
document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (b) copy(b.dataset.copy); });
function copy(t, msg = 'Скопировано') {
  const fb = () => {
    const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0';
    document.body.appendChild(a); a.select();
    try { document.execCommand('copy'); toast(msg); } catch { toast('Не удалось скопировать'); }
    a.remove();
  };
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast(msg), fb); else fb();
}
let tt; function toast(m, ms = 1700) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), ms); }
function setStatus(m) { const s = $('#status'); s.textContent = m; s.hidden = !m; }

/* ---------- блокнот ---------- */
let notes = store.get(NOTES_KEY, []);
let notePlace = null;    // заведение, из карточки которого открыли блокнот
const STATUSES = [['new', 'Новый'], ['sent', 'Написал'], ['reply', 'Ответил'], ['deal', 'Договорились'], ['no', 'Отказ']];
const stName = s => (STATUSES.find(x => x[0] === s) || STATUSES[0])[1];
const DAY = 864e5;
const dayAt = days => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime() + days * DAY; };
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
const isDue = n => n.r && n.r <= endOfToday() && n.s !== 'deal' && n.s !== 'no';
const fmtDay = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const saveNotes = () => { if (!store.set(NOTES_KEY, notes)) toast('Не удалось сохранить: память браузера заполнена'); };
function drawNotes() {
  $('#cnt').textContent = notes.length;
  const due = notes.filter(isDue).length;
  $('#due').textContent = due; $('#due').hidden = !due;
  $('#due').setAttribute('aria-label', due ? `Пора написать: ${due}` : '');
  $('#nl').innerHTML = notes.length ? notes.map(n => `
    <div class="note"><div class="nt-top">
      <button class="st st-${n.s || 'new'}" type="button" data-st="${n.d}" title="Нажмите, чтобы сменить статус">${stName(n.s)}</button>
      <span class="small">${new Date(n.d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
      ${n.r ? `<div class="remline${isDue(n) ? ' due' : ''}">⏰ ${isDue(n) ? 'Пора написать · ' : 'Напомнить '}${fmtDay(n.r)}</div>` : ''}
      <p>${esc(n.t)}</p>
      <div class="nf">
      ${n.lat != null ? `<button class="mini" type="button" data-go="${n.d}">На карте</button>` : '<span></span>'}
      <div><select class="mini rem" data-rem="${n.d}" aria-label="Напоминание">
        <option value="">⏰ Напомнить</option><option value="1">Завтра</option><option value="3">Через 3 дня</option><option value="7">Через неделю</option>${n.r ? '<option value="0">Убрать</option>' : ''}
      </select>
      <button class="mini" type="button" data-copy="${esc(n.t)}">Копировать</button>
      <button class="mini" type="button" data-del="${n.d}">Удалить</button></div></div></div>`).join('')
    : '<div class="hint">Пока пусто. Записывайте сюда телефоны, имена и кому написать. Или откройте заведение на карте и нажмите «В блокнот» — контакты подставятся сами.</div>';
  $('#nl').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    notes = notes.filter(n => n.d !== +b.dataset.del); saveNotes(); drawNotes(); toast('Заметка удалена');
  });
  $('#nl').querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
    const n = notes.find(x => x.d === +b.dataset.st); if (!n) return;
    const i = STATUSES.findIndex(x => x[0] === (n.s || 'new'));
    n.s = STATUSES[(i + 1) % STATUSES.length][0];
    if (n.s === 'sent') n.sentAt = Date.now();
    if (n.s === 'deal' || n.s === 'no') delete n.r;
    saveNotes(); drawNotes();
  });
  $('#nl').querySelectorAll('[data-rem]').forEach(sel => sel.onchange = () => {
    const n = notes.find(x => x.d === +sel.dataset.rem); if (!n || sel.value === '') return;
    if (sel.value === '0') { delete n.r; toast('Напоминание убрано'); }
    else { n.r = dayAt(+sel.value); toast('Напомню ' + fmtDay(n.r)); }
    saveNotes(); drawNotes();
  });
  if (current === 'v-crm') renderCrm(); else renderTodoBadge();
  $('#nl').querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const n = notes.find(x => x.d === +b.dataset.go); if (!n) return;
    go('v-map');
    if (n.pid && !places.has(n.pid) && n.place) places.set(n.pid, n.place);
    if (n.pid && places.has(n.pid)) select(n.pid, true);
    else map.flyTo({ center: [n.lon, n.lat], zoom: 16.5, essential: true });
  });
}
$('#nf').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('#nt').value.trim(); if (!t) { $('#nt').focus(); return; }
  if (needPro()) return;
  const n = { t, d: Date.now(), s: 'new' };
  if (notePlace) { n.pid = notePlace.id; n.lat = notePlace.lat; n.lon = notePlace.lon; n.place = notePlace; notePlace = null; }
  notes.unshift(n); saveNotes(); $('#nt').value = ''; drawNotes(); toast('Сохранено');
});
$('#copyall').onclick = () => notes.length ? copy(notes.map(n => n.t).join('\n\n———\n\n')) : toast('Блокнот пуст');
// Экспорт в таблицу: CSV для Excel (с BOM и «;», чтобы русский Excel открыл без кракозябр)
$('#export').onclick = () => {
  if (needPro('export')) return;
  if (!notes.length) return toast('Блокнот пуст');
  const head = ['Дата', 'Статус', 'Заведение', 'Категория', 'Телефон', 'Адрес', 'Сайт', 'Потенциал', 'Напомнить', 'Заметка'];
  const rows = notes.map(n => {
    const p = n.place || {};
    return [new Date(n.d).toLocaleString('ru-RU'), stName(n.s), p.name || '', p.cat ? CATS[p.cat].name : '', p.phone || '',
      [p.city, p.addr].filter(Boolean).join(', '), p.site || '', p.name ? lead(p).score : '', n.r ? fmtDay(n.r) : '', n.t];
  });
  // В Android-приложении скачивание файлов не работает — копируем таблицу для вставки
  if (window.Capacitor) {
    copy([head, ...rows].map(r => r.map(v => String(v).replace(/[\t\r\n]+/g, ' / ')).join('\t')).join('\n'),
      'Таблица скопирована — вставьте её в Excel или Google Таблицы');
    return;
  }
  const csv = '\ufeff' + [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `tochka-bloknot-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('Файл сохранён в «Загрузки» — откройте его в Excel', 2600);
};
/* ---------- «Написать»: шаблоны сообщений ---------- */
const TPL_KEY = 'tochka-tpl', SIGN_KEY = 'tochka-sign';
const DEFAULT_TPL = [
  { n: 'Знакомство', t: 'Здравствуйте! Смотрю «{название}» на карте и вижу, что {про_сайт}. Я делаю сайты для салонов и барбершопов: с ценами, мастерами и онлайн-записью. Могу бесплатно показать, как мог бы выглядеть ваш сайт. Интересно?{подпись}' },
  { n: 'Коротко', t: 'Добрый день! Делаю сайты для салонов и барбершопов. Для «{название}» могу сделать простой сайт с онлайн-записью примерно за неделю. Показать примеры работ?{подпись}' },
  { n: 'Повторно', t: 'Здравствуйте! Пишу ещё раз насчёт сайта для «{название}». Если тема актуальна — покажу примеры и отвечу на вопросы. Если нет, просто напишите, больше не побеспокою.{подпись}' }
];
let tpls = store.get(TPL_KEY, null) || DEFAULT_TPL.map(x => ({ ...x }));
let sign = store.get(SIGN_KEY, '');
let msgPlace = null, tplIdx = 0, logged = false;
const ABOUT_SITE = {
  none: 'у вас пока нет своего сайта',
  social: 'вас можно найти только через соцсети или онлайн-запись, а своего сайта нет',
  own: 'у вас уже есть сайт — могу сделать его современнее и удобнее для записи'
};
function nearestCity(lat, lon) {
  let best = '', bd = Infinity;
  for (const [n, la, lo] of CITIES) { const d = distM([lat, lon], [la, lo]); if (d < bd) { bd = d; best = n; } }
  return bd < 60000 ? best : '';
}
function fillTpl(t, p) {
  return t.replace(/\{название\}/g, p.name)
    .replace(/\{категория\}/g, CATS[p.cat].name.toLowerCase())
    .replace(/\{город\}/g, p.city || nearestCity(p.lat, p.lon))
    .replace(/\{про_сайт\}/g, ABOUT_SITE[siteKind(p)])
    .replace(/\{подпись\}/g, sign.trim() ? '\n\n' + sign.trim() : '');
}
const waNumber = ph => {
  let d = String(ph).split(/[;,]/)[0].replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length >= 11 ? d : '';
};
function openMsg(p) {
  msgPlace = p; logged = false;
  const exists = notes.find(n => n.pid === p.id && n.s && n.s !== 'new');
  tplIdx = exists && tpls.length > 2 ? 2 : 0;   // уже писали — предлагаем «Повторно»
  $('#msTitle').textContent = 'Написать: ' + p.name;
  $('#msSend').hidden = false; $('#msTpl').hidden = true;
  drawMsg();
  $('#ms').hidden = false;
}
function drawMsg() {
  const p = msgPlace; if (!p) return;
  if (!tpls.length) tpls = DEFAULT_TPL.map(x => ({ ...x }));
  tplIdx = Math.min(tplIdx, tpls.length - 1);
  $('#tplChips').innerHTML = tpls.map((x, i) => `<button type="button" class="chip" data-tpl="${i}" aria-pressed="${i === tplIdx}">${esc(x.n || 'Шаблон ' + (i + 1))}</button>`).join('');
  $('#tplChips').querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => { tplIdx = +b.dataset.tpl; drawMsg(); });
  $('#msText').value = fillTpl(tpls[tplIdx].t, p);
  const wa = p.phone && waNumber(p.phone);
  const acts = [`<button class="btn pri" type="button" data-act="copy">Скопировать текст</button>`];
  if (p.tg) acts.push(`<a class="btn" data-act="open" href="${esc(handle(p.tg, 'https://t.me/'))}" target="_blank" rel="noopener">Telegram</a>`);
  if (wa) acts.push(`<a class="btn" data-act="wa" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (p.vk) acts.push(`<a class="btn" data-act="open" href="${esc(handle(p.vk, 'https://vk.com/'))}" target="_blank" rel="noopener">VK</a>`);
  if (siteKind(p) === 'social') acts.push(`<a class="btn" data-act="open" href="${esc(/^https?:/.test(p.site) ? p.site : 'https://' + p.site)}" target="_blank" rel="noopener">Их страница</a>`);
  if (p.email) acts.push(`<a class="btn" data-act="mail" href="mailto:${esc(p.email)}">Email</a>`);
  if (p.phone) acts.push(`<a class="btn" data-act="call" href="tel:${esc(String(p.phone).split(/[;,]/)[0].replace(/[^\d+]/g, ''))}">Позвонить</a>`);
  $('#msActs').innerHTML = acts.join('');
  $('#msActs').querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const text = $('#msText').value;
    const act = b.dataset.act;
    if (act === 'wa') b.href = `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
    if (act === 'mail') b.href = `mailto:${p.email}?subject=${encodeURIComponent('Сайт для ' + p.name)}&body=${encodeURIComponent(text)}`;
    if (act === 'copy' || act === 'open') copy(text, act === 'open' ? 'Текст скопирован — вставьте его в чат' : 'Текст скопирован');
    if (act !== 'call') logContact(p);
  });
}
function logContact(p) {
  if (logged || !$('#msNote').checked) return;
  logged = true;
  let n = notes.find(x => x.pid === p.id);
  if (!n) {
    n = { t: contactText(p), d: Date.now(), s: 'sent', pid: p.id, lat: p.lat, lon: p.lon, place: p }; notes.unshift(n);
  }
  else if (!n.s || n.s === 'new') n.s = 'sent';
  n.sentAt = Date.now();
  if ($('#msRemind').checked) n.r = dayAt(3);
  saveNotes(); drawNotes();
}
function closeMsg() { $('#ms').hidden = true; msgPlace = null; }
$('#msx').onclick = closeMsg;
$('#ms').addEventListener('click', e => { if (e.target.id === 'ms') closeMsg(); });
// редактор своих шаблонов
function drawTplEditor() {
  $('#sign').value = sign;
  $('#tplList').innerHTML = tpls.map((x, i) => `
    <div class="tpl-ed">
      <div class="tpl-row"><input class="tpl-n" data-i="${i}" value="${esc(x.n)}" placeholder="Название шаблона" aria-label="Название шаблона">
      <button class="mini" type="button" data-tdel="${i}" ${tpls.length < 2 ? 'disabled' : ''}>Удалить</button></div>
      <textarea class="tpl-t" data-i="${i}" rows="4" aria-label="Текст шаблона">${esc(x.t)}</textarea>
    </div>`).join('');
  $('#tplList').querySelectorAll('.tpl-n').forEach(el => el.oninput = () => { tpls[+el.dataset.i].n = el.value; store.set(TPL_KEY, tpls); });
  $('#tplList').querySelectorAll('.tpl-t').forEach(el => el.oninput = () => { tpls[+el.dataset.i].t = el.value; store.set(TPL_KEY, tpls); });
  $('#tplList').querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => { tpls.splice(+b.dataset.tdel, 1); store.set(TPL_KEY, tpls); drawTplEditor(); });
}
$('#sign').oninput = () => { sign = $('#sign').value; store.set(SIGN_KEY, sign); };
$('#msEdit').onclick = () => { if (needPro('tpl')) return; $('#msSend').hidden = true; $('#msTpl').hidden = false; drawTplEditor(); };
$('#tplAdd').onclick = () => { tpls.push({ n: 'Мой шаблон', t: 'Здравствуйте! ' }); store.set(TPL_KEY, tpls); drawTplEditor(); };
$('#tplReset').onclick = () => { tpls = DEFAULT_TPL.map(x => ({ ...x })); store.set(TPL_KEY, tpls); drawTplEditor(); toast('Стандартные шаблоны возвращены'); };
$('#tplDone').onclick = () => { if (!msgPlace) { closeMsg(); renderProfile(); return; } $('#msTpl').hidden = true; $('#msSend').hidden = false; drawMsg(); };

function openNotes() { go('v-crm'); requestAnimationFrame(() => $('#nf').scrollIntoView({ block: 'center', behavior: REDUCE ? 'auto' : 'smooth' })); }

/* ---------- «Мои клиенты»: сводка, кому написать, воронка, неделя ---------- */
const BAR = { new: 'var(--bar-new)', sent: 'var(--bar-sent)', reply: 'var(--bar-reply)', deal: 'var(--bar-deal)', no: 'var(--bar-no)' };
const noteName = n => (n.place && n.place.name) || (n.t || '').split('\n')[0].slice(0, 60) || 'Заметка';
function renderTodoBadge() { /* значок на вкладке обновляет drawNotes */ }
function renderCrm() {
  const cnt = k => notes.filter(n => (n.s || 'new') === k).length;
  const contacted = notes.length - cnt('new'), answered = cnt('reply') + cnt('deal');
  $('#kpis').innerHTML = [[contacted, 'написал'], [answered, 'ответили'], [cnt('deal'), 'договорились']]
    .map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');
  const max = Math.max(1, ...STATUSES.map(([k]) => cnt(k)));
  $('#funnel').innerHTML = STATUSES.map(([k, l]) => `<div class="fr"><span>${l}</span><div class="track"><div class="fill" style="width:${cnt(k) / max * 100}%;background:${BAR[k]}"></div></div><b>${cnt(k)}</b></div>`).join('');
  $('#conv').textContent = contacted ? `ответили ${Math.round(answered / contacted * 100)}%` : '';
  const sec = document.querySelector('.sec-funnel');
  sec.classList.toggle('locked', !isPro());
  if (!isPro() && !sec.querySelector('.lockcta')) {
    sec.insertAdjacentHTML('beforeend', `<div class="lockcta"><b>Воронка и статистика — в Pro</b><span>Сколько вам ответили, кто договорился и сколько сообщений за неделю</span><button class="btn pri" type="button" data-pro="stats">Открыть Pro</button></div>`);
  }
  // кому написать сегодня
  const due = notes.filter(isDue).sort((a, b) => a.r - b.r);
  $('#todoN').textContent = due.length || '';
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  $('#todo').innerHTML = due.length ? due.map(n => `<div class="tcard" data-d="${n.d}">
      <div><div class="nm">${esc(noteName(n))}</div><div class="sb">${stName(n.s)} · ${n.r < today0.getTime() ? 'просрочено с ' + fmtDay(n.r) : 'сегодня'}</div></div>
      <div class="ta">${n.place ? '<button class="btn pri" type="button" data-t="write">Написать</button>' : ''}
      <button class="btn" type="button" data-t="done" title="Отметить, что написали">Написал ✓</button>
      <button class="mini" type="button" data-t="later" title="Напомнить завтра">Завтра</button></div></div>`).join('')
    : `<p class="hint">${notes.length ? 'На сегодня всё. Отличная работа!' : 'Пока пусто. Откройте заведение на карте и нажмите «Написать» — оно появится здесь с напоминанием.'}</p>`;
  $('#todo').querySelectorAll('.tcard').forEach(card => card.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const n = notes.find(x => x.d === +card.dataset.d); if (!n) return;
    if (b.dataset.t === 'write') { const p = n.place; if (p) { if (!places.has(p.id)) places.set(p.id, p); openMsg(places.get(p.id)); } return; }
    if (b.dataset.t === 'later') { n.r = dayAt(1); toast('Напомню завтра'); }
    if (b.dataset.t === 'done') {
      n.sentAt = Date.now();
      if (!n.s || n.s === 'new') n.s = 'sent';
      if (n.s === 'sent') { n.r = dayAt(3); toast(`«${noteName(n)}»: напомню через 3 дня, если не ответят`); } else delete n.r;
    }
    card.classList.add('done');
    saveNotes();
    setTimeout(drawNotes, REDUCE ? 0 : 280);
  }));
  // сообщений за неделю (по дате «Написал»)
  const days = [...Array(7)].map((_, i) => { const d = new Date(today0); d.setDate(d.getDate() - 6 + i); return d; });
  const sentDays = notes.map(n => n.sentAt || (n.s && n.s !== 'new' ? n.d : 0)).filter(Boolean);
  const per = days.map(d => sentDays.filter(t => t >= d.getTime() && t < d.getTime() + DAY).length);
  const wmax = Math.max(1, ...per);
  $('#week').innerHTML = per.map((v, i) => `<div class="wd${i === 6 ? ' today' : ''}"><small>${v || ''}</small><div class="b" style="height:${Math.max(3, v / wmax * 80)}px"></div></div>`).join('');
  $('#wl').innerHTML = days.map((d, i) => `<span${i === 6 ? ' class="today"' : ''}>${i === 6 ? 'Сегодня' : d.toLocaleDateString('ru-RU', { weekday: 'short' })}</span>`).join('');
  $('#weekSum').textContent = per.reduce((a, b) => a + b, 0) + ' за 7 дней';
}

/* ---------- профиль ---------- */
const REM_KEY = 'tochka-remind';
function renderProfile() {
  $('#pProSub').textContent = !authOn() ? 'Бета-версия — сейчас всё бесплатно'
    : !acct ? '—' : acct.state === 'active' ? `Активна до ${fmtDate(acct.until)}`
    : acct.state === 'trial' ? `Пробный период · осталось ${daysLeft(acct.until)} ${plural(daysLeft(acct.until), ['день', 'дня', 'дней'])}` : 'Закончилась — продлите';
  $('#pAcc').hidden = !authOn();
  $('#pAccSub').textContent = session ? session.user.email : 'Вход не выполнен';
  document.querySelectorAll('#theme [data-t]').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === themeMode));
  $('#sw3d').setAttribute('aria-checked', map.getPitch() > 5);
  $('#swRem').setAttribute('aria-checked', store.get(REM_KEY, true));
  $('#pTplSub').textContent = `${tpls.length} ${plural(tpls.length, ['шаблон', 'шаблона', 'шаблонов'])}${sign.trim() ? ' · подпись задана' : ' · без подписи'}`;
  $('#pStats').textContent = `Заметок: ${notes.length} · Избранное: ${Object.keys(favs).length} · Свои места: ${Object.keys(mine).length} · Загружено заведений: ${places.size.toLocaleString('ru-RU')}`;
}
document.querySelectorAll('#theme [data-t]').forEach(b => b.onclick = () => setTheme(b.dataset.t));
$('#sw3d').onclick = () => { $('#tilt').click(); setTimeout(renderProfile, 950); $('#sw3d').setAttribute('aria-checked', !(map.getPitch() > 5)); };
$('#swRem').onclick = () => { const on = !store.get(REM_KEY, true); store.set(REM_KEY, on); $('#swRem').setAttribute('aria-checked', on); toast(on ? 'Напоминания включены' : 'Напоминания выключены'); };
$('#pTpl').onclick = () => { if (needPro('tpl')) return; msgPlace = null; $('#msTitle').textContent = 'Мои шаблоны и подпись'; $('#msSend').hidden = true; $('#msTpl').hidden = false; drawTplEditor(); $('#ms').hidden = false; };
$('#pExport').onclick = () => $('#export').click();
$('#pPro').onclick = () => openPro();
$('#pAcc').onclick = () => openPro();
document.addEventListener('click', e => { const b = e.target.closest('[data-pro]'); if (b) openPro(); });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSheet(); closeMsg(); closeAdd(); stopAdd(); closePro(); }
  // «/» — быстро перейти к поиску (как на многих сайтах)
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); go('v-map'); setTimeout(() => $('#q').focus(), 30); }
});

/* ---------- старт ---------- */
document.querySelectorAll('#theme [data-t]').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === themeMode));
measureDrawer(); setSnap(0, false); movePill();
try { document.fonts.ready.then(movePill); } catch { /* старый браузер */ }
drawNotes();
{ const due = notes.filter(isDue).length; if (due && store.get(REM_KEY, true)) setTimeout(() => toast(`Пора написать: ${due}. Откройте «Клиенты»`, 3200), 1500); }
visible = [...places.values()];
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
