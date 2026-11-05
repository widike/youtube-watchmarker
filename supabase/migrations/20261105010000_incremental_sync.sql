begin;

-- One entry per current record, not an ever-growing event/payload log.
create table if not exists private.watchmarker_sync_clock (
  owner_id uuid primary key references auth.users(id),
  revision bigint not null default 0
);
create table if not exists private.watchmarker_sync_maintenance (
  owner_id uuid primary key references auth.users(id),
  maintained_at timestamptz not null
);
create table if not exists private.watchmarker_sync_changes (
  owner_id uuid not null references auth.users(id),
  collection text not null check (collection in ('history','watchTime','durations','blocked')),
  record_key text collate "C" not null,
  revision bigint not null,
  primary key(owner_id, collection, record_key)
);
create index if not exists watchmarker_sync_changes_revision
  on private.watchmarker_sync_changes(owner_id, collection, revision);
create index if not exists youtube_video_durations_expiry
  on public.youtube_video_durations(user_id, expires_at) where expires_at is not null;
revoke all on private.watchmarker_sync_clock, private.watchmarker_sync_changes, private.watchmarker_sync_maintenance from public, anon, authenticated;
alter table private.watchmarker_sync_clock enable row level security;
alter table private.watchmarker_sync_changes enable row level security;
alter table private.watchmarker_sync_maintenance enable row level security;

create or replace function private.watchmarker_record_change(p_owner uuid, p_collection text, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare next_revision bigint;
begin
  -- The owner row remains locked until commit. A sequence alone can commit out
  -- of order and permanently hide a late transaction behind a download cursor.
  insert into private.watchmarker_sync_clock(owner_id, revision) values(p_owner, 1)
    on conflict(owner_id) do update set revision = watchmarker_sync_clock.revision + 1
    returning revision into next_revision;
  insert into private.watchmarker_sync_changes values(p_owner, p_collection, p_key, next_revision)
    on conflict(owner_id, collection, record_key) do update set revision = excluded.revision;
end;
$$;
revoke execute on function private.watchmarker_record_change(uuid,text,text) from public, anon, authenticated;

create or replace function private.watchmarker_track_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare collection text := tg_argv[0]; key_column text := tg_argv[1];
begin
  -- Merge triggers may retain the previous value, or only touch updated_at.
  -- Lost replies and identical imports must not generate download traffic.
  if tg_op = 'UPDATE' and
    (to_jsonb(new) - 'updated_at' - 'created_at') = (to_jsonb(old) - 'updated_at' - 'created_at')
    then return new; end if;
  perform private.watchmarker_record_change(new.user_id, collection, to_jsonb(new)->>key_column);
  return new;
end;
$$;
revoke execute on function private.watchmarker_track_change() from public, anon, authenticated;

drop trigger if exists watchmarker_track_history on public.youtube_watch_history;
create trigger watchmarker_track_history after insert or update on public.youtube_watch_history
  for each row execute function private.watchmarker_track_change('history','str_ident');
-- New event identities and precision-only merges both invalidate their video.
drop trigger if exists watchmarker_track_events on public.youtube_watch_events;
create trigger watchmarker_track_events after insert or update on public.youtube_watch_events
  for each row execute function private.watchmarker_track_change('history','str_ident');
drop trigger if exists watchmarker_track_time on public.youtube_watch_time;
create trigger watchmarker_track_time after insert or update on public.youtube_watch_time
  for each row execute function private.watchmarker_track_change('watchTime','snapshot_id');
drop trigger if exists watchmarker_track_durations on public.youtube_video_durations;
create trigger watchmarker_track_durations after insert or update on public.youtube_video_durations
  for each row execute function private.watchmarker_track_change('durations','str_ident');
drop trigger if exists watchmarker_track_blocks on public.youtube_blocked_videos;
create trigger watchmarker_track_blocks after insert or update on public.youtube_blocked_videos
  for each row execute function private.watchmarker_track_change('blocked','str_ident');

-- Bootstrap existing rows exactly once. Reapplying setup cannot invalidate
-- every client's checkpoint or rewrite history, dates, events or tombstones.
insert into private.watchmarker_sync_clock(owner_id, revision)
select distinct user_id, 1 from (
  select user_id from public.youtube_watch_history union select user_id from public.youtube_watch_time
  union select user_id from public.youtube_video_durations union select user_id from public.youtube_blocked_videos
) owners on conflict do nothing;
insert into private.watchmarker_sync_changes(owner_id, collection, record_key, revision)
select t.user_id, 'history', t.str_ident, c.revision from public.youtube_watch_history t
  join private.watchmarker_sync_clock c on c.owner_id=t.user_id
union all select t.user_id, 'watchTime', t.snapshot_id, c.revision from public.youtube_watch_time t
  join private.watchmarker_sync_clock c on c.owner_id=t.user_id
union all select t.user_id, 'durations', t.str_ident, c.revision from public.youtube_video_durations t
  join private.watchmarker_sync_clock c on c.owner_id=t.user_id
union all select t.user_id, 'blocked', t.str_ident, c.revision from public.youtube_blocked_videos t
  join private.watchmarker_sync_clock c on c.owner_id=t.user_id
on conflict do nothing;

create or replace function public.watchmarker_sync_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare owner uuid := public.watchmarker_history_owner(); result jsonb;
begin
  if auth.uid() is null then raise exception 'A device session is required'; end if;
  -- Expiry maintenance is once per history per hour, not one HTTP DELETE per
  -- download cycle and per device. Keep tiny change keys so revisions never
  -- move backwards when the last duration in a collection expires.
  -- Keep maintenance locks separate from the commit-order clock: duration
  -- writers may already hold a source row before they acquire that clock.
  insert into private.watchmarker_sync_maintenance values(owner, now())
    on conflict(owner_id) do update set maintained_at=excluded.maintained_at
    where watchmarker_sync_maintenance.maintained_at < now()-interval '1 hour';
  if found then
    delete from public.youtube_video_durations
      where user_id=owner and expires_at<=extract(epoch from now())*1000;
  end if;
  -- Four indexed maximum lookups, not a scan of every history key per poll.
  select jsonb_object_agg(s.collection, coalesce((
    select max(c.revision)::text from private.watchmarker_sync_changes c
      where c.owner_id=owner and c.collection=s.collection
  ), '0')) into result from
    (values ('history'),('watchTime'),('durations'),('blocked')) s(collection);
  return jsonb_build_object('version',1,'owner',owner,'revisions',result);
end;
$$;

create or replace function public.watchmarker_sync_page(
  p_collection text, p_since bigint, p_until bigint, p_after text default '', p_limit integer default 500
)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare owner uuid := public.watchmarker_history_owner();
begin
  if auth.uid() is null then raise exception 'A device session is required'; end if;
  if p_collection is null or p_since is null or p_until is null or p_limit is null
    or p_collection not in ('history','watchTime','durations','blocked')
    or p_since < 0 or p_until < p_since or p_limit not between 1 and 500
    then raise exception 'Invalid sync window'; end if;
  return query with changed as materialized (
    select record_key from private.watchmarker_sync_changes
    where owner_id=owner and collection=p_collection and revision>p_since and revision<=p_until
      and record_key>p_after collate "C"
      and (p_collection<>'durations' or exists (
        select 1 from public.youtube_video_durations d where d.user_id=owner and d.str_ident=record_key
      ))
    order by record_key limit p_limit
  )
  select payload from (select jsonb_build_object(
    'str_ident',h.str_ident,'int_timestamp',h.int_timestamp,'str_title',h.str_title,
    'int_count',h.int_count,'int_deleted_at',h.int_deleted_at,'int_imported_count',h.int_imported_count,
    'watch_events',coalesce((select jsonb_agg(jsonb_build_object(
      'eventId',e.event_id,'watchedAt',e.watched_at,'source',e.source,
      'precision',e.precision,'observedDeletion',e.observed_deletion) order by e.event_id)
      from public.youtube_watch_events e where e.user_id=owner and e.str_ident=h.str_ident),'[]'::jsonb)
  ) as payload from changed c join public.youtube_watch_history h on h.user_id=owner and h.str_ident=c.record_key
    where p_collection='history'
  union all
  select to_jsonb(t)-'user_id'-'created_at'-'updated_at' from changed c
    join public.youtube_watch_time t on t.user_id=owner and t.snapshot_id=c.record_key where p_collection='watchTime'
  union all
  select to_jsonb(d)-'user_id' from changed c
    join public.youtube_video_durations d on d.user_id=owner and d.str_ident=c.record_key where p_collection='durations'
  union all
  select to_jsonb(b)-'user_id' from changed c
    join public.youtube_blocked_videos b on b.user_id=owner and b.str_ident=c.record_key where p_collection='blocked'
  ) records order by (payload->>case when p_collection='watchTime' then 'snapshot_id' else 'str_ident' end) collate "C";
end;
$$;
revoke execute on function public.watchmarker_sync_state(), public.watchmarker_sync_page(text,bigint,bigint,text,integer) from public, anon;
grant execute on function public.watchmarker_sync_state(), public.watchmarker_sync_page(text,bigint,bigint,text,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
