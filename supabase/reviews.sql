-- Отзывы о Точке: пишут вошедшие пользователи (один отзыв на аккаунт), на сайте видны только одобренные админом.
-- Запустить один раз: Supabase → SQL Editor → вставить весь файл → Run. Повторный запуск ничего не ломает.
-- Нужна функция tochka_is_admin() — она уже есть (её ставила админ-панель).

create table if not exists public.reviews (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade unique,
  name       text not null check (char_length(name) between 2 and 40),
  rating     int  not null check (rating between 1 and 5),
  body       text not null check (char_length(body) between 10 and 1000),
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.reviews enable row level security;

-- читать: одобренные — все, свой — автор, все — админ
drop policy if exists "reviews read approved" on public.reviews;
create policy "reviews read approved" on public.reviews for select to anon, authenticated using (approved);
drop policy if exists "reviews read own" on public.reviews;
create policy "reviews read own" on public.reviews for select to authenticated using (user_id = auth.uid());
drop policy if exists "reviews admin read" on public.reviews;
create policy "reviews admin read" on public.reviews for select to authenticated using ((select public.tochka_is_admin()));

-- писать и менять свой отзыв; одобрить себя нельзя — после правки отзыв снова ждёт проверки
drop policy if exists "reviews insert own" on public.reviews;
create policy "reviews insert own" on public.reviews for insert to authenticated
  with check (user_id = auth.uid() and approved = false);
drop policy if exists "reviews update own" on public.reviews;
create policy "reviews update own" on public.reviews for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and approved = false);
drop policy if exists "reviews delete own" on public.reviews;
create policy "reviews delete own" on public.reviews for delete to authenticated using (user_id = auth.uid());

-- админ одобряет и удаляет любые
drop policy if exists "reviews admin update" on public.reviews;
create policy "reviews admin update" on public.reviews for update to authenticated
  using ((select public.tochka_is_admin())) with check ((select public.tochka_is_admin()));
drop policy if exists "reviews admin delete" on public.reviews;
create policy "reviews admin delete" on public.reviews for delete to authenticated using ((select public.tochka_is_admin()));

revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant insert (name, rating, body), update (name, rating, body, approved), delete on public.reviews to authenticated;
