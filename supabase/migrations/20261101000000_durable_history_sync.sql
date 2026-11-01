begin;

-- Safe for both an existing project and a new project. No history is cleared.
create table if not exists public.youtube_watch_history (
  user_id uuid not null default auth.uid() references auth.users(id),
  str_ident varchar(255) not null,
  int_timestamp bigint not null,
  str_title text,
  int_count integer not null default 1,
  int_deleted_at bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, str_ident),
  constraint check_positive_count check (int_count > 0),
  constraint check_valid_timestamp check (int_timestamp >= 0)
);

alter table public.youtube_watch_history add column if not exists int_deleted_at bigint not null default 0;
alter table public.youtube_watch_history drop constraint if exists check_title_length;

-- Undated imports are still history. Do not fabricate a watch date or drop them.
alter table public.youtube_watch_history drop constraint if exists check_valid_timestamp;
alter table public.youtube_watch_history add constraint check_valid_timestamp check (int_timestamp >= 0);

create or replace function public.preserve_watch_history_progress()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- A client that has not observed a deletion cannot undo it with a stale
    -- queued write, import, repair upload, or clock that is ahead.
    if new.int_deleted_at < old.int_deleted_at then
      new.int_timestamp := old.int_timestamp;
    elsif new.int_deleted_at > old.int_deleted_at
      and new.int_timestamp <= new.int_deleted_at then
      -- Explicit deletion also covers watches not yet downloaded by its device.
      new.int_deleted_at := greatest(new.int_deleted_at, old.int_timestamp + 1);
    end if;
    new.int_deleted_at := greatest(old.int_deleted_at, new.int_deleted_at);
    if nullif(btrim(new.str_title), '') is null
      or (nullif(btrim(old.str_title), '') is not null and (
        old.int_timestamp > new.int_timestamp or
        (old.int_timestamp = new.int_timestamp and old.str_title collate "C" > new.str_title collate "C")
      )) then
      new.str_title := old.str_title;
    end if;
    new.int_timestamp := greatest(old.int_timestamp, new.int_timestamp);
    new.int_count := greatest(coalesce(old.int_count, 1), coalesce(new.int_count, 1));
    new.created_at := old.created_at;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke execute on function public.preserve_watch_history_progress() from public, anon;
drop trigger if exists preserve_watch_history_progress on public.youtube_watch_history;
create trigger preserve_watch_history_progress before insert or update
  on public.youtube_watch_history for each row execute function public.preserve_watch_history_progress();

alter table public.youtube_watch_history enable row level security;
drop policy if exists "Users can view their watch history" on public.youtube_watch_history;
create policy "Users can view their watch history" on public.youtube_watch_history
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their watch history" on public.youtube_watch_history;
create policy "Users can insert their watch history" on public.youtube_watch_history
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their watch history" on public.youtube_watch_history;
create policy "Users can update their watch history" on public.youtube_watch_history
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their watch history" on public.youtube_watch_history;
revoke all on public.youtube_watch_history from anon;
revoke delete, truncate on public.youtube_watch_history from public;
revoke delete, truncate on public.youtube_watch_history from authenticated;
grant select, insert, update on public.youtube_watch_history to authenticated;

create or replace function public.watchmarker_sync_version()
returns integer language sql security invoker set search_path = '' as $$ select 2; $$;
revoke execute on function public.watchmarker_sync_version() from public, anon;
grant execute on function public.watchmarker_sync_version() to authenticated;
notify pgrst, 'reload schema';
commit;
