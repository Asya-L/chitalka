-- «Между строк»: таблица состояния и хранилище текстов книг.
-- Выполнить один раз в Supabase → SQL Editor.

create table if not exists public.mezhdu_state (
  user_id    uuid primary key references auth.users on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.mezhdu_state enable row level security;

drop policy if exists "own state" on public.mezhdu_state;
create policy "own state" on public.mezhdu_state
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Тексты книг: приватная корзина, у каждого пользователя своя папка <user_id>/
insert into storage.buckets (id, name, public, file_size_limit)
values ('books', 'books', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "books select own" on storage.objects;
drop policy if exists "books insert own" on storage.objects;
drop policy if exists "books update own" on storage.objects;
drop policy if exists "books delete own" on storage.objects;

create policy "books select own" on storage.objects for select to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "books insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "books update own" on storage.objects for update to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "books delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
