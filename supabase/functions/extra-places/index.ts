// Public map data for extra categories. Contacts are returned only after
// Supabase verifies the caller's subscription or administrator status.
const base = Deno.env.get('SUPABASE_URL');
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const categories = {
  pet: 'shop=pet', flowers: 'shop=florist', cafe: 'amenity=cafe',
  bakery: 'shop=bakery', restaurant: 'amenity=restaurant', vet: 'amenity=veterinary'
};
const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Content-Type': 'application/json' };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });

async function hasAccess(req) {
  const bearer = req.headers.get('Authorization') || '';
  if (!bearer.startsWith('Bearer ')) return false;
  const auth = { apikey: service, Authorization: bearer };
  const user = await fetch(base + '/auth/v1/user', { headers: auth });
  if (!user.ok) return false;
  const access = await fetch(base + '/rest/v1/rpc/tochka_has_access', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}'
  });
  return access.ok && await access.json() === true;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    const { category, bounds } = await req.json();
    if (!Object.hasOwn(categories, category) || !Array.isArray(bounds) || bounds.length !== 4 ||
        !bounds.every(n => typeof n === 'number' && Number.isFinite(n))) return reply({ error: 'Invalid search' }, 400);
    const [south, west, north, east] = bounds;
    if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east ||
        north - south > .17 || east - west > .25) return reply({ error: 'Invalid bounds' }, 400);
    const [key, value] = categories[category].split('=');
    const query = `[out:json][timeout:12];nwr["${key}"="${value}"](${bounds.map(n => n.toFixed(3)).join(',')});out center tags;`;
    let data;
    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 14000);
        try {
          const result = await fetch(endpoint, { method: 'POST', body: 'data=' + encodeURIComponent(query),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: controller.signal });
          if (!result.ok) continue;
          data = await result.json(); break;
        } finally { clearTimeout(timer); }
      } catch { /* try the second endpoint */ }
    }
    if (!data) return reply({ error: 'Map search unavailable' }, 503);
    const access = await hasAccess(req).catch(() => false);
    const elements = (data.elements || []).slice(0, 400).map(el => {
      const tags = { ...el.tags };
      for (const field of ['phone', 'email', 'website:contact', 'contact:phone', 'contact:email', 'contact:vk',
        'contact:telegram', 'contact:instagram', 'mobile', 'fax']) if (!access) delete tags[field];
      if (!access) for (const field of Object.keys(tags)) if (/^(contact:|phone|email|mobile|fax)/i.test(field)) delete tags[field];
      return { type: el.type, id: el.id, lat: el.lat, lon: el.lon, center: el.center, tags };
    });
    return reply({ elements });
  } catch { return reply({ error: 'Search failed' }, 500); }
});
