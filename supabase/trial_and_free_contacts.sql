-- Выполнить один раз в Supabase SQL Editor до публикации интерфейса с 3 днями.
-- Доступ к Pro: 3 дня с момента регистрации. После него каждый аккаунт может открыть
-- ещё три разных защищённых контакта. Повторный просмотр того же места лимит не тратит.

create or replace function public.tochka_has_access()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (
      select 1 from auth.users u
      left join public.subscriptions s on s.user_id = u.id
      where u.id = auth.uid()
        and (s.paid_until > now() or coalesce(s.created_at, u.created_at) + interval '3 days' > now())
    ) or coalesce(public.tochka_is_admin(), false)
  );
$$;
revoke all on function public.tochka_has_access() from public, anon;
grant execute on function public.tochka_has_access() to authenticated;

create table if not exists public.tochka_free_contact_reveals (
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id text not null references public.place_contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
alter table public.tochka_free_contact_reveals enable row level security;
revoke all on public.tochka_free_contact_reveals from public, anon, authenticated;

create or replace function public.tochka_free_contacts_remaining()
returns integer language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then 0 else greatest(0, 3 - (
    select count(*)::integer from public.tochka_free_contact_reveals where user_id = auth.uid()
  )) end;
$$;
revoke all on function public.tochka_free_contacts_remaining() from public, anon;
grant execute on function public.tochka_free_contacts_remaining() to authenticated;

create or replace function public.tochka_free_contact_ids()
returns table(place_id text) language sql stable security definer set search_path = public as $$
  select r.place_id from public.tochka_free_contact_reveals r where r.user_id = auth.uid();
$$;
revoke all on function public.tochka_free_contact_ids() from public, anon;
grant execute on function public.tochka_free_contact_ids() to authenticated;

create or replace function public.tochka_reveal_free_contact(p_place_id text)
returns table(phone text, email text, tg text, vk text, inst text)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'LOGIN_REQUIRED'; end if;
  if p_place_id is null or length(p_place_id) > 100 then raise exception 'BAD_PLACE'; end if;
  if not exists(select 1 from public.place_contacts c where c.id = p_place_id) then
    raise exception 'NO_CONTACT';
  end if;
  if not public.tochka_has_access() then
    -- Serialize quota checks for concurrent requests from the same account.
    perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
    if not exists(select 1 from public.tochka_free_contact_reveals r where r.user_id = uid and r.place_id = p_place_id) then
      if (select count(*) from public.tochka_free_contact_reveals r where r.user_id = uid) >= 3 then
        raise exception 'FREE_CONTACT_LIMIT';
      end if;
      insert into public.tochka_free_contact_reveals(user_id, place_id) values(uid, p_place_id);
    end if;
  end if;
  return query select c.phone, c.email, c.tg, c.vk, c.inst
    from public.place_contacts c where c.id = p_place_id;
end;
$$;
revoke all on function public.tochka_reveal_free_contact(text) from public, anon;
grant execute on function public.tochka_reveal_free_contact(text) to authenticated;
