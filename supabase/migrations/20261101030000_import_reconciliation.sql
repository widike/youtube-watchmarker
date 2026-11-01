begin;

create or replace function public.watchmarker_import_reconciliation_version()
returns integer language sql security invoker set search_path = '' as $$ select 1; $$;
revoke execute on function public.watchmarker_import_reconciliation_version() from public, anon;
grant execute on function public.watchmarker_import_reconciliation_version() to authenticated;

-- Corrections are append-only receipt events referencing the original saved
-- event. Keep original evidence and the imported high-water count for merging;
-- recompute the materialized count so stale clients cannot restore inflation.
create or replace function public.watchmarker_recorded_count(owner_id uuid, video_id text, imported_count integer)
returns integer language sql volatile security invoker set search_path = '' as $$
  select greatest(1,
    greatest(imported_count, count(*) filter (where e.source = 'saved'))
    - count(*) filter (where e.source = 'saved' and exists (
      select 1 from public.youtube_watch_events correction
      where correction.user_id = e.user_id and correction.str_ident = e.str_ident
        and correction.source = 'receipt'
        and correction.event_id = 'reconciled-import:v1:' || e.event_id
    ))
    + count(*) filter (where e.source = 'playback')
  )::integer
  from public.youtube_watch_events e
  where e.user_id = owner_id and e.str_ident = video_id;
$$;
revoke execute on function public.watchmarker_recorded_count(uuid, text, integer) from public, anon;
grant execute on function public.watchmarker_recorded_count(uuid, text, integer) to authenticated;

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
    new.created_at := old.created_at;
  end if;
  if exists (
    select 1 from public.youtube_watch_events saved
    join public.youtube_watch_events correction
      on correction.user_id = saved.user_id and correction.str_ident = saved.str_ident
      and correction.source = 'receipt'
      and correction.event_id = 'reconciled-import:v1:' || saved.event_id
    where saved.user_id = new.user_id and saved.str_ident = new.str_ident and saved.source = 'saved'
  ) then
    -- Only an approved, replicated correction permits a count reduction.
    new.int_count := public.watchmarker_recorded_count(new.user_id, new.str_ident, new.int_imported_count);
  else
    if tg_op = 'UPDATE' then new.int_count := greatest(old.int_count, new.int_count); end if;
    new.int_count := greatest(new.int_count, public.watchmarker_recorded_count(new.user_id, new.str_ident, new.int_imported_count));
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.summarize_watch_event()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.youtube_watch_history
    where user_id = new.user_id and str_ident = new.str_ident for update;
  update public.youtube_watch_history set int_count = public.watchmarker_recorded_count(user_id, str_ident, int_imported_count)
    where user_id = new.user_id and str_ident = new.str_ident;
  return new;
end;
$$;
revoke execute on function public.summarize_watch_event() from public, anon;

-- This setup performs no history UPDATE/DELETE. Only later uploads of approved
-- correction receipts enable count reductions for their affected videos.

notify pgrst, 'reload schema';
commit;
