// Общее для функций оплаты: запросы к ЮKassa и к своей базе Supabase.
// Секреты задаются в Supabase → Edge Functions → Secrets (в репозиторий не попадают):
//   YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY — из личного кабинета ЮKassa (Интеграция → Ключи API)
//   APP_URL — куда вернуть человека после оплаты (необязательно)
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.

export const PRICE = 290;   // ₽ за месяц — как PLAN.price в app.js
export const APP_URL = Deno.env.get('APP_URL') || 'https://tochka-klient.ru/';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const YK_AUTH = 'Basic ' + btoa(`${Deno.env.get('YOOKASSA_SHOP_ID')}:${Deno.env.get('YOOKASSA_SECRET_KEY')}`);

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type'
};
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export async function yookassa(path: string, body?: unknown) {
  const r = await fetch('https://api.yookassa.ru/v3' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: YK_AUTH, 'Content-Type': 'application/json', ...(body ? { 'Idempotence-Key': crypto.randomUUID() } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`ЮKassa ${r.status}: ${data && (data.description || data.code)}`);
  return data;
}

// запрос к своей базе с правами сервера (мимо ограничений RLS)
export async function db(path: string, { method = 'GET', body, token = SB_KEY, prefer }: { method?: string; body?: unknown; token?: string; prefer?: string } = {}) {
  const r = await fetch(SB_URL + path, {
    method,
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${data && (data.message || data.msg)}`);
  return data;
}
