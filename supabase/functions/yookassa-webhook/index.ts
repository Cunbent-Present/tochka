// Уведомления ЮKassa об оплате. Адрес этой функции указывается в кабинете ЮKassa → Интеграция → HTTP-уведомления.
// Уведомлению на слово не верим: по id заново спрашиваем платёж у самой ЮKassa и проверяем сумму.
// Ответ не 200 — ЮKassa повторит уведомление позже; повтор не даёт лишних месяцев (см. payments.sql).
import { PRICE, db, yookassa } from '../_shared/yookassa.ts';

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('ok');
  try {
    const note = await req.json().catch(() => null);
    const id = note && note.object && note.object.id;
    if (!id) return new Response('ok');

    const pay = await yookassa('/payments/' + encodeURIComponent(id));
    const userId = pay.metadata && pay.metadata.user_id;
    if (!userId) return new Response('ok');   // платёж не из Точки

    // строки о платеже могло не быть, если приложение не успело её записать
    await db('/rest/v1/payments?on_conflict=id', { method: 'POST', body: { id: pay.id, user_id: userId, amount: Number(pay.amount.value), status: 'pending' }, prefer: 'resolution=ignore-duplicates,return=minimal' });

    if (pay.status === 'succeeded' && pay.paid && pay.amount.currency === 'RUB' && Number(pay.amount.value) >= PRICE) {
      const until = await db('/rest/v1/rpc/tochka_payment_succeeded', { method: 'POST', body: { p_id: pay.id } });
      console.log(`Оплата ${pay.id}: подписка до ${until}`);
    } else if (pay.status === 'canceled') {
      await db('/rest/v1/payments?id=eq.' + encodeURIComponent(pay.id), { method: 'PATCH', body: { status: 'canceled' }, prefer: 'return=minimal' });
    }
    return new Response('ok');
  } catch (e) {
    console.error(e);
    return new Response('error', { status: 500 });
  }
});
