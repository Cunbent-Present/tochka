'use strict';

// Push is opt-in and tied to the signed-in user's selected profile city.
const pushButton = $('#pushToggle'), pushState = $('#pushState');
let pushPublicKey = '', pushActive = false, pushBusy = false;
const supportsPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const pushEndpointFilter = endpoint => `endpoint=eq.${encodeURIComponent(endpoint)}`;

function selectedPushCity() {
  return dbIndex.find(city => city.name === workspacePerson.city);
}

function pushKeyBytes(key) {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function currentPushSubscription() {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function refreshPushUi() {
  if (pushBusy) return;
  pushButton.disabled = true;
  pushButton.setAttribute('aria-pressed', 'false');
  if (!supportsPush) {
    pushState.textContent = /iPhone|iPad/i.test(navigator.userAgent)
      ? 'На iPhone добавьте «Точку» на экран «Домой», затем откройте её оттуда.'
      : 'Этот браузер не поддерживает push-уведомления.';
    pushButton.textContent = 'Уведомления недоступны';
    return;
  }
  if (!authOn()) {
    pushState.textContent = 'Уведомления станут доступны после настройки входа.';
    pushButton.textContent = 'Уведомления недоступны';
    return;
  }
  if (!session) {
    pushActive = false;
    pushState.textContent = 'Войдите в аккаунт, чтобы получать уведомления на этом устройстве.';
    pushButton.textContent = 'Войти и настроить';
    pushButton.disabled = false;
    return;
  }
  if (Notification.permission === 'denied') {
    pushState.textContent = 'Уведомления заблокированы. Разрешите их в настройках браузера или телефона, затем откройте «Точку» снова.';
    pushButton.textContent = 'Уведомления заблокированы';
    return;
  }
  try {
    await dbReady;
    const city = selectedPushCity();
    if (!city) throw new Error('Для выбранного города пока нет обновляемой базы.');
    if (!pushPublicKey) {
      const rows = await api('/rest/v1/push_config?select=value&key=eq.vapid_public');
      pushPublicKey = rows?.[0]?.value || '';
    }
    if (!pushPublicKey) throw new Error('Отправка уведомлений ещё настраивается.');
    const sub = await currentPushSubscription();
    const rows = sub ? await api(`/rest/v1/push_subscriptions?select=city_slug&${pushEndpointFilter(sub.endpoint)}`, { token: await token() }) : [];
    pushActive = !!rows?.length;
    pushState.textContent = pushActive
      ? `Включены для города ${city.name}. После сохранения другого города настройка обновится сама.`
      : Notification.permission === 'granted'
        ? `Выбран город ${city.name}. Разрешение получено; осталось включить уведомления на этом устройстве.`
        : `Выбран город ${city.name}. После нажатия кнопки телефон попросит разрешение на уведомления.`;
    pushButton.textContent = pushActive ? 'Выключить уведомления'
      : Notification.permission === 'granted' ? 'Включить уведомления' : 'Разрешить уведомления';
    pushButton.setAttribute('aria-pressed', String(pushActive));
    pushButton.disabled = false;
  } catch (error) {
    pushState.textContent = /^(Для выбранного города|Отправка уведомлений)/.test(error.message)
      ? error.message : 'Уведомления пока настраиваются. Попробуйте позже.';
    pushButton.textContent = 'Настройка недоступна';
  }
}

async function storePushSubscription(sub, citySlug) {
  const t = await token();
  if (!t || !session) throw new Error('Войдите в аккаунт ещё раз.');
  const { endpoint, keys } = sub.toJSON();
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error('Браузер не выдал ключи подписки.');
  const path = `/rest/v1/push_subscriptions?${pushEndpointFilter(endpoint)}`;
  const existing = await api(`${path}&select=endpoint`, { token: t });
  const body = { endpoint, user_id: session.user.id, p256dh: keys.p256dh, auth: keys.auth, city_slug: citySlug };
  if (existing?.length) await api(path, { method: 'PATCH', token: t, body });
  else await api('/rest/v1/push_subscriptions', { method: 'POST', token: t, body });
}

pushButton.onclick = async () => {
  if (!session) return showGate('email');
  if (pushBusy || !pushPublicKey) return;
  pushBusy = true; pushButton.disabled = true;
  try {
    const city = selectedPushCity();
    if (!city) throw new Error('Сначала выберите город в профиле.');
    if (pushActive) {
      const sub = await currentPushSubscription();
      if (sub) {
        await api(`/rest/v1/push_subscriptions?${pushEndpointFilter(sub.endpoint)}`, { method: 'DELETE', token: await token() });
        await sub.unsubscribe();
      }
      pushActive = false;
      toast('Уведомления выключены');
    } else {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') throw new Error('Браузер не разрешил уведомления.');
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: pushKeyBytes(pushPublicKey)
      });
      await storePushSubscription(sub, city.slug);
      pushActive = true;
      toast(`Уведомления для города ${city.name} включены`);
    }
  } catch (error) { toast('Не получилось настроить уведомления: ' + error.message, 4200); }
  finally { pushBusy = false; refreshPushUi(); }
};

$('#workspaceProfileForm').addEventListener('submit', async () => {
  if (pushActive) {
    try {
      await dbReady;
      const sub = await currentPushSubscription(), city = selectedPushCity();
      if (sub && city) await storePushSubscription(sub, city.slug);
    } catch { toast('Город сохранён, но уведомления не обновились. Попробуйте ещё раз.', 3600); }
  }
  refreshPushUi();
});

addEventListener('tochka-auth-changed', () => refreshPushUi());
addEventListener('tochka-sign-out', event => {
  if (!supportsPush) return;
  currentPushSubscription().then(async sub => {
    if (!sub) return;
    try {
      if (event.detail?.token) await api(`/rest/v1/push_subscriptions?${pushEndpointFilter(sub.endpoint)}`,
        { method: 'DELETE', token: event.detail.token });
    } catch { /* сервер удалит устаревшую подписку после отказа push-сервиса */ }
    await sub.unsubscribe();
    pushActive = false;
  }).catch(() => {});
  setTimeout(refreshPushUi, 0);
});

// A notification opens the exact city rather than an unrelated map position.
const pushCitySlug = new URLSearchParams(location.search).get('pushCity');
if (pushCitySlug) dbReady.then(() => {
  const city = dbIndex.find(item => item.slug === pushCitySlug);
  if (!city) return;
  go('v-map'); flyToCity(city.lat, city.lon);
  const url = new URL(location.href); url.searchParams.delete('pushCity');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
});

if (supportsPush) addEventListener('load', () => navigator.serviceWorker.ready.then(refreshPushUi).catch(() => {}));
else refreshPushUi();
