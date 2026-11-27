import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { newPlacesInCity } from './logic.mjs';

const rawKey = process.env.SUPABASE_SECRET_KEY || '';
const key = rawKey.match(/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] || rawKey.trim();
if (!key) throw new Error('SUPABASE_SECRET_KEY is required');
const base = (process.env.SUPABASE_URL || 'https://aficnrxwryphxdgjmyfx.supabase.co').replace(/\/$/, '');
const headers = { apikey: key, 'Content-Type': 'application/json', ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

async function db(query, options = {}) {
  const response = await fetch(`${base}/rest/v1/${query}`, {
    method: options.method || 'GET',
    headers: { ...headers, ...(options.prefer ? { Prefer: options.prefer } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.status === 204 ? null : response.json().catch(() => null);
}

async function allRows(table, columns, sortColumn) {
  const rows = [];
  let last = '';
  for (;;) {
    const query = `${table}?select=${columns}&order=${sortColumn}.asc&limit=1000` +
      (last ? `&${sortColumn}=gt.${encodeURIComponent(last)}` : '');
    const page = await db(query);
    rows.push(...page);
    if (page.length < 1000) return rows;
    last = page.at(-1)[sortColumn];
  }
}

async function saveRows(table, keyColumn, rows) {
  for (let i = 0; i < rows.length; i += 500)
    await db(`${table}?on_conflict=${keyColumn}`, {
      method: 'POST', body: rows.slice(i, i + 500), prefer: 'resolution=merge-duplicates,return=minimal'
    });
}

async function currentPlaces() {
  const places = new Map();
  for (const entry of await readdir(dataDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'index.json') continue;
    const rows = JSON.parse(await readFile(path.join(dataDir, entry.name), 'utf8'));
    if (!Array.isArray(rows)) continue;
    for (const row of rows) if (Array.isArray(row) && row[0] && !places.has(row[0])) places.set(row[0], row);
  }
  return places;
}

async function main() {
  const config = new Map((await db('push_config?select=key,value')).map(row => [row.key, row.value]));
  if (!config.get('vapid_public') || !config.get('vapid_private')) {
    const pair = webpush.generateVAPIDKeys();
    await saveRows('push_config', 'key', [
      { key: 'vapid_public', value: pair.publicKey },
      { key: 'vapid_private', value: pair.privateKey }
    ]);
    config.set('vapid_public', pair.publicKey);
    config.set('vapid_private', pair.privateKey);
  }
  webpush.setVapidDetails('https://tochka-klient.ru/', config.get('vapid_public'), config.get('vapid_private'));

  const places = await currentPlaces();
  const known = new Set((await allRows('push_seen_places', 'id', 'id')).map(row => row.id));
  const fresh = [...places.values()].filter(row => !known.has(row[0]));
  if (config.get('baseline_ready') !== 'yes') {
    await saveRows('push_seen_places', 'id', [...places.keys()].map(id => ({ id })));
    await saveRows('push_config', 'key', [{ key: 'baseline_ready', value: 'yes' }]);
    console.log(`Начальная база сохранена: ${places.size} заведений. Уведомления начнутся с новых обновлений.`);
    return;
  }
  if (!fresh.length) { console.log('Новых заведений нет.'); return; }

  const index = JSON.parse(await readFile(path.join(dataDir, 'index.json'), 'utf8'));
  const cities = new Map((index.cities || []).map(city => [city.slug, city]));
  const subscriptions = await allRows('push_subscriptions', 'endpoint,p256dh,auth,city_slug', 'endpoint');
  const counts = new Map();
  for (const [slug, city] of cities)
    counts.set(slug, newPlacesInCity(fresh, known, city).length);

  let delivered = 0, expired = 0, failed = 0;
  for (const sub of subscriptions) {
    const count = counts.get(sub.city_slug) || 0;
    if (!count) continue;
    const city = cities.get(sub.city_slug);
    const payload = JSON.stringify({
      title: `Новые заведения в ${city.name}`,
      body: `${count} новых заведений без указанного сайта. Откройте «Точку» и посмотрите их на карте.`,
      city: sub.city_slug
    });
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload,
        { TTL: 86400, timeout: 10000 });
      delivered++;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
        expired++;
      } else { failed++; console.warn(`Push delivery failed: ${error.statusCode || error.name}`); }
    }
  }
  await saveRows('push_seen_places', 'id', fresh.map(row => ({ id: row[0] })));
  console.log(`Новых заведений: ${fresh.length}; уведомлений: ${delivered}; устаревших подписок: ${expired}; ошибок: ${failed}`);
}

main().catch(error => {
  if (/Supabase (404|400).*push_(config|seen_places|subscriptions)|PGRST205/.test(error.message)) {
    console.error('Таблицы уведомлений ещё не созданы. Выполните supabase/push_notifications.sql в Supabase.');
  } else console.error(error.message);
  process.exitCode = 1;
});
