/* Сведения о сайте: наличие ссылки и результат проверки — разные факты. */
(function (root) {
  'use strict';
  const booking = /(^|\.)(taplink\.(cc|ws|at|ru)|yclients\.com|dikidi\.(net|ru|app)|linktr\.ee|booksy\.com|sonline\.su|easyweek\.(io|ru)|arnica\.pro|bio\.link|mssg\.me|hipolink\.(me|net))$/i;
  const directory = /(^|\.)(2gis\.(ru|biz)|clients\.site|business\.site|yandex\.ru|avito\.ru|zoon\.ru|flamp\.ru)$/i;
  const social = /(^|\.)(vk\.com|vk\.ru|vkontakte\.ru|instagram\.com|t\.me|telegram\.me|wa\.me|ok\.ru|youtube\.com|tiktok\.com|facebook\.com)$/i;
  function safeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || /^(?!https?:)[a-z][a-z\d+.-]*:/i.test(raw)) return '';
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
      return url.hostname.includes('.') && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function type(value) {
    const url = safeUrl(value);
    if (!url) return 'none';
    const host = new URL(url).hostname;
    return booking.test(host) ? 'booking' : directory.test(host) ? 'directory' : social.test(host) ? 'social' : 'own';
  }
  function sameUrl(a, b) { return !!safeUrl(a) && safeUrl(a) === safeUrl(b); }
  function evidence(p) {
    // Старые отчёты не содержат URL: они относились к исходной ссылке из OSM.
    const check = p.siteCheck;
    return check && sameUrl(check.url || p.sourceSite || p.site, p.site) ? check : null;
  }
  function kind(p) {
    const t = type(p.site), check = evidence(p);
    if (check?.status === 'dead' && (t === 'own' || t === 'booking')) return 'none';
    return t === 'own' ? 'own' : t === 'none' ? 'none' : 'social';
  }
  function describe(p, now = Date.now()) {
    const url = safeUrl(p.site), t = type(p.site), check = evidence(p);
    const found = p.chk && ['own', 'rec'].includes(p.chk.s) && sameUrl(p.chk.url, p.site);
    const date = check?.date || p.chk?.d || '';
    const stamp = Date.parse(date);
    const stale = Number.isFinite(stamp) && now - stamp > 30 * 864e5;
    const source = found ? (p.chk.how === 'v' ? 'Ссылка из сообщества ВКонтакте' : 'Найден по названию с проверкой совпадения')
      : url ? (p.mine ? 'Добавлено вами' : 'Ссылка из OpenStreetMap') : '';
    let label, detail;
    if (check?.status === 'dead') {
      label = 'Ссылка не работает';
      detail = 'При проверке страница была недоступна или домен припаркован. У заведения может быть другой сайт.';
    } else if (t === 'own') {
      label = check?.status === 'ok' ? 'Сайт открывался' : 'Сайт указан';
      detail = check?.status === 'ok' ? 'Доступность подтверждена на дату проверки. Сверьте название и адрес заведения.'
        : check?.status === 'unknown' ? 'Проверить доступность не удалось. Это не означает, что сайт закрыт.' : 'Доступность этой ссылки пока не проверена.';
    } else if (t !== 'none') {
      label = { booking: 'Онлайн-запись / мини-страница', directory: 'Страница в каталоге', social: 'Страница в соцсети' }[t];
      detail = 'Эта ссылка не является отдельным сайтом. Наличие другого сайта пока не подтверждено.';
      if (check?.status === 'ok') detail += ' Ссылка открывалась при проверке.';
      if (check?.status === 'unknown') detail += ' Доступность ссылки проверить не удалось.';
    } else if (p.chk?.s === 'none') {
      label = 'Сайт не найден при проверке';
      detail = 'Проверка не охватывает весь интернет и не доказывает отсутствие сайта.';
    } else if (p.chk?.s === 'unknown') {
      label = 'Проверка не завершена';
      detail = 'Часть источников не ответила. Наличие сайта пока неизвестно.';
    } else {
      label = !p.site && (safeUrl(p.brandSite) || safeUrl(p.operatorSite)) ? 'Есть сайт бренда или оператора' : 'Нет данных о сайте';
      detail = p.site ? 'В источнике некорректная ссылка. Сайт нужно уточнить.' : label === 'Нет данных о сайте' ? 'В источнике нет ссылки. Сайт может существовать.' : 'Сайт конкретного заведения не указан. Сверьте филиал на сайте сети.';
    }
    const methods = { d: 'Варианты домена по названию', v: 'Поле «Сайт» известного сообщества ВК', dv: 'Варианты домена и известное сообщество ВК' };
    return { label, detail, url, type: t, source, date, stale, method: methods[p.chk?.how] || '', status: check?.status || '' };
  }
  function searchUrl(p) {
    return 'https://yandex.ru/search/?text=' + encodeURIComponent([p.name, p.city, p.addr, 'официальный сайт'].filter(Boolean).join(' '));
  }
  function directoryUrls(p) {
    const query = [p.name, p.city, p.addr].filter(Boolean).join(' ');
    return {
      yandex: 'https://yandex.ru/maps/?text=' + encodeURIComponent(query),
      gis: 'https://2gis.ru/search/' + encodeURIComponent(query)
    };
  }
  const api = { safeUrl, type, sameUrl, evidence, kind, describe, searchUrl, directoryUrls };
  root.TochkaSiteInfo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
