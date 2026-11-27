'use strict';
/* Точка — 3D-карта салонов красоты и барбершопов по всей России.
   Карта: MapLibre GL + OpenFreeMap (векторные тайлы, 3D-дома).
   Заведения: OpenStreetMap (Overpass API), лицензия ODbL. Поиск городов: Nominatim. */

const CATS = {
 bakery:{name:'Пекарня',color:'#B77942',syn:['пекарня','булочная','выпечка','bakery']},
 restaurant:{name:'Ресторан',color:'#B56658',syn:['ресторан','restaurant']},
 vet:{name:'Ветклиника',color:'#398789',syn:['ветеринар','ветклиника','veterinary']},
  pet: { name: 'Зоомагазин', color: '#5C7C68', syn: ['зоомагазин', 'зоотовары', 'pet'] },
  flowers: { name: 'Цветы', color: '#9A648B', syn: ['цветы', 'букет', 'florist'] },
  cafe: { name: 'Кофейня', color: '#A77751', syn: ['кофе', 'кофейня', 'cafe', 'coffee'] },
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
const CACHE_KEY = 'tochka-places-v3-protected';
const CACHE_DAYS = 7;
const CACHE_MAX = 6000;            // столько заведений максимум держим в памяти браузера
const NOTES_KEY = 'tochka-notes';
const VIEW_KEY = 'tochka-view';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const THEME_KEY = 'tochka-theme';
const sysDark = matchMedia('(prefers-color-scheme: dark)');
// по умолчанию светлая тема (как у карт); «Авто» — только если человек сам её выбрал в Профиле
let themeMode = (() => { try { const t = localStorage.getItem(THEME_KEY); return t === 'dark' || t === 'navy' || t === 'auto' ? t : 'light'; } catch { return 'light'; } })();
const computeDark = () => themeMode === 'dark' || themeMode === 'navy' || (themeMode === 'auto' && sysDark.matches);
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
  if(t.shop==='bakery')return 'bakery';
  if(t.amenity==='restaurant')return 'restaurant';
  if(t.amenity==='veterinary')return 'vet';
  if (t.shop === 'pet') return 'pet';
  if (t.shop === 'florist') return 'flowers';
  if (t.amenity === 'cafe') return 'cafe';
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
function cleanPlaceEmail(raw) {
  for (const part of String(raw || '').split(/[;,\s]+/)) {
    const address = part.replace(/^mailto:/i, '');
    const match = address.match(/^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/);
    if (!match || address.length > 254 || match[1].length > 64 || match[2].length > 253) continue;
    if (match[2].split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) return address;
  }
  return '';
}
function parseEl(el) {
  const t = el.tags || {};
  if (!t.name) return null;
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const street = t['addr:street'], house = t['addr:housenumber'], city = t['addr:city'];
  const p = {
    id: el.type[0] + el.id,
    osm: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name: t.name, cat: categorize(t), lat, lon,
    addr: [street, house].filter(Boolean).join(', '),
    city: city || '',
    phone: t.phone || t['contact:phone'] || '',
    site: (t.website || t['contact:website'] || t.url || '').split(/\s*;\s*/)[0],   // бывает несколько через «;» — берём первый
    email: t.email === '*' || t['contact:email'] === '*' ? '*' : cleanPlaceEmail([t.email, t['contact:email']].filter(Boolean).join(';')),
    hours: t.opening_hours || '',
    vk: t['contact:vk'] || '', tg: t['contact:telegram'] || '', inst: t['contact:instagram'] || '',
    operator: t.operator || ''
  };
  // «*» в своей базе — контакт есть, но лежит на сервере и придёт только с Pro (withContacts)
  if ([p.phone, p.email, p.vk, p.tg, p.inst].includes('*')) p.locked = true;
  return p;
}

function relockProtectedPlace(p) {
  if (!p?.serverContactsBeforeReveal) return;
  Object.assign(p, p.serverContactsBeforeReveal);
  p.locked = true;
  delete p.serverContactsBeforeReveal;
  delete p.freeRevealedFor;
}

const places = new Map();
const loadedCells = new Set();
(function restoreCache() {
  const c = store.get(CACHE_KEY, null);
  if (!c || Date.now() - c.t > CACHE_DAYS * 864e5) return;
  c.cells.forEach(k => loadedCells.add(k));
  c.places.forEach(p => { relockProtectedPlace(p); places.set(p.id, p); });
})();
let saveTimer;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    let list = [...places.values()].filter(p => !p.db && !p.mine && !p.extra);
    let cells = [...loadedCells];
    if (list.length > CACHE_MAX) { list = list.slice(-CACHE_MAX); cells = []; }
    if (!store.set(CACHE_KEY, { t: Date.now(), cells, places: list })) store.set(CACHE_KEY, null);
  }, 800);
}

async function overpass(q, signal) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, { signal, method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
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
const NEW_LEADS_KEY = 'tochka-new-leads-v1';
function notifyNewLeads(c, rows) {
  if (!store.get('tochka-remind', true) || !c.updated) return;
  const center = map.getCenter();
  const area = `${c.slug}:${Math.round(center.lat * 10)}:${Math.round(center.lng * 10)}`;
  const count = rows.reduce((n, [id, lat, lon, tags]) => {
    if (Math.abs(lat - center.lat) > .08 || Math.abs(lon - center.lng) > .13) return n;
    const site = (tags.website || tags['contact:website'] || tags.url || '').split(/\s*;\s*/)[0];
    return n + (!site || siteKind({ site }) !== 'own' ? 1 : 0);
  }, 0);
  const all = store.get(NEW_LEADS_KEY, {}), prev = all[area];
  if (prev && prev.version !== c.updated && count > prev.count) {
    const city = dbCityAt(center.lat, center.lng);
    toast(`В районе ${city ? city.name : c.name} стало больше заведений без сайта: +${count - prev.count}`, 4200);
  }
  all[area] = { version: c.updated, count };
  const keys = Object.keys(all);
  if (keys.length > 40) for (const k of keys.slice(0, keys.length - 40)) delete all[k];
  store.set(NEW_LEADS_KEY, all);
}
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
      notifyNewLeads(c, rows);
      for (const [id, lat, lon, tags] of rows) {
        const p = parseEl({ type: OSM_TYPES[id[0]] || 'node', id: id.slice(1), lat, lon, tags });
        if (p && !places.has(p.id)) { p.db = true; places.set(p.id, p); }
      }
      if (c.s != null) // старая база по городам
        for (let i = Math.ceil(c.s / CELL); i < Math.floor(c.n / CELL); i++)
          for (let j = Math.ceil(c.w / CELL); j < Math.floor(c.e / CELL); j++) dbCells.add(i + ':' + j);
      c.loadedOk = true;
      // проверка сайтов роботом — для регионов, если уже есть; без неё всё работает как раньше
      if (c.cells) fetch(`data/checks/${c.slug}.json`, { cache: 'no-cache' })
        .then(r => r.ok ? r.json() : null).then(m => { if (m) { applyChecks(m); applyFilter(); } }).catch(() => {});
    })
    .catch(() => { c.failedAt = Date.now(); dbLoading.delete(c.slug); });
  dbLoading.set(c.slug, pr);
  return pr;
}
const loadCityDb = loadDb;
// scripts/check_sites.py: own — нашли свой сайт, rec — только онлайн-запись, none — проверили и сайт не нашли
const CHECK_HOW = { d: 'по названию', v: 'во ВКонтакте', dv: 'по названию и во ВКонтакте' };
const checkNote = p => p.siteDead && siteKind(p) === 'none' ?`<small class="dead">⚠️ Ссылка не работает — страница удалена или домен истёк (проверили ${fmtDay(Date.parse(p.siteDead))}). Хороший повод предложить новый сайт</small>` : !p.chk ? '' : `<small class="chk">${p.chk.s === 'none' ? '✓ Проверили ' + (CHECK_HOW[p.chk.how] || '') + ' — сайт не нашли'
  : p.chk.s === 'own' ? '✓ Нашли при проверке ' + (CHECK_HOW[p.chk.how] || '') : '✓ Ссылка на запись найдена ' + (CHECK_HOW[p.chk.how] || '')}, ${fmtDay(Date.parse(p.chk.d))}</small>`;
function applyChecks(m) {
  // указанный сайт или Taplink не открывается (удалён, домен истёк) — для поиска клиентов это «сайта нет»
  for (const [id, [st, d]] of Object.entries(m._links || {})) {
    const p = places.get(id); if (!p) continue;
    p.siteDead = st === 'dead' ? d : '';
    leadCache.delete(p);
  }
  for (const [id, value] of Object.entries(m._vk_candidates || {})) {
    const p = places.get(id); if (!p) continue;
    p.vkCandidates = Array.isArray(value && value.items) ? value.items : [];
  }
  for (const [id, v] of Object.entries(m)) {
    if (id === '_links' || id === '_vk_candidates') continue;
    const [s, url, d, how] = v;
    const p = places.get(id); if (!p) continue;
    p.chk = { s, d, how };
    if ((s === 'own' || s === 'rec') && url && siteKind(p) !== 'own') p.site = url;
    leadCache.delete(p);
  }
}

let loading = false, pending = false;
const firstRunPending = () => !store.get('tochka-hello', 0) && !store.get('tochka-session', null);
async function loadView() {
  // Приветственный экран должен открываться сразу, без разбора городской базы под ним.
  if (firstRunPending()) return;
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
      // Старый городской файл дублирует новые региональные файлы. Не грузим оба набора сразу.
      if (city && fresh(city) && !dbCovers(Math.floor(c.lat / CELL), Math.floor(c.lng / CELL))
        && !need.some(r => r.cells?.includes(cellKey(c.lat, c.lng)))) need.push(city);
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
    if (document.querySelector('.item.skel')) drawList();   // заготовки строк — заменить на итог загрузки
    if (pending) { pending = false; loadView(); }
  }
}

/* ---------- карта ---------- */
if (typeof maplibregl.supported === 'function' && !maplibregl.supported()) {
  document.getElementById('map').innerHTML = '<div class="empty">Ваш браузер не поддерживает 3D-карту (WebGL). Обновите браузер или откройте Точку в Chrome.</div>';
}
const saved = store.get(VIEW_KEY, null);
const mobileMap = matchMedia('(max-width: 760px)').matches;
const map = new maplibregl.Map({
  container: 'map',
  style: DARK ? STYLE_DARK : STYLE_LIGHT,
  center: saved ? [saved.lng, saved.lat] : [37.6173, 55.7558],
  zoom: mobileMap ? Math.min(saved?.zoom ?? 11.5, 13) : saved ? saved.zoom : 14,
  pitch: mobileMap ? 0 : saved ? saved.pitch : 52,
  bearing: mobileMap ? 0 : saved ? saved.bearing : -14,
  maxPitch: 65,
  attributionControl: { compact: true }
});
let styleLoaded = false, triedFallback = false;
map.on('error', e => {
  if (!styleLoaded && DARK && !triedFallback) { triedFallback = true; map.setStyle(STYLE_LIGHT, { diff: false }); return; }
  if (!styleLoaded) setStatus('Не удалось загрузить карту. Проверьте интернет.');
  console.warn(e && e.error);
});

// Иконки категорий: контуры 24×24 — и для меток на карте (canvas, Path2D), и для фильтров и карточек (SVG)
const CAT_ICONS = {
  "barber": "M9 17a3 3 0 1 1-6 0 3 3 0 1 1 6 0ZM21 17a3 3 0 1 1-6 0 3 3 0 1 1 6 0ZM8 15 18 3M16 15 6 3",
  "beauty": "M4 8a5 5 0 1 0 10 0 5 5 0 1 0-10 0ZM14 5l7 1v4l-7 1M8 13l-1 8h4l1-8M5 8h3",
  "nails": "M9 3h6v5H9zM7 11a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2zM10 12v5M9 5h6",
  "brows": "M3 13c4-6 14-6 18 0-4 6-14 6-18 0ZM15 13a3 3 0 1 1-6 0 3 3 0 1 1 6 0ZM6 8 4 5M12 6V3M18 8l2-3",
  "tattoo": "m12 2 2.8 6.2L22 9l-5.3 4.8 1.5 7.2-6.2-3.6L5.8 21l1.5-7.2L2 9l7.2-.8zM12 7v6l4 3",
  "spa": "M12 21C5 20 2 16 3 10c5 0 8 4 9 9 1-5 4-9 9-9 1 6-2 10-9 11ZM12 15c-4-4-3-8 0-12 3 4 4 8 0 12Z",
  "pet": "M9 13c-2 1-5 3-5 5 0 3 3 3 5 2 2-1 4-1 6 0 2 1 5 1 5-2 0-2-3-4-5-5-2-1-4-1-6 0ZM7 8a2 3 0 1 1-4 0 2 3 0 1 1 4 0ZM12 5a2 3 0 1 1-4 0 2 3 0 1 1 4 0ZM17 5a2 3 0 1 1-4 0 2 3 0 1 1 4 0ZM22 8a2 3 0 1 1-4 0 2 3 0 1 1 4 0Z",
  "flowers": "M12 13c-5 0-7-4-7-8l4 2 3-5 3 5 4-2c0 4-2 8-7 8ZM12 13v9M12 19c-4 0-6-2-7-5 4 0 6 2 7 5ZM12 21c4-1 6-3 7-6-4 0-6 2-7 6Z",
  "cafe": "M4 8h12v7a6 6 0 0 1-12 0zM16 9h2a3 3 0 0 1 0 6h-2M3 22h15M7 5c-2-1 2-2 0-3M12 5c-2-1 2-2 0-3",
  "bakery": "M4 10c-4-5 5-9 8-6 3-3 12 1 8 6l-2 2v8H6v-8zM9 9l1 3M14 8l1 3M6 17h12",
  "restaurant": "M5 3v6a3 3 0 0 0 6 0V3M8 3v18M16 12h4V3c-4 2-4 6-4 9ZM20 12v9",
  "vet": "M10 3h4v6h6v4h-6v7h-4v-7H4V9h6z"
};
const catIcon = (k, cls = 'ci') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${CAT_ICONS[k] || CAT_ICONS.beauty}"/></svg>`;

// 3D-метки: булавка с мягким объёмом (свет сверху-слева), тенью на «земле» и белой иконкой категории внутри.
// Без глянцевых бликов — как метки в приложениях карт. Рисуется на canvas в двойном разрешении.
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function pinImage(color, big, cat) {
  const s = big ? 1.3 : 1, W = Math.round(60 * s), H = Math.round(82 * s);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d'); x.scale(s, s);
  // тень на «земле»: размытый овал под остриём
  const g0 = x.createRadialGradient(30, 76, 1, 30, 76, 15);
  g0.addColorStop(0, 'rgba(17,24,39,.32)'); g0.addColorStop(1, 'rgba(17,24,39,0)');
  x.fillStyle = g0; x.beginPath(); x.ellipse(30, 76, 15, 4.5, 0, 0, Math.PI * 2); x.fill();
  // тело: капля, объём — радиальным светом и тёмным низом
  const body = () => { x.beginPath(); x.moveTo(30, 73); x.bezierCurveTo(24, 61, 7, 50, 7, 30); x.arc(30, 30, 23, Math.PI, 0); x.bezierCurveTo(53, 50, 36, 61, 30, 73); x.closePath(); };
  body();
  const g1 = x.createRadialGradient(22, 18, 2, 30, 34, 40);
  g1.addColorStop(0, shade(color, 0.22)); g1.addColorStop(0.6, color); g1.addColorStop(1, shade(color, -0.3));
  x.fillStyle = g1; x.fill();
  x.lineWidth = 2.5; x.strokeStyle = '#fff'; x.stroke();
  // «бортик» вокруг иконки — лёгкая вдавленность
  x.beginPath(); x.arc(30, 30, 15.5, 0, Math.PI * 2); x.fillStyle = shade(color, -0.12); x.fill();
  // иконка категории
  x.save(); x.translate(30 - 12 * 1.05, 30 - 12 * 1.05); x.scale(1.05, 1.05);
  x.strokeStyle = '#fff'; x.lineWidth = 2; x.lineCap = 'round'; x.lineJoin = 'round';
  x.stroke(new Path2D(CAT_ICONS[cat] || CAT_ICONS.beauty));
  x.restore();
  return { width: W, height: H, data: x.getImageData(0, 0, W, H).data };
}
// выбранная метка подпрыгивает: поднимается и мягко опускается
let bounceRaf = 0;
function bounceSelected() {
  if (REDUCE || !map.getLayer('selected')) return;
  cancelAnimationFrame(bounceRaf);
  const t0 = performance.now(), dur = 520;
  const step = now => {
    const t = Math.min(1, (now - t0) / dur);
    const y = -Math.sin(t * Math.PI) * 14 * (1 - t * 0.35);
    try { map.setLayoutProperty('selected', 'icon-offset', [0, y]); } catch { return; }
    if (t < 1) bounceRaf = requestAnimationFrame(step);
  };
  bounceRaf = requestAnimationFrame(step);
}

const PIN_LAYERS = ['clusters', 'points', 'selected'];
function setupLayers() {
  styleLoaded = true;
  for (const [k, v] of Object.entries(CATS)) {
    if (!map.hasImage('pin-' + k)) map.addImage('pin-' + k, pinImage(v.color, false, k), { pixelRatio: 2 });
    if (!map.hasImage('pinb-' + k)) map.addImage('pinb-' + k, pinImage(v.color, true, k), { pixelRatio: 2 });
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
        'circle-color': DARK ? '#5B9BF0' : '#1E6FD9',
        'circle-radius': ['step', ['get', 'point_count'], 16, 20, 20, 60, 25],
        'circle-stroke-width': 3, 'circle-stroke-color': DARK ? '#202327' : '#FFFFFF',
        'circle-pitch-alignment': 'map'
      }
    });
    map.addLayer({
      id: 'cluster-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true },
      paint: { 'text-color': DARK ? '#0B1424' : '#FFFFFF' }
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
  document.documentElement.dataset.palette=mode==='navy'?'navy':'';
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
function resizeMapViewport() {
  if (!map || !map.getContainer().isConnected) return;
  requestAnimationFrame(() => map.resize());
  setTimeout(() => map.resize(), 180);
}
map.on('load', () => { loadView(); updateCity(); drawList(); measureDrawer(); setSnap(snap, false); movePill(); resizeMapViewport(); });
addEventListener('pageshow', resizeMapViewport);
addEventListener('orientationchange', resizeMapViewport);
document.addEventListener('visibilitychange', () => { if (!document.hidden) resizeMapViewport(); });

const geo = list => ({
  type: 'FeatureCollection',
  features: list.map(p => ({ type: 'Feature', properties: { id: p.id, cat: p.cat, name: p.name }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }))
});
function pushData() {
  const s = map.getSource('places'); if (!s) return;
  const b = map.getBounds(), latPad = (b.getNorth() - b.getSouth()) / 2, lonPad = (b.getEast() - b.getWest()) / 2;
  // В MapLibre передаём метки рядом с экраном, а не десятки тысяч точек всего региона.
  s.setData(geo(visible.filter(p => p.lat >= b.getSouth() - latPad && p.lat <= b.getNorth() + latPad
    && p.lon >= b.getWest() - lonPad && p.lon <= b.getEast() + lonPad)));
}
let bouncedId = '';
function markSelected() {
  if (!map.getLayer('selected')) return;
  map.setFilter('selected', ['==', ['get', 'id'], sel || '']);
  if (sel && sel !== bouncedId) { bouncedId = sel; bounceSelected(); }   // прыжок — только при выборе нового места
  if (!sel) bouncedId = '';
}

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
    loadView(); pushData(); drawList(); updateCity(); syncTilt();
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
for (const p of Object.values(favs)) { relockProtectedPlace(p); if (!places.has(p.id)) places.set(p.id, p); }
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
const SOCIAL_HOSTS = /(^|\.)(vk\.com|vk\.ru|vkontakte\.ru|m\.vk\.com|instagram\.com|t\.me|telegram\.me|taplink\.(cc|ws|at|ru)|wa\.me|ok\.ru|youtube\.com|tiktok\.com|facebook\.com|dikidi\.(net|ru|app)|yclients\.com|2gis\.ru|2gis\.biz|clients\.site|business\.site|yandex\.ru|avito\.ru|linktr\.ee|zoon\.ru|flamp\.ru)$/i;   // 2gis.biz, clients.site, business.site — бесплатные визитки 2ГИС, Яндекс Бизнеса и Google, а не свой сайт
function siteKind(p) {
  if (!p.site) return 'none';
  let kind = 'own';
  try {
    const host = new URL(/^[a-z]+:\/\//i.test(p.site) ? p.site : 'https://' + p.site).hostname.replace(/^www\./, '');
    if (SOCIAL_HOSTS.test(host)) kind = 'social';
  } catch { /* странный адрес — считаем своим сайтом */ }
  return p.siteDead && kind === 'own' || p.siteDead && /taplink/i.test(p.site) ? 'none' : kind;   // мёртвым считаем только свой сайт и Taplink
}
const leadCache = new WeakMap();
const LV = { high: 'высокий', mid: 'средний', low: 'низкий' };
function lead(p) {
  let l = leadCache.get(p);
  if (l) return l;
  const kind = siteKind(p), why = [];
  let s = 0;
  if (kind === 'none' && p.site && p.siteDead) { s += 60; why.push('указанный сайт не открывается'); }
  else if (kind === 'none' && p.chk && p.chk.s === 'none') { s += 60; why.push('сайт не нашли и при проверке'); }
  else if (kind === 'none') { s += 55; why.push('сайт не указан в источнике'); }
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

/* ---------- Аккаунт: карта без входа, Pro — 3 дня бесплатно, потом подписка 290 ₽/мес ----------
   Без входа открыта карта, список и фильтры. Контакты, «Написать», шаблоны, блокнот, воронка и экспорт —
   только в Pro: при нажатии на них needPro() показывает вход по почте или оплату.
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
// yookassa: true — показывать оплату СБП/картой (когда ЮKassa одобрит магазин и в Supabase будут функции pay и
// yookassa-webhook, см. ОПЛАТА.md). Оплата переводом через Telegram остаётся в любом случае.
const PLAN = { price: 290, trialDays: 3, tg: 'cunbent', yookassa: false };
const SESSION_KEY = 'tochka-session', ACCT_KEY = 'tochka-acct';
const REFERRAL_KEY = 'tochka-pending-referral';
try {
  const link = new URL(location.href), inviter = link.searchParams.get('ref');
  if (inviter) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inviter)) sessionStorage.setItem(REFERRAL_KEY, inviter);
    link.searchParams.delete('ref');
    history.replaceState(null, '', link.pathname + link.search + link.hash);
  }
} catch { /* ссылка остаётся доступной, даже если хранилище отключено */ }
const authTest = (() => { try { return localStorage.getItem('tochka-auth-test') === '1'; } catch { return false; } })();
const authOn = () => !!(AUTH.url && AUTH.anon && (AUTH.live || authTest));
let session = store.get(SESSION_KEY, null);    // { access_token, refresh_token, expires_at, user: { id, email, created_at } }
let acct = store.get(ACCT_KEY, null);          // { state: 'trial' | 'active' | 'expired', until, email, checked }
let freeContactsLeft = null, freeContactIds = new Set();
const PRIVATE_KEY = 'tochka-admin-private-view';
let privateView = (() => { try { return sessionStorage.getItem(PRIVATE_KEY) === '1'; } catch { return false; } })();
let adminVerified = false;
const privateModeOn = () => privateView && !!session && authOn();
const privateModeMessage = () => toast('Сначала выключите скрытый режим в профиле', 2600);
const privateMask = (kind = 'contact') => `<span class="privacy-mask privacy-mask--${kind}" role="img" aria-label="Скрыто"></span>`;
const isPro = () => !authOn() || !!(session && acct && (acct.admin || (acct.state !== 'expired' && acct.until > Date.now())));
const fmtDate = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
// точная дата со временем: «6 ноября, 14:32»
const fmtDateTime = t => fmtDate(t) + ', ' + new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
// сколько осталось: меньше двух суток — в часах и минутах, иначе в днях
function leftText(t) {
  const ms = Math.max(0, t - Date.now()), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
  if (ms >= 2 * DAY) { const d = daysLeft(t); return `${d} ${plural(d, ['день', 'дня', 'дней'])}`; }
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}
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
async function syncReferral(t) {
  const card = $('#referralCard');
  if (!card || !session) return;
  try {
    const inviter = sessionStorage.getItem(REFERRAL_KEY);
    if (inviter) {
      const accepted = await api('/rest/v1/rpc/tochka_claim_referral', { method: 'POST', body: { inviter }, token: t });
      if (accepted) {
        sessionStorage.removeItem(REFERRAL_KEY);
        toast('Приглашение принято. Друг получит 7 дней Pro.', 3200);
      }
    }
    const stats = await api('/rest/v1/rpc/tochka_referral_stats', { method: 'POST', body: {}, token: t });
    card.hidden = false;
    $('#referralStats').textContent = `Приглашено: ${stats.registered || 0} · оплатили: ${stats.paid || 0} · начислено: ${stats.earned_days || 0} дней`;
  } catch (e) {
    card.hidden = true;
    console.warn('Реферальная программа недоступна:', e.message);
  }
}
function saveSession(d) {
  if (session?.user?.id !== d.user.id) {
    for (const p of places.values()) relockProtectedPlace(p);
    for (const p of Object.values(favs)) relockProtectedPlace(p);
    adminVerified = false; privateView = false;
    try { sessionStorage.removeItem(PRIVATE_KEY); } catch {}
  }
  session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000,
    user: { id: d.user.id, email: d.user.email, created_at: d.user.created_at } };
  store.set(SESSION_KEY, session);
  dispatchEvent(new Event('tochka-auth-changed'));
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
  await syncReferral(t);
  try {
    // дата регистрации и оплаченный срок — с сервера, а не из копии на устройстве
    const rows = await api(`/rest/v1/subscriptions?select=paid_until,created_at&user_id=eq.${session.user.id}`, { token: t });
    const row = (rows && rows[0]) || {};
    const paid = row.paid_until ? Date.parse(row.paid_until) : 0;
    const trialUntil = Date.parse(row.created_at || session.user.created_at) + PLAN.trialDays * DAY;
    const now = Date.now();
    acct = paid > now ? { state: 'active', until: paid } : trialUntil > now ? { state: 'trial', until: trialUntil } : { state: 'expired', until: Math.max(paid, trialUntil) };
    acct.email = session.user.email; acct.checked = now; acct.paid = paid > 0;
    // админ ли это (решает сервер по почте из токена; если функции на сервере нет — просто нет)
    try { acct.admin = (await api('/rest/v1/rpc/tochka_is_admin', { method: 'POST', body: {}, token: t })) === true; } catch { acct.admin = false; }
    adminVerified = acct.admin;
    if (acct.state === 'expired' && !acct.admin) {
      try {
        const [left, ids] = await Promise.all([
          api('/rest/v1/rpc/tochka_free_contacts_remaining', { method: 'POST', body: {}, token: t }),
          api('/rest/v1/rpc/tochka_free_contact_ids', { method: 'POST', body: {}, token: t })
        ]);
        freeContactsLeft = Number.isInteger(left) ? left : null;
        freeContactIds = new Set(Array.isArray(ids) ? ids.map(x => x.place_id) : []);
      } catch { freeContactsLeft = null; freeContactIds.clear(); }
    } else { freeContactsLeft = null; freeContactIds.clear(); }
    if (!adminVerified) { privateView = false; try { sessionStorage.removeItem(PRIVATE_KEY); } catch {} }
    store.set(ACCT_KEY, acct);
  } catch (e) { console.warn('Статус подписки не обновился:', e.message); }   // без сети — живём по последнему известному статусу
  applyAccess();
}
// контакты заведений из своей базы: сервер отдаёт их только с Pro (supabase/protect_contacts.sql)
const contactsLoading = new Map();
function withContacts(p) {
  if (!p.locked) return Promise.resolve(p);
  if (!contactsLoading.has(p.id)) contactsLoading.set(p.id, (async () => {
    const free = authOn() && !isPro() && !!session;
    const rows = free
      ? await api('/rest/v1/rpc/tochka_reveal_free_contact', { method: 'POST', body: { p_place_id: p.id }, token: await token() })
      : await api(`/rest/v1/place_contacts?select=phone,email,tg,vk,inst&id=eq.${encodeURIComponent(p.id)}`, { token: await token() });
    if (!rows || !rows[0]) throw new Error('NO_ACCESS');   // строка есть у каждого «*», пусто — сервер не дал доступ
    if (!p.serverContactsBeforeReveal) p.serverContactsBeforeReveal = Object.fromEntries(['phone', 'email', 'tg', 'vk', 'inst'].map(k => [k, p[k]]));
    if (free) {
      p.freeRevealedFor = session.user.id;
      if (!freeContactIds.has(p.id)) { freeContactIds.add(p.id); freeContactsLeft = Math.max(0, (freeContactsLeft ?? 1) - 1); }
    }
    for (const k of ['phone', 'email', 'tg', 'vk', 'inst']) p[k] = rows[0][k] || '';
    p.email = cleanPlaceEmail(p.email);
    delete p.locked;
    return p;
  })().finally(() => contactsLoading.delete(p.id)));
  return contactsLoading.get(p.id);
}
function contactsError(e) {
  if (/FREE_CONTACT_LIMIT/.test(e.message)) { freeContactsLeft = 0; toast('Три бесплатных контакта использованы. Для новых нужна подписка.', 4000); if (sel) select(sel, false, true); }
  else if (/NO_ACCESS/.test(e.message)) { loadStatus(); toast('Нет доступа к контактам — проверьте подписку', 3000); }
  else toast('Не удалось загрузить контакты. Проверьте интернет.', 3000);
}
function signOut(silent) {
  dispatchEvent(new CustomEvent('tochka-sign-out', { detail: { token: session?.access_token } }));
  for (const p of places.values()) relockProtectedPlace(p);
  for (const p of Object.values(favs)) relockProtectedPlace(p);
  session = null; acct = null; freeContactsLeft = null; freeContactIds.clear(); store.set(SESSION_KEY, null); store.set(ACCT_KEY, null);
  $('#referralCard').hidden = true;
  adminVerified = false; privateView = false; try { sessionStorage.removeItem(PRIVATE_KEY); } catch {}
  closePro(); closeAdmin(); admRows = []; applyAccess();
  if (!silent) toast('Вы вышли из аккаунта');
}
// оплата переводом: человек пишет в Telegram, продавец продлевает подписку в админ-панели («+1 мес»)
function orderText() {
  return `Здравствуйте! Хочу оплатить Точку Pro на месяц — ${PLAN.price} ₽. Почта аккаунта: ${session ? session.user.email : '—'}`;
}
const tgPayHow = () => PLAN.yookassa
  ? `Удобнее переводом? Откроется чат @${PLAN.tg}, текст уже скопирован — вставьте и отправьте:`
  : `Откроется чат @${PLAN.tg}, текст уже скопирован — вставьте и отправьте:`;
// оплата через ЮKassa: сервер (supabase/functions/pay) создаёт платёж и даёт ссылку на страницу оплаты,
// а месяц к подписке прибавляет supabase/functions/yookassa-webhook, когда ЮKassa подтвердит оплату
async function startPay(btn) {
  btn.disabled = true;
  try {
    const { url } = await api('/functions/v1/pay', { method: 'POST', body: {}, token: await token() });
    store.set('tochka-pay-from', acct && acct.state === 'active' ? acct.until : 0);   // срок до оплаты — чтобы потом понять, что она пришла
    location.href = url;
  } catch (e) {
    btn.disabled = false;
    toast(/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Нет связи с сервером. Проверьте интернет.' : 'Не получилось начать оплату: ' + e.message, 3600);
  }
}
// вернулись со страницы оплаты (…?paid=1): уведомление от ЮKassa приходит не сразу — несколько раз спрашиваем статус
async function afterPay() {
  toast('Проверяю оплату…', 2000);
  const from = store.get('tochka-pay-from', 0) || 0;
  for (let i = 0; i < 6; i++) {
    await loadStatus();
    if (acct && acct.state === 'active' && acct.until > from) return toast(`Спасибо! Подписка активна до ${fmtDate(acct.until)}`, 3600);
    await new Promise(r => setTimeout(r, 5000));
  }
  toast('Оплата ещё не пришла. Если деньги списались — нажмите «Обновить статус» через пару минут.', 5000);
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
    $('#gBuy').hidden = !PLAN.yookassa;
    $('#gBuy').textContent = `Оплатить ${PLAN.price} ₽ — СБП или картой`;
    $('#gTgBuy').classList.toggle('pri', !PLAN.yookassa);   // без ЮKassa Telegram — главная кнопка
    $('#gTgBuy').href = `https://t.me/${PLAN.tg}`;
    $('#gHow').textContent = tgPayHow();
    $('#gOrder').textContent = orderText();
  }
  if (step === 'email') {
    $('#gTrial').textContent = `${PLAN.trialDays} ${plural(PLAN.trialDays, ['день', 'дня', 'дней'])} бесплатно`;
    setTimeout(() => $('#gMail').focus(), 60);
  }
  if (step === 'code') setTimeout(() => $('#gOtp').focus(), 60);
}
function hideGate() { $('#gate').hidden = true; gateStep = ''; document.body.classList.remove('gated'); }
$('#gX').onclick = hideGate;
$('#gate').addEventListener('click', e => { if (e.target.id === 'gate') hideGate(); });
// окно входа/оплаты само не открывается — только из needPro(); здесь лишь закрываем его или ведём дальше
const PRO_TOUR_KEY = 'tochka-pro-tour-v1';
const PRO_TOUR = [
  ['Найди подходящие заведения', 'Включи фильтр «Предположительно без сайта», чтобы оставить на карте подходящих клиентов.'],
  ['Выбери клиента', 'Открой салон с высокой оценкой потенциала — Точка подскажет, кому особенно нужен сайт.'],
  ['Напиши ему', 'В карточке нажми «Написать»: выбери шаблон, скопируй сообщение и свяжись с клиентом.']
];
let proTourStep = 0, proTourOpen = false;
function renderProTour() {
  const [title, text] = PRO_TOUR[proTourStep];
  $('#proTourStep').textContent = `Шаг ${proTourStep + 1} из ${PRO_TOUR.length}`;
  $('#proTourTitle').textContent = title;
  $('#proTourText').textContent = text;
  $('#proTourBack').hidden = proTourStep === 0;
  $('#proTourNext').textContent = proTourStep === PRO_TOUR.length - 1 ? 'Начать' : 'Дальше';
}
function closeProTour() {
  $('#proTour').hidden = true;
  proTourOpen = false;
  store.set(PRO_TOUR_KEY, true);
}
function startProTour() {
  if (proTourOpen || store.get(PRO_TOUR_KEY, false) || !authOn() || !session || !isPro()) return;
  proTourOpen = true; proTourStep = 0; renderProTour(); $('#proTour').hidden = false;
}
$('#proTourX').onclick = closeProTour;
$('#proTourSkip').onclick = closeProTour;
$('#proTourBack').onclick = () => { proTourStep = Math.max(0, proTourStep - 1); renderProTour(); };
$('#proTourNext').onclick = () => {
  if (proTourStep < PRO_TOUR.length - 1) { proTourStep++; renderProTour(); }
  else closeProTour();
};
$('#proTour').addEventListener('click', e => { if (e.target.id === 'proTour') closeProTour(); });
let wasPro = isPro();
const privateIndicator = document.createElement('button');
privateIndicator.id = 'privateIndicator'; privateIndicator.type = 'button';
privateIndicator.className = 'workspace-icon workspace-privacy';
privateIndicator.setAttribute('aria-label', 'Контакты скрыты — выключить скрытый режим');
privateIndicator.title = 'Контакты скрыты — нажмите, чтобы показать';
privateIndicator.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l18 18M9.9 5.3A10.6 10.6 0 0 1 12 5c5.2 0 9 7 9 7a17 17 0 0 1-3.1 3.7M6.1 6.1C3.9 8 3 12 3 12s3.8 7 9 7c1.2 0 2.3-.4 3.4-1"/><path d="M10.2 10.2a2.6 2.6 0 0 0 3.6 3.6"/></svg>';
$('.workspace-actions').prepend(privateIndicator);
function syncPrivateMode() {
  if (!session && privateView) { privateView = false; try { sessionStorage.removeItem(PRIVATE_KEY); } catch {} }
  const on = privateModeOn();
  const changed = document.documentElement.classList.contains('admin-private-view') !== on;
  document.documentElement.classList.toggle('admin-private-view', on);
  $('#privateModeRow').hidden = !adminVerified;
  $('#swPrivate').setAttribute('aria-checked', on);
  privateIndicator.hidden = !on;
  for (const id of ['#export', '#copyall', '#draftEmails', '#pExport', '#pBackup', '#pRestore', '#pTpl', '#nf', '#addp']) $(id).hidden = on;
  $('#pAdm').hidden = on || !adminVerified;
  if (changed) try { drawList(); drawNotes(); if (sel) select(sel, false, true); if (current === 'v-prof') renderProfile(); } catch { /* первый запуск ещё не завершён */ }
}
function setPrivateMode(on) {
  if (on && (!adminVerified || !session || !authOn())) return;
  privateView = on;
  try { if (on) sessionStorage.setItem(PRIVATE_KEY, '1'); else sessionStorage.removeItem(PRIVATE_KEY); } catch {}
  if (on) { closeMsg(); closeAdd(); stopAdd(); closeAdmin(); closePro(); }
  syncPrivateMode();
  toast(on ? 'Контакты скрыты только на вашем экране' : 'Контакты снова видны', 2800);
}
$('#swPrivate').onclick = () => setPrivateMode(!privateModeOn());
privateIndicator.onclick = () => setPrivateMode(false);
function updateDraftEmailsAccess() {
  const button = $('#draftEmails');
  if (!button) return;
  button.textContent = isPro() ? 'Подготовить 10 писем' : '🔒 Подготовить письма · Pro';
  button.title = isPro() ? 'Подготовить до 10 персональных черновиков' : 'Доступно с Точкой Pro';
}
function applyAccess() {
  if (wasPro && !isPro()) { for (const p of places.values()) relockProtectedPlace(p); for (const p of Object.values(favs)) relockProtectedPlace(p); }
  document.documentElement.classList.toggle('is-pro', authOn() && isPro());
  updateDraftEmailsAccess();
  syncPrivateMode();
  if (!authOn() || isPro()) hideGate();
  else if (session && gateStep) showGate('pay');   // вошёл, но пробный период уже закончился
  try { if (current === 'v-crm') renderCrm(); if (current === 'v-prof') renderProfile(); } catch { /* вкладки ещё не готовы — при запуске */ }
  // доступ изменился — открыть или спрятать контакты в открытой карточке
  if (wasPro !== isPro()) { wasPro = isPro(); try { if (sel) select(sel); } catch { /* карта ещё не готова */ } }
  else try { if (sel) select(sel, false, true); } catch { /* карта ещё не готова */ }
  if (authOn() && session && isPro()) setTimeout(startProTour, 500);
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
$('#gBuy').onclick = () => startPay($('#gBuy'));
$('#gTgBuy').addEventListener('click', () => copy(orderText(), 'Текст скопирован — вставьте его в чат'));
$('#gCheck').onclick = async () => {
  $('#gMsg3').textContent = 'Проверяю оплату…';
  await loadStatus();
  $('#gMsg3').textContent = isPro() ? '' : 'Оплата ещё не отмечена. Обычно это занимает несколько минут после перевода — проверьте позже.';
  if (isPro()) toast(`Спасибо! Подписка активна до ${fmtDate(acct.until)}`, 3000);
};
$('#gOut').onclick = () => signOut();

/* окно «Подписка» из профиля */
function needPro() { if (isPro()) return false; showGate(session ? 'pay' : 'email'); return true; }
function openPro() {
  if (authOn() && !session) return showGate('email');
  const box = $('#accBox'), acts = $('#accActs');
  if (!authOn()) {
    box.innerHTML = `<b>Бета-версия</b><span class="small">Сейчас всё в Точке бесплатно. Скоро появится вход по почте: ${PLAN.trialDays} ${plural(PLAN.trialDays, ['день', 'дня', 'дней'])} бесплатно, дальше ${PLAN.price} ₽ в месяц.</span>`;
    acts.innerHTML = '';
  } else {
    const st = acct && acct.state;
    const trialFrom = acct && acct.state === 'trial' ? acct.until - PLAN.trialDays * DAY : 0;
    box.innerHTML = `<b>${st === 'active' ? `Pro активен до ${fmtDateTime(acct.until)}` : st === 'trial' ? `Пробный период до ${fmtDateTime(acct.until)}` : 'Подписки нет'}</b>
      ${st === 'active' || st === 'trial' ? `<span class="small">Осталось: ${leftText(acct.until)}${trialFrom ? ` · выдан ${fmtDateTime(trialFrom)}` : ''}</span>` : ''}
      <span class="small">Аккаунт: ${privateModeOn() ? privateMask('email') : esc(session ? session.user.email : '')}. Подписка работает на всех устройствах — войдите с этой почтой на телефоне и на компьютере.</span>
      <span class="small">Продление: ${PLAN.price} ₽ в месяц${PLAN.yookassa ? ' — через СБП, картой или переводом в Telegram' : `, оплата в Telegram @${PLAN.tg}`}. Оплаченный месяц прибавляется к текущему сроку.</span>`;
    const verb = st === 'active' ? 'Продлить' : 'Оплатить';
    acts.innerHTML = `${PLAN.yookassa ? `<button class="btn pri" type="button" id="accBuy">${verb} ${PLAN.price} ₽</button>` : ''}
      <a class="btn${PLAN.yookassa ? '' : ' pri'}" id="accTg" href="https://t.me/${PLAN.tg}" target="_blank" rel="noopener">${verb} в Telegram</a>
      <button class="btn" type="button" id="accCheck">Обновить статус</button><button class="btn" type="button" id="accOut">Выйти</button>`;
    if (PLAN.yookassa) $('#accBuy').onclick = () => startPay($('#accBuy'));
    $('#accTg').addEventListener('click', () => copy(orderText(), 'Текст скопирован — вставьте его в чат'));
    $('#accCheck').onclick = async () => { await loadStatus(); openPro(); toast('Статус обновлён'); };
    $('#accOut').onclick = () => signOut();
  }
  $('#pro').hidden = false;
}
function closePro() { $('#pro').hidden = true; }

/* админ-панель: все аккаунты, статусы, продление. Данные отдаёт только сервер и только админу. */
let admRows = [], admFilter = 'all', admArm = '';
const admState = r => {
  const now = Date.now(), paid = r.paid_until ? Date.parse(r.paid_until) : 0, trial = Date.parse(r.created_at) + PLAN.trialDays * DAY;
  return paid > now ? { k: 'paid', t: `Pro · до ${fmtDateTime(paid)}` } : trial > now ? { k: 'trial', t: `Пробный · до ${fmtDateTime(trial)}` } : { k: 'off', t: paid ? `Не продлил · Pro был до ${fmtDateTime(paid)}` : 'Пробный закончился' };
};
// точные даты для строки пользователя: когда выдан пробный и до какого времени, до какого времени Pro
const admDates = r => {
  const reg = Date.parse(r.created_at), trialEnd = reg + PLAN.trialDays * DAY;
  return `Пробный: выдан ${fmtDateTime(reg)}, до ${fmtDateTime(trialEnd)}` + (r.paid_until ? `<br>Pro: до ${fmtDateTime(Date.parse(r.paid_until))}` : '');
};
const ago = t => { if (!t) return 'не входил'; const d = Math.floor((Date.now() - Date.parse(t)) / DAY); return d <= 0 ? 'сегодня' : d === 1 ? 'вчера' : `${d} ${plural(d, ['день', 'дня', 'дней'])} назад`; };
async function loadAdmin() {
  $('#admList').innerHTML = '<p class="small">Загружаю…</p>';
  loadAdmReviews();
  try {
    const t = await token();
    admRows = (await api('/rest/v1/rpc/admin_users', { method: 'POST', body: {}, token: t })) || [];
    drawAdmin();
  } catch (e) {
    $('#admStats').innerHTML = '';
    $('#admList').innerHTML = `<p class="small">${/NOT_ADMIN/.test(e.message) ? 'Нет прав администратора.' : /Could not find|404/.test(e.message + e.status) ? 'На сервере ещё не установлена админ-панель: запустите admin_setup.sql в Supabase.' : 'Не получилось загрузить: ' + esc(e.message)}</p>`;
  }
}
function drawAdmin() {
  const now = Date.now(), week = now - 7 * DAY;
  const st = admRows.map(r => ({ r, s: admState(r) }));
  const n = k => st.filter(x => x.s.k === k).length;
  const fresh = admRows.filter(r => Date.parse(r.created_at) > week).length;
  const active = admRows.filter(r => r.last_sign_in_at && Date.parse(r.last_sign_in_at) > week).length;
  const tiles = [['Всего', admRows.length], ['Платят', n('paid')], ['Пробный', n('trial')], ['Доход в месяц', (n('paid') * PLAN.price).toLocaleString('ru-RU') + ' ₽'], ['Новые за 7 дней', fresh], ['Заходили за 7 дней', active]];
  $('#admStats').innerHTML = tiles.map(([l, v]) => `<div class="adm-tile"><b>${v}</b><span>${l}</span></div>`).join('');
  const q = norm($('#admQ').value.trim());
  const list = st.filter(x => (admFilter === 'all' || x.s.k === admFilter) && (!q || norm(x.r.email).includes(q)));
  $('#admList').innerHTML = list.length ? list.map(({ r, s }) => `<div class="adm-row">
      <div class="adm-main"><b>${esc(r.email)}</b><span class="adm-st st-${s.k}">${s.t}</span>
      <span class="small">${admDates(r)}</span>
      <span class="small">Последний вход: ${ago(r.last_sign_in_at)}</span></div>
      <div class="adm-acts"><button class="btn" type="button" data-ext="${r.user_id}" data-d="1">+1 день</button><button class="btn" type="button" data-ext="${r.user_id}" data-d="7">+7 дней</button><button class="btn" type="button" data-ext="${r.user_id}" data-m="1">+1 мес</button><button class="btn pri" type="button" data-ext="${r.user_id}" data-manual-paid="1" title="После получения перевода: продлить Pro и начислить бонус пригласившему">${admArm === 'paid:' + r.user_id ? 'Оплата получена?' : 'Оплата +1 мес'}</button>${s.k === 'paid' ? `<button class="btn" type="button" data-ext="${r.user_id}" data-m="0">${admArm === r.user_id ? 'Точно?' : 'Отключить'}</button>` : ''}</div>
    </div>`).join('') : `<p class="small">${admRows.length ? 'Ничего не найдено' : 'Пока никто не зарегистрировался'}</p>`;
}
function openAdmin() { $('#adm').hidden = false; admArm = ''; loadAdmin(); }
function closeAdmin() { $('#adm').hidden = true; }
$('#admx').onclick = closeAdmin;
$('#adm').addEventListener('click', async e => {
  if (e.target.id === 'adm') return closeAdmin();
  const f = e.target.closest('[data-f]');
  if (f) { admFilter = f.dataset.f; document.querySelectorAll('#admF [data-f]').forEach(b => b.setAttribute('aria-pressed', b === f)); return drawAdmin(); }
  const rv = e.target.closest('[data-rv]');
  if (rv) return moderateReview(rv);
  const b = e.target.closest('[data-ext]');
  if (!b) return;
  const id = b.dataset.ext, days = +b.dataset.d || 0, months = +b.dataset.m;
  if (!days && months === 0 && admArm !== id) { admArm = id; return drawAdmin(); }   // отключение — со второго нажатия
  if (b.dataset.manualPaid && admArm !== 'paid:' + id) { admArm = 'paid:' + id; return drawAdmin(); }
  admArm = ''; b.disabled = true;
  try {
    // дни — supabase/admin_extend_days.sql, месяцы и отключение — admin_extend
    const until = b.dataset.manualPaid
      ? await api('/rest/v1/rpc/tochka_admin_paid_month', { method: 'POST', body: { target: id }, token: await token() })
      : days
        ? await api('/rest/v1/rpc/admin_extend_days', { method: 'POST', body: { target: id, days }, token: await token() })
        : await api('/rest/v1/rpc/admin_extend', { method: 'POST', body: { target: id, months }, token: await token() });
    const row = admRows.find(r => r.user_id === id); if (row) row.paid_until = until;
    drawAdmin();
    toast(days || months || b.dataset.manualPaid ? `Pro продлён до ${fmtDateTime(Date.parse(until))}` : 'Подписка отключена', 2600);
    if (session && id === session.user.id) loadStatus();
  } catch (err) {
    b.disabled = false;
    toast(/admin_extend_days|Could not find/.test(err.message) ? 'Сначала запустите supabase/admin_extend_days.sql в Supabase' : 'Не получилось: ' + err.message, 3600);
  }
});
/* отзывы (supabase/reviews.sql): одобренные видны всем, свой пишет вошедший, одобряет админ */
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const reviewHtml = r => `<div class="rv-item"><div class="rv-h"><b>${esc(r.name)}</b><span class="rv-st" aria-label="Оценка ${r.rating} из 5">${stars(r.rating)}</span></div>
  <p>${esc(r.body)}</p><span class="small">${fmtDate(Date.parse(r.created_at))}</span></div>`;
let rvRating = 5, rvMine = null;
function drawStars() {
  $('#rvStars').innerHTML = [1, 2, 3, 4, 5].map(i => `<button type="button" role="radio" data-r="${i}" aria-checked="${i === rvRating}" aria-label="${i} из 5"${i <= rvRating ? ' class="on"' : ''}>★</button>`).join('');
}
$('#rvStars').onclick = e => { const b = e.target.closest('[data-r]'); if (b) { rvRating = +b.dataset.r; drawStars(); } };
async function openReviews() {
  $('#rv').hidden = false; $('#rvMsg').textContent = ''; $('#rvSum').innerHTML = '';
  $('#rvList').innerHTML = '<p class="small">Загружаю…</p>';
  const t = authOn() && session ? await token() : null;
  $('#rvForm').hidden = !t; $('#rvLogin').hidden = !!t || !authOn();
  try {
    const list = await api('/rest/v1/reviews?select=name,rating,body,created_at&approved=eq.true&order=created_at.desc&limit=50');
    const avg = list.length ? list.reduce((s, r) => s + r.rating, 0) / list.length : 0;
    if (list.length) $('#rvSum').innerHTML = `<b>${avg.toFixed(1).replace('.', ',')}</b><span class="rv-st">${stars(Math.round(avg))}</span><span class="small">${list.length} ${plural(list.length, ['отзыв', 'отзыва', 'отзывов'])}</span>`;
    $('#rvList').innerHTML = list.length ? list.map(reviewHtml).join('') : '<p class="small">Пока отзывов нет. Попробуйте Точку и станьте первым!</p>';
    if (t) {
      rvMine = (await api(`/rest/v1/reviews?select=name,rating,body,approved&user_id=eq.${session.user.id}`, { token: t }))[0] || null;
      rvRating = rvMine ? rvMine.rating : 5; drawStars();
      $('#rvName').value = rvMine ? rvMine.name : ''; $('#rvBody').value = rvMine ? rvMine.body : '';
      $('#rvFormTitle').textContent = rvMine ? 'Ваш отзыв' : 'Оставить отзыв';
      $('#rvState').textContent = !rvMine ? 'Отзыв появится на сайте после проверки.' : rvMine.approved ? 'Опубликован. Если измените — он снова уйдёт на проверку.' : 'На проверке — скоро появится на сайте.';
      $('#rvSend').textContent = rvMine ? 'Сохранить и отправить на проверку' : 'Отправить на проверку';
    }
  } catch (e) {
    $('#rvForm').hidden = true; $('#rvLogin').hidden = true;
    $('#rvList').innerHTML = `<p class="small">${/reviews|42P01|PGRST/.test(e.message + e.code) ? 'Отзывы скоро появятся.' : 'Не получилось загрузить отзывы. Проверьте интернет.'}</p>`;
  }
}
function closeReviews() { $('#rv').hidden = true; }
$('#rvx').onclick = closeReviews;
$('#rv').addEventListener('click', e => { if (e.target.id === 'rv') closeReviews(); });
$('#rvSignIn').onclick = () => { closeReviews(); showGate('email'); };
$('#rvForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#rvName').value.trim(), body = $('#rvBody').value.trim(), msg = $('#rvMsg');
  if (name.length < 2) { msg.textContent = 'Напишите, как вас подписать.'; return $('#rvName').focus(); }
  if (body.length < 10) { msg.textContent = 'Напишите хотя бы пару слов — от 10 букв.'; return $('#rvBody').focus(); }
  $('#rvSend').disabled = true; msg.textContent = 'Отправляю…';
  try {
    const t = await token();
    if (rvMine) await api(`/rest/v1/reviews?user_id=eq.${session.user.id}`, { method: 'PATCH', body: { name, rating: rvRating, body, approved: false }, token: t });
    else await api('/rest/v1/reviews', { method: 'POST', body: { name, rating: rvRating, body }, token: t });
    msg.textContent = '';
    toast('Спасибо за отзыв! Он появится после проверки', 3200);
    openReviews();
  } catch (err) { msg.textContent = 'Не получилось отправить: ' + err.message; }
  finally { $('#rvSend').disabled = false; }
});
// админ: отзывы на проверке — одобрить или удалить
async function loadAdmReviews() {
  try {
    const rows = await api('/rest/v1/reviews?select=id,name,rating,body,created_at&approved=eq.false&order=created_at', { token: await token() });
    $('#admRev').innerHTML = rows.length ? `<h4>Отзывы на проверке: ${rows.length}</h4>` + rows.map(r => `<div class="adm-row">${reviewHtml(r)}
      <div class="adm-acts"><button class="btn pri" type="button" data-rv="ok" data-id="${r.id}">Одобрить</button><button class="btn" type="button" data-rv="del" data-id="${r.id}">Удалить</button></div></div>`).join('') : '';
  } catch { $('#admRev').innerHTML = ''; }   // таблицы отзывов ещё нет — просто не показываем
}
async function moderateReview(b) {
  b.disabled = true;
  try {
    const path = `/rest/v1/reviews?id=eq.${+b.dataset.id}`, t = await token();
    if (b.dataset.rv === 'ok') await api(path, { method: 'PATCH', body: { approved: true }, token: t });
    else await api(path, { method: 'DELETE', token: t });
    toast(b.dataset.rv === 'ok' ? 'Отзыв опубликован' : 'Отзыв удалён');
    loadAdmReviews();
  } catch (err) { b.disabled = false; toast('Не получилось: ' + err.message, 3000); }
}
$('#admQ').addEventListener('input', drawAdmin);
$('#admRefresh').onclick = loadAdmin;
$('#admCopy').onclick = () => copy(admRows.map(r => r.email).join('\n'), `Скопировано почт: ${admRows.length}`);
$('#prox').onclick = closePro;
$('#pro').addEventListener('click', e => { if (e.target.id === 'pro') closePro(); });

// при запуске и потом время от времени сверяемся с сервером
applyAccess();
const backFromPay = new URLSearchParams(location.search).has('paid');
if (backFromPay) history.replaceState(null, '', location.pathname + location.hash);
if (authOn()) {
  if (backFromPay && session) afterPay();
  else loadStatus().then(() => {
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
  // color — ключ категории (тогда иконка категории её цветом) или обычный цвет точки
  b.innerHTML = (CATS[color] ? `<span class="cico" style="color:${CATS[color].color}">${catIcon(color)}</span>`
    : color ? `<span class="dot" style="background:${color}"></span>` : '') + esc(label);
  b.onclick = () => onclick(b); chips.appendChild(b); return b;
}
const catChips = [];
const pickCat = k => b => { cat = k; catChips.forEach(x => x.setAttribute('aria-pressed', x === b)); applyFilter(); };
catChips.push(chip('Все', null, true, pickCat('all')));
for (const [k, v] of Object.entries(CATS)) catChips.push(chip(v.name, k, false, pickCat(k)));
const sep = document.createElement('span'); sep.className = 'chip-sep'; chips.appendChild(sep);
chip('Предположительно без сайта', null, false, b => { noSite = !noSite; b.setAttribute('aria-pressed', noSite); applyFilter(); }, 'nosite');
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
    <span class="ic" style="--c:${CATS[p.cat].color}">${catIcon(p.cat)}</span>
    <span><div class="nm">${isFav(p.id) ? '<span class="favmark">★</span> ' : ''}${esc(p.name)}</div>
    <div class="sub">${esc(CATS[p.cat].name)}${p.addr ? ' · ' + (privateModeOn() ? privateMask('address') : esc(p.addr)) : ''} · ${fmtDist(d)}</div>
    <div class="meta-line">${lvPill(l)}${l.kind === 'none' ? '<span class="flag">Предположительно без сайта</span>' : l.kind === 'social' ? '<span class="flag soft">Только соцсети</span>' : ''}${p.mine ? '<span class="mine-tag">Ваше</span>' : ''}</div></span>
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
// пока заведения грузятся — серые «заготовки» строк вместо пустоты
const skeleton = n => Array.from({ length: n }, () => '<div class="item skel" aria-hidden="true"><span class="ic"></span><span><i></i><i></i><i></i></span></div>').join('');
// пустой список — со знаком Точки, а не просто текстом
const emptyHtml = text => `<div class="empty"><svg class="empty-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.13 9.51A8.5 8.5 0 1 1 14.49 3.87"/><circle cx="18" cy="6" r="2.6"/></svg>${text}</div>`;
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
      </div></div>` + (rows.length ? rows.map(itemHtml).join('') : loading ? skeleton(6) : emptyHtml(emptyText()));
    L.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { if (b.dataset.sort === 'lead' && needPro('sort')) return; sortMode = b.dataset.sort; store.set('tochka-sort', sortMode); drawList(); L.scrollTop = 0; });
    bindItems(L);
  }
  if (!sel) drawNear(rows);
}
// шторка без выбранного заведения: «Рядом» со сводкой
function drawNear(rows) {
  const noSiteN = rows.filter(r => lead(r.p).kind !== 'own').length;
  $('#card').innerHTML = `<div class="near-h"><b>${favOnly ? 'Избранное' : 'Рядом'}</b>
    <div class="small">${rows.length ? `${rows.length} ${plural(rows.length, ['заведение', 'заведения', 'заведений'])} · ${noSiteN} без своего сайта` : loading ? 'Загружаю заведения…' : emptyText()}</div></div>`
    + (rows.length ? rows.slice(0, 60).map(itemHtml).join('') : loading ? skeleton(3) : '');
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
// Ссылка на соцсеть из OpenStreetMap. Там пишут по-разному: «@name», «name», «vk.com/name», «www.instagram.com/name/»,
// полный адрес, иногда несколько через «;». Берём первую и достраиваем адрес, не приклеивая домен второй раз.
function handle(v, base) {
  const s = String(v).trim().split(/[;,\s]+/).find(Boolean) || '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(www\.|m\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(s)) return 'https://' + s;   // домен без https://
  return base + s.replace(/^@/, '');
}
function socialSearchUrl(platform, p) {
  const query = [p.name, p.city, `site:${platform}`].filter(Boolean).join(' ');
  return 'https://yandex.ru/search/?text=' + encodeURIComponent(query);
}
function contactText(p) {
  if (privateModeOn()) return `${p.name} (${CATS[p.cat].name})`;
  return [
    `${p.name} (${CATS[p.cat].name})`,
    (p.addr || p.city) && `Адрес: ${[p.city, p.addr].filter(Boolean).join(', ')}`,
    p.phone && `Тел.: ${p.phone}`,
    p.site && `Сайт: ${p.site}`, p.email && `Email: ${p.email}`,
    p.tg && `Telegram: ${p.tg}`, p.vk && `VK: ${p.vk}`, p.inst && `Instagram: ${p.inst}`
  ].filter(Boolean).join('\n');
}
function select(id, fly, skipMove = false) {
  const p = places.get(id); if (!p) return;
  sel = id; markSelected();
  const mobile = !isDesk();
  if (mobile && snap !== 1) setSnap(1);
  // заведение — в центре свободной части карты (над шторкой или левее панели)
  const off = mobile ? [0, -Math.round(SNAP[1] / 2) + 20] : [-Math.round((parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panelw')) || 380) / 2) - 14, 0];
  if (skipMove) { /* смена режима не должна двигать карту */ }
  else if (fly || map.getZoom() < 15.5) {
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16.5), offset: off, essential: true, duration: REDUCE ? 0 : 1200 });
  } else {
    map.easeTo({ center: [p.lon, p.lat], offset: off, duration: REDUCE ? 0 : 500 });
  }
  const c = CATS[p.cat];
  const privateMode = privateModeOn();
  const row = (k, v, btn = '') => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span>${btn || '<span></span>'}</div>`;
  const phones = !privateMode && p.phone ? p.phone.split(/[;,]\s*/).map(t => `<a class="tel" href="tel:${esc(t.replace(/[^\d+]/g, ''))}">${esc(t)}</a>`).join('<br>') : '';
  const soc = privateMode ? '' : [
    p.tg && `<a href="${esc(handle(p.tg, 'https://t.me/'))}" target="_blank" rel="noopener">Telegram</a>`,
    p.vk && `<a href="${esc(handle(p.vk, 'https://vk.com/'))}" target="_blank" rel="noopener">VK</a>`,
    p.inst && `<a href="${esc(handle(p.inst, 'https://instagram.com/'))}" target="_blank" rel="noopener" title="В России Instagram открывается только через VPN и просит войти">Instagram</a>`
  ].filter(Boolean).join(' · ');
  const addr = [p.city, p.addr].filter(Boolean).join(', ');
  const l = lead(p);
  const pro = isPro(), canSeeContacts = pro || (session && p.freeRevealedFor === session.user.id);
  // без Pro показываем только, какие контакты есть, а сами номера и ссылки — после входа
  const has = [p.phone && 'телефон', p.email && 'email', p.tg && 'Telegram', p.vk && 'VK', p.inst && 'Instagram'].filter(Boolean);
  if (pro && p.locked && !privateMode) withContacts(p).then(() => { if (sel === p.id) select(p.id, false, true); }, contactsError);
  const contacts = privateMode ? [
      p.phone && row('Телефон', privateMask('phone')),
      p.email && row('Email', privateMask('email')),
      (p.tg || p.vk || p.inst) && row('Соцсети', privateMask('social')),
      !has.length && row('Контакты', privateMask())
    ].filter(Boolean).join('')
    : canSeeContacts && p.locked ? row('Контакты', '<span class="small">Загружаю…</span>') : canSeeContacts ? `
      ${p.phone ? row('Телефон', phones, `<button class="mini" type="button" data-copy="${esc(p.phone)}">Копировать</button>`) : row('Телефон', '<span class="small">не указан</span>')}
      ${p.email ? row('Email', esc(p.email), `<button class="mini" type="button" data-copy="${esc(p.email)}">Копировать</button>`) : ''}
      ${soc ? row('Соцсети', soc) : ''}`
    : row('Контакты', has.length ? `<span class="lockv"><span>Есть: ${has.join(', ')}</span><span class="blur">+7 900 000-00-00</span>
      ${session && freeContactsLeft !== null && (freeContactsLeft > 0 || freeContactIds.has(p.id)) && p.locked
        ? `<button class="mini" type="button" id="freeContact">Открыть бесплатно${freeContactIds.has(p.id) ? '' : ` · осталось ${freeContactsLeft}`}</button>`
        : '<button class="mini" type="button" data-pro="contacts">🔒 Открыть контакты</button>'}</span>` : '<span class="small">не указаны</span>');
  const vkCandidates = Array.isArray(p.vkCandidates) && p.vkCandidates.length ? row('Возможный ВК', privateMode ? privateMask('social') : `${p.vkCandidates.slice(0, 5).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name || 'Сообщество')}</a>`).join(' · ')}<small>Проверьте вручную: поиск мог найти одноимённую группу</small>`) : '';
  $('#card').innerHTML = `
    <div class="card-h"><div>
      <span class="tag" style="color:${c.color}"><span class="cico">${catIcon(p.cat)}</span>${esc(c.name)}</span>
      <h2>${esc(p.name)}</h2></div>
      <div class="card-btns"><button class="star" type="button" id="fav" aria-pressed="${isFav(p.id)}" aria-label="В избранное">${isFav(p.id) ? '★' : '☆'}</button>
      <button class="x" type="button" id="cx" aria-label="Закрыть">×</button></div></div>
    <div class="rows">
      ${row('Адрес', privateMode && addr ? privateMask('address') : addr ? esc(addr) : '<span class="small">не указан</span>')}
      ${contacts}
      ${vkCandidates}
      ${p.hours ? row('Часы', esc(ruHours(p.hours))) : ''}
      ${row('Сайт', privateMode && p.site ? privateMask('site') : p.site ? `<a href="${esc(/^https?:/.test(p.site) ? p.site : 'https://' + p.site)}" target="_blank" rel="noopener">${esc(p.site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>${l.kind === 'social' ? '<small>это соцсеть или онлайн-запись, своего сайта нет</small>' : ''}${checkNote(p)}` : `<span class="nosite-v">Предположительно без сайта</span><small>Не указан в источнике. Проверь перед предложением.</small>${checkNote(p)}`)}
      ${row('Потенциал', `${lvPill(l)} <b class="lv-t lv-t-${l.level}">${LV[l.level]}</b><small>${esc(l.why.join(' · '))}</small>`)}
      ${p.operator ? row('Компания', privateMode ? privateMask('contact') : esc(p.operator)) : ''}
    </div>
    ${privateMode ? '<div class="acts privacy-actions" aria-label="Действия скрыты"><span class="privacy-action"></span><span class="privacy-action"></span></div>' : `<div class="acts">
      <button class="btn pri" type="button" id="write">${pro ? '' : '🔒 '}Написать</button>
      <button class="btn" type="button" id="tonote">${pro ? '' : '🔒 '}В блокнот</button>
      ${p.vk || p.inst ? `${!p.vk ? `<a class="btn" href="${esc(socialSearchUrl('vk.com', p))}" target="_blank" rel="noopener">Найти ВК</a>` : ''}${!p.inst ? `<a class="btn" href="${esc(socialSearchUrl('instagram.com', p))}" target="_blank" rel="noopener" title="Для просмотра Instagram в России может понадобиться VPN">Найти Instagram</a>` : ''}` : ''}
      ${pro && !p.locked ? `<button class="btn" type="button" data-copy="${esc(contactText(p))}">Копировать контакты</button>` : ''}
      <a class="btn" href="https://yandex.ru/maps/?rtext=~${p.lat},${p.lon}" target="_blank" rel="noopener">Маршрут</a>
    </div>`}
    ${p.mine ? `<div class="mine-bar"><span>Это место добавили вы. Его видно только на этом устройстве.</span>
      ${privateMode ? '' : `<div class="mine-acts"><button class="mini" type="button" id="medit">Изменить</button><button class="mini" type="button" id="mdel">Удалить</button>
      <a class="mini" href="https://www.openstreetmap.org/edit#map=19/${p.lat}/${p.lon}" target="_blank" rel="noopener">Добавить на OpenStreetMap для всех</a></div>`}</div>`
    : `<div class="src">Источник: OpenStreetMap${p.db ? ' (база Точки)' : ''}${privateMode ? '' : `. Нашли ошибку? <a href="${p.osm}" target="_blank" rel="noopener">Исправить на карте OSM</a>`}</div>`}`;
  $('#card').scrollTop = 0;
  $('#cx').onclick = closeCard;
  $('#fav').onclick = () => { toggleFav(p.id); const on = isFav(p.id); $('#fav').textContent = on ? '★' : '☆'; $('#fav').setAttribute('aria-pressed', on); };
  // перезапуск «всплытия» карточки
  const cardEl = $('#card'); cardEl.classList.remove('pop'); void cardEl.offsetWidth; cardEl.classList.add('pop');
  if (!privateMode) $('#write').onclick = () => { if (!needPro()) withContacts(p).then(openMsg, contactsError); };
  if (!privateMode && $('#freeContact')) $('#freeContact').onclick = () => withContacts(p)
    .then(() => { if (sel === p.id) select(p.id, false, true); }, contactsError);
  if (p.mine && !privateMode) {
    $('#medit').onclick = () => openAddForm(null, p);
    $('#mdel').onclick = e => {
      const b = e.currentTarget;
      if (b.dataset.sure) deleteMine(p.id);
      else { b.dataset.sure = '1'; b.textContent = 'Точно удалить?'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Удалить'; b.classList.remove('danger'); } }, 4000); }
    };
  }
  if (!privateMode) $('#tonote').onclick = () => {
    if (needPro()) return;
    withContacts(p).then(() => { notePlace = p; openNotes(); const t = $('#nt'); t.value = contactText(p) + '\n'; t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, contactsError);
  };
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
  if (privateModeOn()) return privateModeMessage();
  const fb = () => {
    const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0';
    document.body.appendChild(a); a.select();
    try { document.execCommand('copy'); toast(msg); } catch { toast('Не удалось скопировать'); }
    a.remove();
  };
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast(msg), fb); else fb();
}
let tt; function toast(m, ms = 1700, undo) {
  const t = $('#toast'); t.textContent = m; t.setAttribute('role', 'status');
  if (undo) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'toast-undo'; button.textContent = 'Отменить';
    button.onclick = () => { clearTimeout(tt); t.classList.remove('on'); t.replaceChildren(); undo(); };
    t.append(' ', button);
  }
  t.classList.add('on'); clearTimeout(tt);
  tt = setTimeout(() => { t.classList.remove('on'); t.querySelector('.toast-undo')?.remove(); }, ms);
}
function setStatus(m) { const s = $('#status'); s.textContent = m; s.hidden = !m; }

/* ---------- блокнот ---------- */
let notes = store.get(NOTES_KEY, []);
let notePlace = null;    // заведение, из карточки которого открыли блокнот
const STATUSES = [['new', 'Новый'], ['sent', 'Написал'], ['reply', 'Ответил'], ['deal', 'Договорились'], ['ignore', 'Проигнорировал'], ['no', 'Отказался']];
const stName = s => (STATUSES.find(x => x[0] === s) || STATUSES[0])[1];
const isContacted = n => ['sent', 'reply', 'deal', 'ignore', 'no'].includes(n.s);
const isAnswered = n => ['reply', 'deal', 'no'].includes(n.s);
const DAY = 864e5;
const dayAt = days => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime() + days * DAY; };
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
const isDue = n => n.r && n.r <= endOfToday() && !['deal', 'ignore', 'no'].includes(n.s);
const fmtDay = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const saveNotes = () => { if (!store.set(NOTES_KEY, notes)) toast('Не удалось сохранить: память браузера заполнена'); };
function drawNotes() {
  $('#cnt').textContent = notes.length;
  const due = notes.filter(isDue).length;
  $('#due').textContent = due; $('#due').hidden = !due;
  $('#due').setAttribute('aria-label', due ? `Пора написать: ${due}` : '');
  $('#nl').innerHTML = notes.length ? notes.map(n => `
    <div class="note"><div class="nt-top">
      <label class="note-status">Статус <select class="st st-${n.s || 'new'}" data-st="${n.d}" aria-label="Статус: ${esc(noteName(n))}">
        ${STATUSES.map(([key, name]) => `<option value="${key}"${(n.s || 'new') === key ? ' selected' : ''}>${name}</option>`).join('')}
      </select></label>
      <span class="small">${new Date(n.d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
      ${n.r ? `<div class="remline${isDue(n) ? ' due' : ''}">⏰ ${isDue(n) ? 'Пора написать · ' : 'Напомнить '}${fmtDay(n.r)}</div>` : ''}
      <p>${privateModeOn() ? privateMask('note') : esc(n.t)}</p>
      <div class="nf">
      <div>${n.lat != null ? `<button class="mini" type="button" data-go="${n.d}">На карте</button>` : ''}${!privateModeOn() && n.mailDraft && n.s === 'new' ? `<button class="mini" type="button" data-draft="${n.d}">Открыть письмо</button>` : ''}</div>
      <div><select class="mini rem" data-rem="${n.d}" aria-label="Напоминание">
        <option value="">⏰ Напомнить</option><option value="1">Завтра</option><option value="3">Через 3 дня</option><option value="7">Через неделю</option>${n.r ? '<option value="0">Убрать</option>' : ''}
      </select>
      ${privateModeOn() ? '' : `<button class="mini" type="button" data-copy="${esc(n.t)}">Копировать</button>`}
      <button class="mini" type="button" data-del="${n.d}">Удалить</button></div></div></div>`).join('')
    : '<div class="hint">Пока пусто. Записывайте сюда телефоны, имена и кому написать. Или откройте заведение на карте и нажмите «В блокнот» — контакты подставятся сами.</div>';
  $('#nl').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    notes = notes.filter(n => n.d !== +b.dataset.del); saveNotes(); drawNotes(); toast('Заметка удалена');
  });
  $('#nl').querySelectorAll('[data-st]').forEach(sel => sel.onchange = () => {
    const n = notes.find(x => x.d === +sel.dataset.st);
    if (!n || !STATUSES.some(([key]) => key === sel.value)) return;
    n.s = sel.value;
    if (n.s === 'new') delete n.sentAt;
    else if (!n.sentAt) n.sentAt = Date.now();
    if (['deal', 'ignore', 'no'].includes(n.s)) delete n.r;
    saveNotes(); drawNotes(); toast('Статус: ' + stName(n.s));
  });
  $('#nl').querySelectorAll('[data-rem]').forEach(sel => sel.onchange = () => {
    const n = notes.find(x => x.d === +sel.dataset.rem); if (!n || sel.value === '') return;
    if (sel.value === '0') { delete n.r; toast('Напоминание убрано'); }
    else { n.r = dayAt(+sel.value); toast('Напомню ' + fmtDay(n.r)); }
    saveNotes(); drawNotes();
  });
  if (current === 'v-crm') renderCrm(); else renderTodoBadge();
  if (typeof workspaceSync === 'function') workspaceSync();
  $('#nl').querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const n = notes.find(x => x.d === +b.dataset.go); if (!n) return;
    go('v-map');
    if (n.pid && !places.has(n.pid) && n.place) places.set(n.pid, n.place);
    if (n.pid && places.has(n.pid)) select(n.pid, true);
    else map.flyTo({ center: [n.lon, n.lat], zoom: 16.5, essential: true });
  });
  $('#nl').querySelectorAll('[data-draft]').forEach(b => b.onclick = () => {
    if (needPro()) return;
    const n = notes.find(x => x.d === +b.dataset.draft);
    if (!n || !n.place) return;
    const p = places.get(n.pid) || n.place;
    if (!places.has(p.id)) places.set(p.id, p);
    withContacts(p).then(openMsg, contactsError);
  });
}
$('#nf').addEventListener('submit', e => {
  e.preventDefault();
  if (privateModeOn()) return privateModeMessage();
  const t = $('#nt').value.trim(); if (!t) { $('#nt').focus(); return; }
  if (needPro()) return;
  const n = { t, d: Date.now(), s: 'new' };
  if (notePlace) { n.pid = notePlace.id; n.lat = notePlace.lat; n.lon = notePlace.lon; n.place = notePlace; notePlace = null; }
  notes.unshift(n); saveNotes(); $('#nt').value = ''; drawNotes(); toast('Сохранено');
});
$('#copyall').onclick = () => privateModeOn() ? privateModeMessage() : notes.length ? copy(notes.map(n => n.t).join('\n\n———\n\n')) : toast('Блокнот пуст');
// Экспорт в таблицу: CSV для Excel (с BOM и «;», чтобы русский Excel открыл без кракозябр)
$('#export').onclick = () => {
  if (privateModeOn()) return privateModeMessage();
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
let msgPlace = null, msgDraft = null, tplIdx = 0, logged = false;
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
const EMAIL_IDEA = {
  barber: 'услуги, цены, мастера и удобная запись', beauty: 'услуги, цены, мастера и удобная запись',
  nails: 'услуги, цены, работы мастеров и удобная запись',
  cafe: 'меню, часы работы и связь с гостями', restaurant: 'меню, бронирование и связь с гостями',
  bakery: 'ассортимент, адрес и связь с покупателями', flowers: 'каталог букетов и удобный заказ',
  pet: 'товары, часы работы и связь с покупателями', vet: 'услуги, врачи и запись на приём'
};
function emailDraftFor(p, address) {
  const subject = `Идея сайта для «${p.name}»`;
  const body = `Здравствуйте!\n\nУвидел «${p.name}» на карте. Я занимаюсь созданием сайтов для небольших компаний. Для вас можно было бы сделать страницу, где собраны ${EMAIL_IDEA[p.cat] || 'услуги, цены и удобная связь с клиентами'}.\n\nЕсли вам это актуально, я с удовольствием покажу пример оформления и отвечу на вопросы. Буду благодарен за ответ.${sign.trim() ? '\n\nС уважением,\n' + sign.trim() : ''}`;
  return { address, subject, body };
}
$('#draftEmails').onclick = async () => {
  if (privateModeOn()) return privateModeMessage();
  if (needPro()) return;
  const button = $('#draftEmails'); button.disabled = true; button.textContent = 'Подбираю…';
  try {
    const seen = new Set(notes.map(n => n.pid).filter(Boolean));
    const candidates = [...visible].filter(p => p.db && !p.mine && !seen.has(p.id) && (p.email === '*' || cleanPlaceEmail(p.email)))
      .sort((a, b) => lead(b).score - lead(a).score).slice(0, 300);
    if (!candidates.length) return toast('Сначала загрузите заведения на карте. Уже добавленных в блокнот не повторяю.', 3500);
    const emails = new Map(candidates.filter(p => p.email !== '*').map(p => [p.id, cleanPlaceEmail(p.email)]));
    const locked = candidates.filter(p => p.email === '*');
    for (let i = 0; i < locked.length; i += 80) {
      const ids = locked.slice(i, i + 80).map(p => p.id).join(',');
      const rows = await api(`/rest/v1/place_contacts?select=id,email&id=in.(${ids})`, { token: await token() });
      for (const row of rows || []) if (row.email) emails.set(row.id, cleanPlaceEmail(row.email));
    }
    const drafts = candidates.filter(p => emails.get(p.id)).slice(0, 10).map((p, i) => {
      const mail = emailDraftFor(p, emails.get(p.id));
      return { t: `Кому: ${mail.address}\nТема: ${mail.subject}\n\n${mail.body}`, d: Date.now() + i,
        s: 'new', pid: p.id, lat: p.lat, lon: p.lon, place: p,
        mailDraft: true, mailTo: mail.address, mailSubject: mail.subject, mailBody: mail.body };
    });
    if (privateModeOn()) return;
    if (!drafts.length) return toast('У загруженных заведений пока нет доступных проверенных email.', 3500);
    notes.unshift(...drafts); saveNotes(); drawNotes();
    toast(`Подготовлено писем: ${drafts.length}. Проверьте каждое перед отправкой.`, 3600);
  } catch (error) { toast('Не удалось подготовить письма: ' + error.message, 4000); }
  finally { button.disabled = false; updateDraftEmailsAccess(); }
};
const waNumber = ph => {
  let d = String(ph).split(/[;,]/)[0].replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length >= 11 ? d : '';
};
function openMsg(p) {
  if (privateModeOn()) return privateModeMessage();
  msgPlace = p; logged = false;
  msgDraft = notes.find(n => n.pid === p.id && n.mailDraft && n.s === 'new') || null;
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
  $('#tplChips').querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => { msgDraft = null; tplIdx = +b.dataset.tpl; drawMsg(); });
  $('#msText').value = msgDraft ? msgDraft.mailBody : fillTpl(tpls[tplIdx].t, p);
  const wa = p.phone && waNumber(p.phone);
  const acts = [`<button class="btn pri" type="button" data-act="copy">Скопировать текст</button>`];
  if (p.tg) acts.push(`<a class="btn" data-act="open" href="${esc(handle(p.tg, 'https://t.me/'))}" target="_blank" rel="noopener">Telegram</a>`);
  if (wa) acts.push(`<a class="btn" data-act="wa" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (p.vk) acts.push(`<a class="btn" data-act="open" href="${esc(handle(p.vk, 'https://vk.com/'))}" target="_blank" rel="noopener">VK</a>`);
  if (siteKind(p) === 'social') acts.push(`<a class="btn" data-act="open" href="${esc(/^https?:/.test(p.site) ? p.site : 'https://' + p.site)}" target="_blank" rel="noopener">Их страница</a>`);
  if (p.email) acts.push(`<a class="btn" data-act="mail" href="https://mail.google.com/mail/?view=cm&fs=1" target="_blank" rel="noopener">Открыть в Gmail</a>`);
  if (p.phone) acts.push(`<a class="btn" data-act="call" href="tel:${esc(String(p.phone).split(/[;,]/)[0].replace(/[^\d+]/g, ''))}">Позвонить</a>`);
  acts.push('<button class="btn" type="button" data-act="sent">Отметить как отправленное</button>');
  $('#msActs').innerHTML = acts.join('');
  $('#msActs').querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const text = $('#msText').value;
    const act = b.dataset.act;
    if (act === 'wa') b.href = `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
    if (act === 'mail') {
      const address = p.email;
      const subject = msgDraft?.mailSubject || `Сайт для «${p.name}»`;
      b.href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(address)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
      toast('Письмо откроется в Gmail. После отправки отметьте его в «Точке».', 3800);
    }
    if (act === 'sent') { logContact(p); closeMsg(); return; }
    if (act === 'copy' || act === 'open') copy(text, act === 'open' ? 'Текст скопирован — вставьте его в чат' : 'Текст скопирован');
  });
}
function logContact(p) {
  if (logged) return;
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

function openNotes() { if (privateModeOn()) return privateModeMessage(); go('v-crm'); requestAnimationFrame(() => $('#nf').scrollIntoView({ block: 'center', behavior: REDUCE ? 'auto' : 'smooth' })); }

/* ---------- «Мои клиенты»: сводка, кому написать, воронка, неделя ---------- */
const BAR = { new: 'var(--bar-new)', sent: 'var(--bar-sent)', reply: 'var(--bar-reply)', deal: 'var(--bar-deal)', ignore: 'var(--bar-ignore)', no: 'var(--bar-no)' };
const noteName = n => (n.place && n.place.name) || (privateModeOn() ? 'Заметка' : (n.t || '').split('\n')[0].slice(0, 60)) || 'Заметка';
function renderTodoBadge() { /* значок на вкладке обновляет drawNotes */ }
function renderCrm() {
  const cnt = k => notes.filter(n => (n.s || 'new') === k).length;
  const contacted = notes.filter(isContacted).length, answered = notes.filter(isAnswered).length;
  $('#successSummary').hidden = !isPro();
  $('#successSummary').textContent = contacted
    ? `Ты написал ${contacted} клиентам — ответили ${answered}, договорились ${cnt('deal')}.`
    : 'Отмечай воронку клиентов — здесь появятся ответы и договорённости.';
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
      <div class="ta">${n.place && !privateModeOn() ? '<button class="btn pri" type="button" data-t="write">Написать</button>' : ''}
      <button class="btn" type="button" data-t="done" title="Отметить, что написали">Написал ✓</button>
      <button class="mini" type="button" data-t="later" title="Напомнить завтра">Завтра</button>
      <button class="btn decline" type="button" data-t="skip" title="Убрать напоминание, сохранив клиента в блокноте">Не буду писать</button></div></div>`).join('')
    : `<p class="hint">${notes.length ? 'На сегодня всё. Отличная работа!' : 'Пока пусто. Откройте заведение на карте и нажмите «Написать» — оно появится здесь с напоминанием.'}</p>`;
  $('#todo').querySelectorAll('.tcard').forEach(card => card.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const n = notes.find(x => x.d === +card.dataset.d); if (!n) return;
    if (b.dataset.t === 'write') { if (privateModeOn()) return privateModeMessage(); const p = n.place; if (p && !needPro()) { if (!places.has(p.id)) places.set(p.id, p); withContacts(places.get(p.id)).then(openMsg, contactsError); } return; }
    if (b.dataset.t === 'later') { n.r = dayAt(1); toast('Напомню завтра'); }
    if (b.dataset.t === 'skip') {
      const reminder = n.r, status = n.s;
      delete n.r;
      toast(`«${noteName(n)}»: напоминание убрано, клиент сохранён`, 8000, () => {
        const currentNote = notes.find(x => x.d === n.d);
        if (!currentNote || currentNote.r || currentNote.s !== status) return toast('Клиент уже изменён — напоминание можно задать в блокноте');
        currentNote.r = reminder; saveNotes(); drawNotes(); toast('Клиент возвращён в список');
      });
    }
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
    : !acct ? '—' : acct.state === 'active' ? `Активна до ${fmtDateTime(acct.until)}`
    : acct.state === 'trial' ? `Пробный период до ${fmtDateTime(acct.until)} · осталось ${leftText(acct.until)}` : 'Закончилась — продлите';
  $('#pAcc').hidden = !authOn();
  if (privateModeOn()) $('#pAccSub').innerHTML = privateMask('email');
  else $('#pAccSub').textContent = session ? session.user.email : 'Вход не выполнен';
  $('#pAdm').hidden = privateModeOn() || !adminVerified;
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
// Перенос личных данных между устройствами. Токены входа и кэш базы в файл не попадают.
const BACKUP_KEYS = ['tochka-notes', 'tochka-favs', 'tochka-mine', 'tochka-tpl', 'tochka-sign',
  'tochka-workspace-person', 'tochka-theme', 'tochka-remind', 'tochka-sort'];
const validBackupValue = (key, value) => {
  if (['tochka-notes', 'tochka-tpl'].includes(key)) return Array.isArray(value) && value.length <= 10000;
  if (['tochka-favs', 'tochka-mine', 'tochka-workspace-person'].includes(key)) return value && typeof value === 'object' && !Array.isArray(value);
  if (key === 'tochka-sign') return typeof value === 'string';
  if (key === 'tochka-theme') return ['light', 'dark', 'navy', 'auto'].includes(value);
  if (key === 'tochka-remind') return typeof value === 'boolean';
  if (key === 'tochka-sort') return ['near', 'name', 'lead'].includes(value);
  return false;
};
$('#pBackup').onclick = () => {
  if (privateModeOn()) return privateModeMessage();
  try {
    const data = {};
    for (const key of BACKUP_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const value = key === 'tochka-theme' ? raw : JSON.parse(raw);
        if (validBackupValue(key, value)) data[key] = value;
      }
    }
    const file = new Blob([JSON.stringify({ kind: 'tochka-backup', version: 1, createdAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = `tochka-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    toast('Резервная копия скачана. Храните файл приватно.', 3500);
  } catch { toast('Не удалось создать копию. Проверьте память браузера.', 3500); }
};
$('#pRestore').onclick = () => { if (privateModeOn()) return privateModeMessage(); $('#backupFile').click(); };
$('#backupFile').onchange = async event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Файл слишком большой (максимум 2 МБ).');
    const backup = JSON.parse(await file.text());
    if (backup?.kind !== 'tochka-backup' || backup.version !== 1 || !backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) throw new Error('Это не резервная копия Точки.');
    const entries = Object.entries(backup.data);
    if (!entries.length || entries.some(([key, value]) => !BACKUP_KEYS.includes(key) || !validBackupValue(key, value))) throw new Error('В файле есть неизвестные или повреждённые данные.');
    if (!confirm('Восстановить данные из файла? Текущие заметки, избранное и настройки на этом устройстве будут заменены.')) return;
    const previous = new Map(entries.map(([key]) => [key, localStorage.getItem(key)]));
    try {
      for (const [key, value] of entries) localStorage.setItem(key, key === 'tochka-theme' ? value : JSON.stringify(value));
    } catch (e) {
      for (const [key, value] of previous) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      throw e;
    }
    location.reload();
  } catch (e) { toast(e.message || 'Не удалось восстановить данные.', 4000); }
};
$('#pPro').onclick = () => openPro();
$('#referralCopy').onclick = () => {
  if (!session || !authOn()) return showGate('email');
  const link = new URL(location.origin + location.pathname);
  link.searchParams.set('ref', session.user.id);
  copy(link.href, 'Ссылка для приглашения скопирована');
};
$('#pAcc').onclick = () => openPro();
$('#pAdm').onclick = () => { if (!privateModeOn() && adminVerified) openAdmin(); };
$('#pRev').onclick = () => openReviews();
document.addEventListener('click', e => { const b = e.target.closest('[data-pro]'); if (b && !needPro()) openPro(); });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeProTour(); closeSheet(); closeMsg(); closeAdd(); stopAdd(); closePro(); closeAdmin(); closeReviews(); hideGate(); }
  // «/» — быстро перейти к поиску (как на многих сайтах)
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); go('v-map'); setTimeout(() => $('#q').focus(), 30); }
});

/* ---------- 3D-знак на экране «Начать» ----------
   Кольцо-«о» собрано из 14 слоёв SVG друг за другом по глубине: при повороте видна толщина.
   Задние слои темнее (как тень на боковине), спереди — акцентный цвет темы, точка висит перед кольцом. */
(function logo3d() {
  const box = $('#logo3d'); if (!box) return;
  const inner = box.firstElementChild, N = 14;
  const ring = 'M20.13 9.51A8.5 8.5 0 1 1 14.49 3.87';
  let html = '';
  for (let i = N - 1; i >= 0; i--) {
    const k = i / (N - 1);   // 0 — передний слой, 1 — самый задний
    html += `<svg viewBox="0 0 24 24" style="transform:translateZ(${-i * 1.15}px)"><path d="${ring}" style="stroke:color-mix(in srgb,var(--accent) ${100 - k * 45}%,#0B1424)"/></svg>`;
  }
  html += `<svg viewBox="0 0 24 24" style="transform:translateZ(9px)"><circle cx="18" cy="6" r="2.9"/></svg>`;
  inner.innerHTML = html;
  // поворот за мышкой или пальцем; отпустили — снова само покачивается
  const turn = e => {
    const r = box.getBoundingClientRect();
    const dx = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width * 1.2)));
    const dy = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height * 1.2)));
    inner.classList.add('held');
    inner.style.transform = `rotateY(${dx * 40}deg) rotateX(${-dy * 30}deg)`;
  };
  const card = box.closest('.gate-card') || box;
  card.addEventListener('pointermove', turn);
  card.addEventListener('pointerleave', () => { inner.classList.remove('held'); inner.style.transform = ''; });
  box.addEventListener('pointerup', () => { inner.classList.remove('held'); inner.style.transform = ''; });
})();

/* ---------- первый запуск: «Начать» и два вопроса ---------- */
const HELLO_KEY = 'tochka-hello';
let hCat = 'all', hCity = 0;   // hCity: индекс в CITIES, -1 — рядом со мной, -2 — другой город
function helloStep(i) { document.querySelectorAll('#hello [data-hs]').forEach(s => s.hidden = +s.dataset.hs !== i); }
function helloOpts(box, items, isOn, onPick) {
  box.innerHTML = items.map(([v, label], i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${isOn(v)}">${esc(label)}</button>`).join('');
  box.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; onPick(items[+b.dataset.i][0]); box.querySelectorAll('[data-i]').forEach(x => x.setAttribute('aria-pressed', x === b)); };
}
helloOpts($('#hCats'), [['all', 'Всех'], ...Object.entries(CATS).map(([k, v]) => [k, v.name])], v => v === hCat, v => hCat = v);
helloOpts($('#hCities'), [[-1, '📍 Рядом со мной'], ...CITIES.slice(0, 7).map(([n], i) => [i, n]), [-2, 'Другой город…']], v => v === hCity, v => hCity = v);
$('#hStart').onclick = () => helloStep(1);
$('#hNext').onclick = () => helloStep(2);
$('#hGo').onclick = () => {
  store.set(HELLO_KEY, 1);
  $('#hello').hidden = true;
  const ci = ['all', ...Object.keys(CATS)].indexOf(hCat);
  if (ci > 0) catChips[ci].click();
  if ($('#hNoSite').checked !== noSite) chips.querySelector('.nosite').click();
  if (hCity >= 0) { const [, la, lo] = CITIES[hCity]; flyToCity(la, lo); }
  else if (hCity === -1) { $('#loc').click(); loadView(); }
  else { openSheet(); loadView(); }
};
if (!store.get(HELLO_KEY, 0) && !session) $('#hello').hidden = false;

/* ---------- старт ---------- */
document.querySelectorAll('#theme [data-t]').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === themeMode));
measureDrawer(); setSnap(0, false); movePill();
try { document.fonts.ready.then(movePill); } catch { /* старый браузер */ }
drawNotes();
{ const due = notes.filter(isDue).length; if (due && store.get(REM_KEY, true)) setTimeout(() => toast(`Пора написать: ${due}. Откройте «Клиенты»`, 3200), 1500); }
visible = [...places.values()];
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
