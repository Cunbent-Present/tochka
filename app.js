'use strict';
/* Точка — карта салонов Москвы. Данные: OpenStreetMap (Overpass API), лицензия ODbL. */

const CATS = {
  barber: { name: 'Барбершоп',       color: '#2F6496', syn: ['барбер', 'барбершоп', 'мужская стрижка', 'борода', 'barber'] },
  beauty: { name: 'Салон красоты',   color: '#B0457A', syn: ['салон', 'салон красоты', 'парикмахер', 'стрижка', 'окрашивание', 'укладка', 'beauty'] },
  nails:  { name: 'Маникюр',         color: '#C2702E', syn: ['маникюр', 'ногти', 'nail', 'педикюр'] },
  brows:  { name: 'Брови и ресницы', color: '#7A5BB5', syn: ['брови', 'ресницы', 'brow', 'lash', 'ламинирование'] },
  tattoo: { name: 'Тату',            color: '#59636D', syn: ['тату', 'татуировка', 'пирсинг', 'tattoo'] },
  spa:    { name: 'СПА и массаж',    color: '#2F8A72', syn: ['спа', 'массаж', 'spa', 'massage'] }
};
const MOSCOW = [55.7558, 37.6173];
const MIN_LOAD_ZOOM = 13;
const CELL = 0.02;                 // размер ячейки кэша в градусах
const CACHE_KEY = 'tochka-places-v1';
const CACHE_DAYS = 7;
const NOTES_KEY = 'tochka-notes';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');

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
  const street = t['addr:street'], house = t['addr:housenumber'];
  return {
    id: el.type[0] + el.id,
    osm: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name: t.name, cat: categorize(t), lat, lon,
    addr: [street, house].filter(Boolean).join(', '),
    phone: t.phone || t['contact:phone'] || '',
    site: t.website || t['contact:website'] || t.url || '',
    email: t.email || t['contact:email'] || '',
    hours: t.opening_hours || '',
    vk: t['contact:vk'] || '', tg: t['contact:telegram'] || '', inst: t['contact:instagram'] || '',
    operator: t.operator || ''
  };
}

const places = new Map();
let loadedCells = new Set();
function restoreCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!c || Date.now() - c.t > CACHE_DAYS * 864e5) return;
    c.cells.forEach(k => loadedCells.add(k));
    c.places.forEach(p => places.set(p.id, p));
  } catch { /* кэш недоступен — грузим заново */ }
}
let saveTimer;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), cells: [...loadedCells], places: [...places.values()] }, (k, v) => k === '_m' ? undefined : v)); }
    catch { /* переполнение хранилища — не страшно */ }
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
  if (map.getZoom() < MIN_LOAD_ZOOM) { setStatus(places.size ? '' : 'Приблизьте карту, чтобы загрузить заведения'); return; }
  const b = map.getBounds();
  const missing = [];
  for (let i = Math.floor(b.getSouth() / CELL); i <= Math.floor(b.getNorth() / CELL); i++)
    for (let j = Math.floor(b.getWest() / CELL); j <= Math.floor(b.getEast() / CELL); j++) {
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
const map = L.map('map', { zoomControl: false }).setView(MOSCOW, 14);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">участники OpenStreetMap</a>'
}).addTo(map);
map.attributionControl.setPrefix(false);
const cluster = L.markerClusterGroup({
  showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true,
  iconCreateFunction: c => L.divIcon({ html: c.getChildCount(), className: 'clu', iconSize: [38, 38] })
});
map.addLayer(cluster);

const pinSvg = color => `<svg width="28" height="36" viewBox="-14 -36 28 36"><path d="M0 0C-4-8-13-13-13-23A13 13 0 1 1 13-23C13-13 4-8 0 0Z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="0" cy="-23" r="5" fill="#fff"/></svg>`;
function markerFor(p) {
  if (!p._m) {
    p._m = L.marker([p.lat, p.lon], {
      title: p.name,
      icon: L.divIcon({ className: 'pin', html: pinSvg(CATS[p.cat].color), iconSize: [28, 36], iconAnchor: [14, 36] })
    }).on('click', () => select(p.id));
  }
  return p._m;
}

let cat = 'all', noSite = false, sel = null, visible = [];
function matches(p, q) {
  if (cat !== 'all' && p.cat !== cat) return false;
  if (noSite && p.site) return false;
  if (!q) return true;
  const c = CATS[p.cat];
  const hay = norm([p.name, p.addr, p.operator, c.name, ...c.syn].join(' ')).replace(/[,.]/g, ' ');
  return q.split(/\s+/).every(w => hay.includes(w)) || c.syn.some(s => q.includes(norm(s)));
}
function applyFilter() {
  const q = norm($('#q').value.trim()).replace(/[,.]/g, ' ');
  $('#clear').hidden = !q;
  visible = [...places.values()].filter(p => matches(p, q));
  cluster.clearLayers();
  cluster.addLayers(visible.map(markerFor));
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

// Ссылка на страницу загрузки — не показываем, если Точка уже открыта как установленное приложение
const inApp = matchMedia('(display-mode: standalone)').matches || navigator.standalone || window.Capacitor ||
  /Electron|; wv\)/.test(navigator.userAgent);
if (!inApp) {
  const a = document.createElement('a');
  a.href = 'download.html'; a.className = 'chip dl'; a.textContent = 'Скачать приложение';
  chips.appendChild(a);
}

/* ---------- список ---------- */
function drawList() {
  const c = map.getCenter(), b = map.getBounds();
  const inView = visible.filter(p => b.contains([p.lat, p.lon]))
    .map(p => ({ p, d: map.distance(c, [p.lat, p.lon]) })).sort((a, z) => a.d - z.d).slice(0, 150);
  const dist = d => d < 1000 ? Math.round(d / 10) * 10 + ' м' : (d / 1000).toFixed(1).replace('.', ',') + ' км';
  const L_ = $('#list');
  L_.innerHTML = `<div class="list-head"><b>На экране: ${inView.length}</b><span class="small">всего загружено ${places.size}</span></div>` +
    (inView.length ? inView.map(({ p, d }) => `
      <button type="button" class="item${p.id === sel ? ' sel' : ''}" data-id="${p.id}">
        <span class="bar" style="background:${CATS[p.cat].color}"></span>
        <span><div class="nm">${esc(p.name)}</div>
        <div class="sub">${esc(CATS[p.cat].name)}${p.addr ? ' · ' + esc(p.addr) : ''} · ${dist(d)}</div>
        ${p.site ? '' : '<div class="flag">Нет сайта</div>'}</span>
      </button>`).join('')
    : `<div class="empty">${map.getZoom() < MIN_LOAD_ZOOM ? 'Приблизьте карту, чтобы загрузить заведения в этом районе.' : 'Здесь ничего не нашлось. Сдвиньте карту или измените поиск.'}</div>`);
  L_.querySelectorAll('.item').forEach(b => b.onclick = () => { select(b.dataset.id, true); $('#main').classList.remove('showlist'); $('#lt').textContent = 'Список'; });
}
$('#lt').onclick = () => { const m = $('#main'); m.classList.toggle('showlist'); $('#lt').textContent = m.classList.contains('showlist') ? 'Карта' : 'Список'; };

let mt; map.on('moveend', () => { clearTimeout(mt); mt = setTimeout(() => { loadView(); drawList(); }, 400); });
$('#zin').onclick = () => map.zoomIn();
$('#zout').onclick = () => map.zoomOut();
$('#loc').onclick = () => {
  if (!navigator.geolocation) return toast('Геолокация недоступна');
  navigator.geolocation.getCurrentPosition(
    pos => map.setView([pos.coords.latitude, pos.coords.longitude], 16),
    () => toast('Не удалось определить местоположение'), { enableHighAccuracy: true, timeout: 10000 });
};

/* ---------- карточка ---------- */
const DAYS = { Mo: 'Пн', Tu: 'Вт', We: 'Ср', Th: 'Чт', Fr: 'Пт', Sa: 'Сб', Su: 'Вс', PH: 'праздники', off: 'выходной', closed: 'закрыто' };
const ruHours = h => h === '24/7' ? 'Круглосуточно' : h.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|off|closed)\b/g, m => DAYS[m]).replace(/;\s*/g, '; ');
const handle = (v, base) => /^https?:/.test(v) ? v : base + v.replace(/^@/, '');
function contactText(p) {
  return [
    `${p.name} (${CATS[p.cat].name})`,
    p.addr && `Адрес: ${p.addr}`,
    p.phone && `Тел.: ${p.phone}`,
    p.site && `Сайт: ${p.site}`, p.email && `Email: ${p.email}`,
    p.tg && `Telegram: ${p.tg}`, p.vk && `VK: ${p.vk}`, p.inst && `Instagram: ${p.inst}`
  ].filter(Boolean).join('\n');
}
function select(id, fly) {
  const p = places.get(id); if (!p) return;
  if (sel && places.get(sel)?._m) places.get(sel)._m.getElement()?.classList.remove('sel');
  sel = id;
  if (fly) map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17));
  cluster.zoomToShowLayer(markerFor(p), () => p._m.getElement()?.classList.add('sel'));
  const c = CATS[p.cat];
  const row = (k, v, btn = '') => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span>${btn || '<span></span>'}</div>`;
  const phones = p.phone ? p.phone.split(/[;,]\s*/).map(t => `<a class="tel" href="tel:${esc(t.replace(/[^\d+]/g, ''))}">${esc(t)}</a>`).join('<br>') : '';
  const soc = [
    p.tg && `<a href="${esc(handle(p.tg, 'https://t.me/'))}" target="_blank" rel="noopener">Telegram</a>`,
    p.vk && `<a href="${esc(handle(p.vk, 'https://vk.com/'))}" target="_blank" rel="noopener">VK</a>`,
    p.inst && `<a href="${esc(handle(p.inst, 'https://instagram.com/'))}" target="_blank" rel="noopener">Instagram</a>`
  ].filter(Boolean).join(' · ');
  $('#card').innerHTML = `
    <div class="card-h"><div>
      <span class="tag" style="color:${c.color}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span>
      <h2>${esc(p.name)}</h2></div>
      <button class="x" type="button" id="cx" aria-label="Закрыть">×</button></div>
    <div class="rows">
      ${row('Адрес', p.addr ? esc(p.addr) : '<span class="small">не указан</span>')}
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
  $('#tonote').onclick = () => { openNotes(); const t = $('#nt'); t.value = contactText(p) + '\n'; t.focus(); t.setSelectionRange(t.value.length, t.value.length); };
  drawList();
}
function closeCard() {
  if (sel) places.get(sel)?._m?.getElement()?.classList.remove('sel');
  sel = null; $('#card').hidden = true; drawList();
}
map.on('click', closeCard);

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
let notes = (() => { try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); } catch { return []; } })();
const saveNotes = () => { try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { toast('Не удалось сохранить: память браузера заполнена'); } };
function drawNotes() {
  $('#cnt').textContent = notes.length;
  $('#nl').innerHTML = notes.length ? notes.map(n => `
    <div class="note"><p>${esc(n.t)}</p>
      <div class="nf"><span>${new Date(n.d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      <div><button class="mini" type="button" data-copy="${esc(n.t)}">Копировать</button>
      <button class="mini" type="button" data-del="${n.d}">Удалить</button></div></div></div>`).join('')
    : '<div class="hint">Пока пусто. Записывайте сюда телефоны, имена и кому написать. Или откройте заведение на карте и нажмите «В блокнот» — контакты подставятся сами.</div>';
  $('#nl').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    notes = notes.filter(n => n.d !== +b.dataset.del); saveNotes(); drawNotes(); toast('Заметка удалена');
  });
}
$('#nf').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('#nt').value.trim(); if (!t) { $('#nt').focus(); return; }
  notes.unshift({ t, d: Date.now() }); saveNotes(); $('#nt').value = ''; drawNotes(); toast('Сохранено');
});
$('#copyall').onclick = () => notes.length ? copy(notes.map(n => n.t).join('\n\n———\n\n')) : toast('Блокнот пуст');
function openNotes() { $('#np').classList.add('on'); }
$('#fab').onclick = () => { const on = $('#np').classList.toggle('on'); if (on) $('#nt').focus(); };
$('#npx').onclick = () => $('#np').classList.remove('on');
addEventListener('keydown', e => { if (e.key === 'Escape') $('#np').classList.remove('on'); });

/* ---------- старт ---------- */
restoreCache();
drawNotes();
applyFilter();
loadView();
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
