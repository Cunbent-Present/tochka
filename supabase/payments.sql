-- Онлайн-оплата через ЮKassa: список платежей и продление подписки после оплаты.
-- Запустить один раз: Supabase → SQL Editor → вставить весь файл → Run. Повторный запуск ничего не ломает.
-- Пишут сюда только функции pay и yookassa-webhook (секретным ключом сервера), пользователи — ничего.

create table if not exists public.payments (
  id         text primary key,          -- id платежа в ЮKassa
  user_id    uuid not null references auth.users (id) on delete cascade,
  amount     numeric(10, 2) not null,
  months     int not null default 1,
  status     text not null,             -- pending → succeeded / canceled
  created_at timestamptz not null default now(),
  paid_at    timestamptz
);

alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;

-- Отметить платёж оплаченным и прибавить месяц к подписке. Второй вызов с тем же платежом ничего не меняет,
-- поэтому повторные уведомления ЮKassa не дают лишних месяцев. Месяц прибавляется к текущему сроку, если он ещё идёт.
create or replace function public.tochka_payment_succeeded(p_id text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  pay   public.payments;
  until timestamptz;
begin
  update public.payments set status = 'succeeded', paid_at = now()
    where id = p_id and status <> 'succeeded'
    returning * into pay;
  if not found then return null; end if;

  insert into public.subscriptions as s (user_id, created_at, paid_until)
    select u.id, u.created_at, now() + make_interval(months => pay.months) from auth.users u where u.id = pay.user_id
  on conflict (user_id) do update
    set paid_until = greatest(coalesce(s.paid_until, now()), now()) + make_interval(months => pay.months)
  returning paid_until into until;
  return until;
end;
$$;

revoke all on function public.tochka_payment_succeeded(text) from public, anon, authenticated;
grant execute on function public.tochka_payment_succeeded(text) to service_role;
