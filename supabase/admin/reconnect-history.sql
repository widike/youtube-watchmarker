-- Administrator-only recovery. Set watchmarker.recovery_source and
-- watchmarker.recovery_target to the two explicitly reviewed owner UUIDs first.
-- Original rows remain retained under the source owner for recovery/audit.
begin;
lock table public.youtube_watch_history, public.youtube_watch_events,
  public.youtube_watch_time, public.youtube_video_durations,
  private.watchmarker_devices in share row exclusive mode;

create table if not exists private.watchmarker_history_recoveries (
  source_owner uuid not null,
  target_owner uuid not null,
  recovered_at timestamptz not null default now(),
  source_videos bigint not null,
  source_events bigint not null,
  primary key (source_owner,target_owner)
);
alter table private.watchmarker_history_recoveries enable row level security;
revoke all on private.watchmarker_history_recoveries from public,anon,authenticated;

do $$
declare
  source_owner uuid := current_setting('watchmarker.recovery_source')::uuid;
  target_owner uuid := current_setting('watchmarker.recovery_target')::uuid;
begin
  if source_owner = target_owner or source_owner is null or target_owner is null
    or not exists(select 1 from auth.users where id=source_owner)
    or not exists(select 1 from auth.users where id=target_owner)
    then raise exception 'Select two valid, reviewed history owners'; end if;
  if exists(select 1 from private.watchmarker_devices where owner_id=source_owner and device_id<>source_owner)
    or exists(select 1 from private.watchmarker_devices where device_id=source_owner and owner_id not in (source_owner,target_owner))
    then raise exception 'Recovery would affect another linked history'; end if;
  if exists(select 1 from public.youtube_watch_events s join public.youtube_watch_events t
    on t.str_ident=s.str_ident and t.event_id=s.event_id
    where s.user_id=source_owner and t.user_id=target_owner
    and ((s.watched_at,s.source,s.observed_deletion) is distinct from (t.watched_at,t.source,t.observed_deletion)
      or (s.source<>'saved' and s.precision<>t.precision)))
    then raise exception 'Conflicting immutable watch identities require review'; end if;

  insert into private.watchmarker_history_recoveries(source_owner,target_owner,source_videos,source_events)
  select source_owner,target_owner,
    (select count(*) from public.youtube_watch_history where user_id=source_owner),
    (select count(*) from public.youtube_watch_events where user_id=source_owner)
  on conflict do nothing;

  insert into public.youtube_watch_history as target(user_id,str_ident,int_timestamp,str_title,int_count,int_deleted_at,int_imported_count)
  select target_owner,str_ident,int_timestamp,str_title,int_count,int_deleted_at,int_imported_count
  from public.youtube_watch_history where user_id=source_owner
  on conflict(user_id,str_ident) do update set
    int_timestamp=excluded.int_timestamp,str_title=excluded.str_title,int_count=excluded.int_count,
    int_deleted_at=excluded.int_deleted_at,int_imported_count=excluded.int_imported_count
  where excluded.int_timestamp>target.int_timestamp or excluded.int_deleted_at>target.int_deleted_at
    or excluded.int_imported_count>target.int_imported_count
    or (nullif(btrim(target.str_title),'') is null and nullif(btrim(excluded.str_title),'') is not null);

  insert into public.youtube_watch_events as target(user_id,str_ident,event_id,watched_at,source,precision,observed_deletion)
  select target_owner,s.str_ident,s.event_id,s.watched_at,s.source,s.precision,s.observed_deletion
  from public.youtube_watch_events s where s.user_id=source_owner
  on conflict(user_id,str_ident,event_id) do update set precision=excluded.precision
  where target.precision<>excluded.precision;

  insert into public.youtube_watch_time(user_id,snapshot_id,event_id,str_ident,str_title,minute_at,from_at,to_at,
    milliseconds,observed_deletion,event_watched_at,duration_seconds,media_ranges)
  select target_owner,snapshot_id,event_id,str_ident,str_title,minute_at,from_at,to_at,
    milliseconds,observed_deletion,event_watched_at,duration_seconds,media_ranges
  from public.youtube_watch_time where user_id=source_owner
  on conflict(user_id,snapshot_id) do update set milliseconds=excluded.milliseconds,to_at=excluded.to_at,
    duration_seconds=excluded.duration_seconds,media_ranges=excluded.media_ranges;

  insert into public.youtube_video_durations(user_id,str_ident,seconds,fetched_at,expires_at,unavailable)
  select target_owner,str_ident,seconds,fetched_at,expires_at,unavailable
  from public.youtube_video_durations where user_id=source_owner
  on conflict(user_id,str_ident) do update set seconds=excluded.seconds,fetched_at=excluded.fetched_at,
    expires_at=excluded.expires_at,unavailable=excluded.unavailable;

  insert into private.watchmarker_devices(device_id,owner_id) values(source_owner,target_owner)
  on conflict(device_id) do update set owner_id=excluded.owner_id;
end;
$$;
commit;
