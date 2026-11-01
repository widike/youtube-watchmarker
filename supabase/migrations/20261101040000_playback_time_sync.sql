begin;

create table if not exists public.youtube_watch_time (
  user_id uuid not null default public.watchmarker_history_owner() references auth.users(id),
  snapshot_id text not null check (length(snapshot_id) between 1 and 1024),
  event_id text not null check (length(event_id) between 1 and 1024),
  str_ident varchar(11) not null check (str_ident ~ '^[A-Za-z0-9_-]{11}$'),
  str_title text not null default '' check (length(str_title) <= 2000),
  minute_at bigint not null check (minute_at > 0 and minute_at % 60000 = 0),
  from_at bigint not null,
  to_at bigint not null,
  milliseconds bigint not null check (milliseconds between 1 and 60000),
  duration_seconds double precision check (duration_seconds > 0 and duration_seconds < 'Infinity'::float8),
  media_ranges jsonb not null default '[]'::jsonb check (jsonb_typeof(media_ranges) = 'array' and jsonb_array_length(media_ranges) <= 500),
  event_watched_at bigint check (event_watched_at > 0),
  observed_deletion bigint not null default 0 check (observed_deletion >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id, snapshot_id),
  check (from_at >= minute_at and to_at > from_at and to_at <= minute_at + 60000 and milliseconds <= to_at - from_at)
);
create index if not exists youtube_watch_time_timeline on public.youtube_watch_time(user_id, minute_at);
alter table public.youtube_watch_time enable row level security;
revoke all on public.youtube_watch_time from anon, authenticated;
grant select, insert, update on public.youtube_watch_time to authenticated;
drop policy if exists "Read shared playback time" on public.youtube_watch_time;
create policy "Read shared playback time" on public.youtube_watch_time for select to authenticated
  using ((select public.watchmarker_history_owner()) = user_id);
drop policy if exists "Insert shared playback time" on public.youtube_watch_time;
create policy "Insert shared playback time" on public.youtube_watch_time for insert to authenticated
  with check ((select public.watchmarker_history_owner()) = user_id);
drop policy if exists "Update shared playback time" on public.youtube_watch_time;
create policy "Update shared playback time" on public.youtube_watch_time for update to authenticated
  using ((select public.watchmarker_history_owner()) = user_id)
  with check ((select public.watchmarker_history_owner()) = user_id);

create or replace function public.preserve_playback_time()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare r jsonb;
begin
  if tg_op = 'UPDATE' then
    if (new.user_id, new.snapshot_id, new.event_id, new.str_ident, new.minute_at, new.from_at, new.event_watched_at, new.observed_deletion)
       is distinct from (old.user_id, old.snapshot_id, old.event_id, old.str_ident, old.minute_at, old.from_at, old.event_watched_at, old.observed_deletion)
      then raise exception 'Playback identity is immutable'; end if;
    -- Replicas may resend older snapshots after a lost reply or restoration.
    if new.milliseconds <= old.milliseconds then return old; end if;
    if new.to_at < old.to_at then raise exception 'Playback time cannot move backwards'; end if;
    new.created_at := old.created_at;
  end if;
  for r in select value from jsonb_array_elements(new.media_ranges) loop
    if jsonb_typeof(r) <> 'array' or jsonb_array_length(r) <> 2
       or jsonb_typeof(r->0) <> 'number' or jsonb_typeof(r->1) <> 'number'
       or new.duration_seconds is null or (r->>0)::float8 < 0
       or (r->>1)::float8 <= (r->>0)::float8 or (r->>1)::float8 > new.duration_seconds
      then raise exception 'Invalid playback coverage'; end if;
  end loop;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke execute on function public.preserve_playback_time() from public, anon;
drop trigger if exists preserve_playback_time on public.youtube_watch_time;
create trigger preserve_playback_time before insert or update on public.youtube_watch_time
  for each row execute function public.preserve_playback_time();

create or replace function public.watchmarker_sync_version()
returns integer language sql stable security invoker set search_path = '' as $$ select 4; $$;
revoke execute on function public.watchmarker_sync_version() from public, anon;
grant execute on function public.watchmarker_sync_version() to authenticated;
notify pgrst, 'reload schema';
commit;
