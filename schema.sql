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

-- ---------------------------------------------------------------------------
-- Напоминания: подписки на push-уведомления и журнал отправленного (выполнено в проекте).

create table if not exists public.mezhdu_push_subs (
  endpoint   text primary key,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now()
);
alter table public.mezhdu_push_subs enable row level security;
drop policy if exists "own subs" on public.mezhdu_push_subs;
create policy "own subs" on public.mezhdu_push_subs
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- доступ только у функции remind (ключ service_role), правил для пользователей нет
create table if not exists public.mezhdu_reminder_log (
  user_id uuid not null references auth.users on delete cascade,
  item    text not null,
  day     text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, item, day)
);
alter table public.mezhdu_reminder_log enable row level security;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- запуск функции remind раз в 5 минут; CRON_SECRET совпадает с секретом функции
select cron.schedule('mezhdu-remind', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://lvdjvywgqzkovbmwytbe.supabase.co/functions/v1/remind',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$$);
-- чистка журнала раз в неделю
select cron.schedule('mezhdu-remind-log-cleanup', '0 3 * * 1', $$
  delete from public.mezhdu_reminder_log where sent_at < now() - interval '30 days'
$$);
