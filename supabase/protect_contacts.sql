-- Защита базы салонов: телефоны, почта и соцсети заведений хранятся здесь, а не в открытых файлах data/*.json.
-- Отдаются только тем, у кого есть доступ: оплаченная подписка, пробный день после регистрации или админ.
-- Запустить один раз: Supabase → SQL Editor → вставить весь файл → Run. Повторный запуск ничего не ломает.
-- Пишет в таблицу только робот сборки базы (секретным ключом из GitHub Secrets), пользователи — только читают.

create table if not exists public.place_contacts (
  id         text primary key,          -- id заведения из OpenStreetMap, как в data/*.json: n123, w456, r789
  phone      text,
  email      text,
  tg         text,
  vk         text,
  inst       text,
  updated_at timestamptz not null default now()
);

alter table public.place_contacts enable row level security;

-- Есть ли у вошедшего пользователя доступ к контактам. Пробный период — 1 день (как PLAN.trialDays в app.js).
create or replace function public.tochka_has_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from auth.users u
      left join public.subscriptions s on s.user_id = u.id
      where u.id = auth.uid()
        and (s.paid_until > now() or coalesce(s.created_at, u.created_at) + interval '1 day' > now())
    )
    or coalesce(public.tochka_is_admin(), false)
  );
$$;

revoke all on function public.tochka_has_access() from public;
grant execute on function public.tochka_has_access() to authenticated;

drop policy if exists "contacts for pro" on public.place_contacts;
create policy "contacts for pro" on public.place_contacts
  for select to authenticated
  using ((select public.tochka_has_access()));

-- без входа — ничего; изменять таблицу из приложения нельзя никому
revoke all on public.place_contacts from anon;
revoke insert, update, delete on public.place_contacts from authenticated;
grant select on public.place_contacts to authenticated;
