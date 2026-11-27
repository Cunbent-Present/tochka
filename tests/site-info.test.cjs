const test = require('node:test');
const assert = require('node:assert/strict');
const info = require('../site-info.js');

test('пустое поле не доказывает отсутствие сайта', () => {
  const result = info.describe({});
  assert.equal(result.label, 'Нет данных о сайте');
  assert.match(result.detail, /может существовать/);
});
test('сайт бренда не становится сайтом отдельного филиала', () => {
  const p = { brandSite: 'https://chain.example.ru' };
  assert.equal(info.kind(p), 'none');
  assert.equal(info.describe(p).label, 'Есть сайт бренда или оператора');
});
test('сайт, запись, соцсеть и каталог различаются по хосту', () => {
  for (const [url, type] of [['example.ru', 'own'], ['https://n123.yclients.com', 'booking'], ['taplink.cc/demo', 'booking'], ['vk.com/demo', 'social'], ['yandex.ru/maps/org/1', 'directory'], ['vk.com.example.ru', 'own']]) {
    assert.equal(info.type(url), type);
  }
});
test('ошибка сети не превращает указанный сайт в отсутствующий', () => {
  const p = { site: 'https://example.ru', siteCheck: { status: 'unknown', date: '2026-11-27', url: 'https://example.ru' } };
  assert.equal(info.kind(p), 'own');
  assert.match(info.describe(p).detail, /не удалось/);
});
test('проверка старого URL не помечает новый сайт неработающим', () => {
  const p = { site: 'https://new.example.ru', siteCheck: { status: 'dead', date: '2026-11-27', url: 'https://old.example.ru' } };
  assert.equal(info.kind(p), 'own');
  assert.equal(info.describe(p).label, 'Сайт указан');
});
test('показывает дату, источник и устаревание успешной проверки', () => {
  const p = { site: 'https://example.ru', chk: { s: 'own', how: 'v', url: 'https://example.ru', d: '2026-10-01' }, siteCheck: { status: 'ok', date: '2026-10-02', url: 'https://example.ru' } };
  const result = info.describe(p, Date.parse('2026-11-27'));
  assert.equal(result.date, '2026-10-02');
  assert.equal(result.stale, true);
  assert.match(result.source, /ВКонтакте/);
  assert.equal(result.label, 'Сайт открывался');
});
test('подтверждённая неработающая ссылка и незавершённый поиск различаются', () => {
  const p = { site: 'https://example.ru', siteCheck: { status: 'dead', date: '2026-11-27', url: 'https://example.ru' } };
  assert.equal(info.kind(p), 'none');
  assert.equal(info.describe(p).label, 'Ссылка не работает');
  assert.equal(info.describe({ chk: { s: 'unknown', how: 'd' } }).label, 'Проверка не завершена');
});
test('некорректные и исполняемые URL не становятся ссылками сайта', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@example.ru', 'не ссылка']) assert.equal(info.safeUrl(url), '');
});
test('ручной поиск включает название, город и адрес, но не контакты', () => {
  const url = new URL(info.searchUrl({ name: 'Кофе & хлеб', city: 'Москва', addr: 'Мира, 2', phone: 'SECRET' }));
  assert.equal(url.searchParams.get('text'), 'Кофе & хлеб Москва Мира, 2 официальный сайт');
});
test('каталоги открываются с названием и адресом для ручной сверки', () => {
  const urls = info.directoryUrls({ name: 'Зёрна', city: 'Москва', addr: 'Тверская, 1', phone: 'SECRET' });
  assert.equal(new URL(urls.yandex).searchParams.get('text'), 'Зёрна Москва Тверская, 1');
  assert.match(decodeURIComponent(urls.gis), /Зёрна Москва Тверская, 1/);
  assert.doesNotMatch(urls.gis, /SECRET/);
});

test('подмешивание отчёта не переносит ошибку исходной ссылки на найденный сайт', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
  const start = source.indexOf('function applyChecks(m) {');
  const end = source.indexOf('let loading =', start);
  const p = { id: 'n1', site: 'https://taplink.cc/old' };
  const context = { places: new Map([['n1', p]]), leadCache: new WeakMap(), TochkaSiteInfo: info, siteKind: info.kind };
  vm.runInNewContext(source.slice(start, end), context);
  context.applyChecks({ n1: ['own', 'https://new.example.ru', '2026-11-27', 'd'], _links: { n1: ['dead', '2026-11-26', 'https://taplink.cc/old'] } });
  assert.equal(p.site, 'https://new.example.ru');
  assert.equal(info.kind(p), 'own');
  assert.equal(p.siteDead, '');
  context.applyChecks({ _links: { n1: ['ok', '2026-11-27', 'https://new.example.ru'] } });
  assert.equal(info.describe(p).label, 'Сайт открывался');
});
