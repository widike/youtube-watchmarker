-- Included by history-schema.sql in a disposable database only.
\ir ../../supabase/migrations/20261101010000_watch_events.sql
do $$ begin
  if (select count(*) from public.youtube_watch_events) <> 1 then raise exception 'Migration fabricated historical timestamps'; end if;
  if not exists(select from public.youtube_watch_history where str_ident = 'abcdefghijk'
    and int_imported_count = 4 and int_count = 4) then raise exception 'Migration changed historical count'; end if;
end $$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.youtube_watch_events(str_ident, event_id, watched_at, source, precision, observed_deletion)
values ('abcdefghijk', 'playback:first', 400, 'playback', 'exact', 300),
       ('abcdefghijk', 'playback:second', 400, 'playback', 'exact', 300);
-- Retrying after losing an acknowledgement must not insert or alter a watch.
insert into public.youtube_watch_events(str_ident, event_id, watched_at, source, precision)
values ('abcdefghijk', 'playback:first', 999, 'playback', 'exact') on conflict do nothing;
do $$ begin
  if (select count(*) from public.youtube_watch_events) <> 3 then raise exception 'Duplicate event delivery increased history'; end if;
  if not exists(select from public.youtube_watch_events where event_id = 'playback:first' and watched_at = 400) then raise exception 'Watch timestamp was overwritten'; end if;
  if not exists(select from public.youtube_watch_history where str_ident = 'abcdefghijk' and int_count = 6) then raise exception 'Concurrent event union lost a view'; end if;
  begin
    update public.youtube_watch_events set watched_at = 999;
    raise exception 'Client changed immutable event';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.youtube_watch_events;
    raise exception 'Client deleted event';
  exception when insufficient_privilege then null; end;
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
  if exists(select from public.youtube_watch_events) then raise exception 'Cross-user watch event leak'; end if;
  begin
    insert into public.youtube_watch_events(user_id, str_ident, event_id, watched_at, source, precision)
    values ('00000000-0000-0000-0000-000000000001', 'abcdefghijk', 'forbidden', 1, 'playback', 'exact');
    raise exception 'Cross-user event write allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform * from public.youtube_watch_events;
    raise exception 'Anonymous watch event access allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\ir ../../supabase/migrations/20261101010000_watch_events.sql
do $$ begin
  if (select count(*) from public.youtube_watch_events) <> 3 then raise exception 'Repeat setup duplicated snapshots'; end if;
  if public.watchmarker_sync_version() <> 3 then raise exception 'Wrong sync contract'; end if;
end $$;
select 'Watch event schema checks passed' as result;
