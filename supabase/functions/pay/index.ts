// Создать платёж: приложение вызывает эту функцию с токеном вошедшего пользователя,
// получает ссылку на страницу оплаты ЮKassa (СБП или карта) и открывает её.
// Подписку здесь не продлеваем — это делает yookassa-webhook, когда ЮKassa подтвердит оплату.
import { APP_URL, PRICE, cors, db, json, yookassa } from '../_shared/yookassa.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // кто платит — решает сервер по токену, а не приложение
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const user = token && await db('/auth/v1/user', { token }).catch(() => null);
    if (!user || !user.id) return json({ error: 'Нужно войти в аккаунт' }, 401);

    const pay = await yookassa('/payments', {
      amount: { value: PRICE.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: APP_URL + '?paid=1' },
      description: `Точка Pro на 1 месяц (${user.email})`,
      metadata: { user_id: user.id }
    });
    await db('/rest/v1/payments', { method: 'POST', body: { id: pay.id, user_id: user.id, amount: PRICE, status: pay.status }, prefer: 'return=minimal' });
    return json({ url: pay.confirmation.confirmation_url });
  } catch (e) {
    console.error(e);
    return json({ error: 'Не получилось создать платёж' }, 500);
  }
});
