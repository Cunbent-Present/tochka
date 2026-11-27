-- Реферальная программа: +7 дней пригласившему после подтверждённой регистрации,
-- ещё +30 дней после первой подтверждённой онлайн-оплаты приглашённого.
-- Выполнить в SQL Editor после создания таблиц subscriptions и payments.

create table if not exists public.referrals (
  referred_id uuid primary key references auth.users(id) on delete cascade,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  registered_at timestamptz not null default now(),
  first_payment_id text unique references public.payments(id),
  paid_reward_at timestamptz,
  constraint no_self_referral check (referred_id <> referrer_id)
);
create index if not exists referrals_referrer_idx on public.referrals(referrer_id);
alter table public.referrals enable row level security;
revoke all on public.referrals from anon, authenticated;

create or replace function public.tochka_claim_referral(inviter uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  new_user auth.users;
  inviter_user auth.users;
begin
  if auth.uid() is null or inviter is null or inviter = auth.uid() then return false; end if;
  select * into new_user from auth.users where id = auth.uid();
  select * into inviter_user from auth.users where id = inviter;
  if new_user.id is null or inviter_user.id is null
    or new_user.email_confirmed_at is null
    or new_user.created_at < now() - interval '48 hours'
    or inviter_user.created_at >= new_user.created_at
    or lower(new_user.email) = lower(inviter_user.email)
    or exists (select 1 from public.payments p where p.user_id = new_user.id and p.status = 'succeeded')
  then return false; end if;

  insert into public.referrals(referred_id, referrer_id)
    values (new_user.id, inviter) on conflict (referred_id) do nothing;
  if not found then return false; end if;

  insert into public.subscriptions as s(user_id, email, created_at, paid_until)
    values (inviter_user.id, inviter_user.email, inviter_user.created_at,
      greatest(now(), inviter_user.created_at + interval '3 days') + interval '7 days')
  on conflict (user_id) do update
    set paid_until = greatest(coalesce(s.paid_until, now()), now(), inviter_user.created_at + interval '3 days') + interval '7 days';
  return true;
end;
$$;
revoke all on function public.tochka_claim_referral(uuid) from public, anon;
grant execute on function public.tochka_claim_referral(uuid) to authenticated;

create or replace function public.tochka_referral_stats()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'registered', count(*),
    'paid', count(*) filter (where paid_reward_at is not null),
    'earned_days', count(*) * 7 + count(*) filter (where paid_reward_at is not null) * 30
  ) from public.referrals where referrer_id = auth.uid();
$$;
revoke all on function public.tochka_referral_stats() from public, anon;
grant execute on function public.tochka_referral_stats() to authenticated;

create or replace function public.tochka_reward_first_payment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  referral public.referrals;
  inviter_user auth.users;
begin
  if new.status <> 'succeeded' or old.status = 'succeeded' then return new; end if;
  select * into referral from public.referrals where referred_id = new.user_id for update;
  if referral.referred_id is null or referral.paid_reward_at is not null then return new; end if;
  -- Ранние или повторные платежи не считаются первой оплатой.
  if exists (select 1 from public.payments p where p.user_id = new.user_id and p.id <> new.id and p.status = 'succeeded') then return new; end if;
  select * into inviter_user from auth.users where id = referral.referrer_id;
  insert into public.subscriptions as s(user_id, email, created_at, paid_until)
    values (inviter_user.id, inviter_user.email, inviter_user.created_at,
      greatest(now(), inviter_user.created_at + interval '3 days') + interval '30 days')
  on conflict (user_id) do update
    set paid_until = greatest(coalesce(s.paid_until, now()), now(), inviter_user.created_at + interval '3 days') + interval '30 days';
  update public.referrals set first_payment_id = new.id, paid_reward_at = now() where referred_id = new.user_id;
  return new;
end;
$$;
drop trigger if exists tochka_reward_first_payment on public.payments;
create trigger tochka_reward_first_payment after update of status on public.payments
  for each row execute function public.tochka_reward_first_payment();

-- Для оплаты переводом: администратор нажимает «Оплата +1 мес» только после
-- получения денег. Другая кнопка «+1 мес» остаётся обычным продлением.
create or replace function public.tochka_admin_paid_month(target uuid)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  customer auth.users;
  inviter_user auth.users;
  referral public.referrals;
  until timestamptz;
begin
  if not coalesce(public.tochka_is_admin(), false) then raise exception 'NOT_ADMIN'; end if;
  select * into customer from auth.users where id = target;
  if customer.id is null then raise exception 'NO_USER'; end if;

  insert into public.subscriptions as s(user_id, email, created_at, paid_until)
    values (customer.id, customer.email, customer.created_at,
      greatest(now(), customer.created_at + interval '3 days') + interval '1 month')
  on conflict (user_id) do update
    set paid_until = greatest(coalesce(s.paid_until, now()), now(), customer.created_at + interval '3 days') + interval '1 month'
  returning paid_until into until;

  select * into referral from public.referrals where referred_id = target for update;
  if referral.referred_id is not null and referral.paid_reward_at is null
    and not exists (select 1 from public.payments p where p.user_id = target and p.status = 'succeeded')
  then
    select * into inviter_user from auth.users where id = referral.referrer_id;
    insert into public.subscriptions as s(user_id, email, created_at, paid_until)
      values (inviter_user.id, inviter_user.email, inviter_user.created_at,
        greatest(now(), inviter_user.created_at + interval '3 days') + interval '30 days')
    on conflict (user_id) do update
      set paid_until = greatest(coalesce(s.paid_until, now()), now(), inviter_user.created_at + interval '3 days') + interval '30 days';
    update public.referrals set paid_reward_at = now() where referred_id = target;
  end if;
  return until;
end;
$$;
revoke all on function public.tochka_admin_paid_month(uuid) from public, anon;
grant execute on function public.tochka_admin_paid_month(uuid) to authenticated;
