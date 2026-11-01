begin;

-- Video rows are a materialized summary. Every dated watch has its own row;
-- timestamps are epoch milliseconds in UTC, formatted in the viewer's locale.
alter table public.youtube_watch_history add column if not exists int_imported_count integer;

create table if not exists public.youtube_watch_events (
  user_id uuid not null default auth.uid(),
  str_ident varchar(255) not null,
  event_id text not null check (length(event_id) between 1 and 1024),
  watched_at bigint not null,
  source text not null check (source in ('playback', 'saved', 'receipt')),
  precision text not null check (precision in ('exact', 'day', 'inferred')),
  observed_deletion bigint not null default 0 check (observed_deletion >= 0),
  primary key (user_id, str_ident, event_id),
  foreign key (user_id, str_ident) references public.youtube_watch_history(user_id, str_ident),
  check ((source = 'receipt' and watched_at = 0) or (source <> 'receipt' and watched_at > 0))
);
create index if not exists youtube_watch_events_timeline
  on public.youtube_watch_events(user_id, watched_at desc, event_id);
create index if not exists youtube_watch_events_sync
  on public.youtube_watch_events(user_id, event_id, str_ident);

-- Only rows without the new baseline need conversion. Reapplying setup must
-- never turn a newer summary timestamp into a duplicate synthetic watch.
insert into public.youtube_watch_events(user_id, str_ident, event_id, watched_at, source, precision, observed_deletion)
select user_id, str_ident, 'saved:' || str_ident || ':' || int_timestamp,
  int_timestamp, 'saved', 'inferred', case when int_timestamp > int_deleted_at then int_deleted_at else 0 end
from public.youtube_watch_history where int_imported_count is null and int_timestamp > 0
on conflict do nothing;
update public.youtube_watch_history
  set int_imported_count = int_count
  where int_imported_count is null;
alter table public.youtube_watch_history alter column int_imported_count set default 0;
alter table public.youtube_watch_history alter column int_imported_count set not null;
alter table public.youtube_watch_history drop constraint if exists check_imported_count;
alter table public.youtube_watch_history add constraint check_imported_count check (int_imported_count >= 0);

create or replace function public.preserve_watch_history_progress()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.int_deleted_at < old.int_deleted_at then
      new.int_timestamp := old.int_timestamp;
    elsif new.int_deleted_at > old.int_deleted_at and new.int_timestamp <= new.int_deleted_at then
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
    new.int_imported_count := greatest(old.int_imported_count, new.int_imported_count);
    new.int_count := greatest(old.int_count, new.int_count);
    new.created_at := old.created_at;
  end if;
  new.int_count := greatest(new.int_count, greatest(new.int_imported_count, (
    select count(*) from public.youtube_watch_events
    where user_id = new.user_id and str_ident = new.str_ident and source = 'saved'
  )) + (
    select count(*) from public.youtube_watch_events
    where user_id = new.user_id and str_ident = new.str_ident and source = 'playback'
  ));
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.summarize_watch_event()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Serialize concurrent devices before calculating the union's count.
  perform 1 from public.youtube_watch_history
    where user_id = new.user_id and str_ident = new.str_ident for update;
  update public.youtube_watch_history set int_count = greatest(int_count, greatest(int_imported_count, (
    select count(*) from public.youtube_watch_events
    where user_id = new.user_id and str_ident = new.str_ident and source = 'saved'
  )) + (
    select count(*) from public.youtube_watch_events
    where user_id = new.user_id and str_ident = new.str_ident and source = 'playback'
  )) where user_id = new.user_id and str_ident = new.str_ident;
  return new;
end;
$$;
revoke execute on function public.summarize_watch_event() from public, anon;
drop trigger if exists summarize_watch_event on public.youtube_watch_events;
create trigger summarize_watch_event after insert on public.youtube_watch_events
  for each row execute function public.summarize_watch_event();

alter table public.youtube_watch_events enable row level security;
drop policy if exists "Read own watches" on public.youtube_watch_events;
create policy "Read own watches" on public.youtube_watch_events for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Append own watches" on public.youtube_watch_events;
create policy "Append own watches" on public.youtube_watch_events for insert to authenticated
  with check ((select auth.uid()) = user_id);
revoke all on public.youtube_watch_events from public, anon, authenticated;
grant select, insert on public.youtube_watch_events to authenticated;

create or replace function public.watchmarker_sync_version()
returns integer language sql security invoker set search_path = '' as $$ select 3; $$;
revoke execute on function public.watchmarker_sync_version() from public, anon;
grant execute on function public.watchmarker_sync_version() to authenticated;
notify pgrst, 'reload schema';
commit;
