-- Продление подписки на дни из админ-панели: кнопки «+1 день» и «+7 дней» (а «+1 мес» и «Отключить» — как раньше, admin_extend).
-- Запустить один раз: Supabase → SQL Editor → вставить весь файл → Run. Повторный запуск ничего не ломает.
-- Вызывать может только админ (tochka_is_admin — её ставила админ-панель). Дни прибавляются к текущему сроку, если он ещё идёт.

create or replace function public.admin_extend_days(target uuid, days int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  until timestamptz;
begin
  if not coalesce(public.tochka_is_admin(), false) then
    raise exception 'NOT_ADMIN';
  end if;
  if days is null or days < 1 or days > 366 then
    raise exception 'BAD_DAYS';
  end if;

  insert into public.subscriptions as s (user_id, created_at, paid_until)
    select u.id, u.created_at, now() + make_interval(days => days) from auth.users u where u.id = target
  on conflict (user_id) do update
    set paid_until = greatest(coalesce(s.paid_until, now()), now()) + make_interval(days => days)
  returning paid_until into until;

  if until is null then
    raise exception 'NO_USER';
  end if;
  return until;
end;
$$;

revoke all on function public.admin_extend_days(uuid, int) from public, anon;
grant execute on function public.admin_extend_days(uuid, int) to authenticated;
