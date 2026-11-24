-- Push-уведомления о новых заведениях. Выполнить один раз в Supabase SQL Editor.
-- Клиент управляет только своими подписками; ключ отправки и список уже известных
-- заведений доступны только серверному ключу GitHub Actions.

create table if not exists public.push_config (
  key text primary key,
  value text not null
);
alter table public.push_config enable row level security;
drop policy if exists "read public push key" on public.push_config;
create policy "read public push key" on public.push_config
  for select to anon, authenticated using (key = 'vapid_public');
grant select on public.push_config to anon, authenticated;
revoke insert, update, delete on public.push_config from anon, authenticated;

create table if not exists public.push_seen_places (
  id text primary key
);
alter table public.push_seen_places enable row level security;
revoke all on public.push_seen_places from anon, authenticated;

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  city_slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_city_idx on public.push_subscriptions(city_slug);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions select" on public.push_subscriptions;
drop policy if exists "own push subscriptions insert" on public.push_subscriptions;
drop policy if exists "own push subscriptions update" on public.push_subscriptions;
drop policy if exists "own push subscriptions delete" on public.push_subscriptions;
create policy "own push subscriptions select" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own push subscriptions insert" on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own push subscriptions update" on public.push_subscriptions
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "own push subscriptions delete" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.push_subscriptions from anon;
