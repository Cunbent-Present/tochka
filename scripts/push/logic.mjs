// Same conservative distinction as the map: a social or booking page is not
// the business's own site. Unknown hosts are treated as own sites.
const SOCIAL_HOSTS = /(^|\.)(vk\.com|vk\.ru|vkontakte\.ru|instagram\.com|t\.me|telegram\.me|taplink\.(cc|ws|at|ru)|wa\.me|ok\.ru|youtube\.com|tiktok\.com|facebook\.com|dikidi\.(net|ru|app)|yclients\.com|2gis\.ru|2gis\.biz|clients\.site|business\.site|yandex\.ru|avito\.ru|linktr\.ee|zoon\.ru|flamp\.ru)$/i;

export function hasNoOwnSite(tags) {
  const site = String(tags.website || tags['contact:website'] || tags.url || '').split(/\s*;\s*/)[0];
  if (!site) return true;
  try {
    const host = new URL(/^[a-z]+:\/\//i.test(site) ? site : 'https://' + site).hostname.replace(/^www\./, '');
    return SOCIAL_HOSTS.test(host);
  } catch { return false; }
}

export function newPlacesInCity(rows, knownIds, city) {
  const found = new Map();
  for (const row of rows) {
    const [id, lat, lon, tags] = row;
    if (!id || knownIds.has(id) || found.has(id) || !tags?.name || !hasNoOwnSite(tags)) continue;
    if (lat >= city.s && lat <= city.n && lon >= city.w && lon <= city.e) found.set(id, row);
  }
  return [...found.values()];
}
