\ir ../supabase/migrations/20261101030000_import_reconciliation.sql
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.youtube_watch_history(str_ident, int_timestamp, str_title, int_imported_count, int_count)
values ('untouched01', 100, 'Not approved', 1, 999);
insert into public.youtube_watch_history(str_ident, int_timestamp, str_title, int_imported_count, int_count)
values ('repairtest1', 300, 'Repaired video', 2, 2);
insert into public.youtube_watch_events(str_ident, event_id, watched_at, source, precision)
values ('repairtest1', 'saved:a', 100, 'saved', 'inferred'),
       ('repairtest1', 'saved:b', 200, 'saved', 'inferred'),
       ('repairtest1', 'playback:a', 300, 'playback', 'exact');
do $$ begin
  if not exists(select from public.youtube_watch_history where str_ident = 'repairtest1' and int_count = 3)
    then raise exception 'Initial event count is incorrect'; end if;
end $$;
insert into public.youtube_watch_events(str_ident, event_id, watched_at, source, precision)
values ('repairtest1', 'reconciled-import:v1:saved:a', 0, 'receipt', 'inferred'),
       ('repairtest1', 'reconciled-import:v1:saved:b', 0, 'receipt', 'inferred');
do $$ begin
  if not exists(select from public.youtube_watch_history where str_ident = 'repairtest1' and int_count = 1 and int_imported_count = 2)
    then raise exception 'Corrections did not repair materialized count'; end if;
  if (select count(*) from public.youtube_watch_events where str_ident = 'repairtest1') <> 5
    then raise exception 'Repair removed immutable evidence'; end if;
end $$;
-- A stale device can upload its old summary, but cannot undo the correction.
insert into public.youtube_watch_history(str_ident, int_timestamp, int_imported_count, int_count)
values ('repairtest1', 300, 2, 999)
on conflict(user_id, str_ident) do update set int_count = excluded.int_count,
  int_imported_count = excluded.int_imported_count;
insert into public.youtube_watch_events(str_ident, event_id, watched_at, source, precision)
values ('repairtest1', 'saved:a', 100, 'saved', 'inferred') on conflict do nothing;
do $$ begin
  if not exists(select from public.youtube_watch_history where str_ident = 'repairtest1' and int_count = 1)
    then raise exception 'Stale client resurrected inflated count'; end if;
end $$;
-- Separately identified actual plays survive, even at the same timestamp.
insert into public.youtube_watch_events(str_ident, event_id, watched_at, source, precision)
values ('repairtest1', 'playback:b', 300, 'playback', 'exact'),
       ('repairtest1', 'reconciled-import:v1:playback:a', 0, 'receipt', 'inferred');
do $$ begin
  if not exists(select from public.youtube_watch_history where str_ident = 'repairtest1' and int_count = 2)
    then raise exception 'A genuine replay was suppressed'; end if;
end $$;
reset role;
\ir ../supabase/migrations/20261101030000_import_reconciliation.sql
do $$ begin
  if not exists(select from public.youtube_watch_history where str_ident = 'untouched01' and int_count = 999)
    then raise exception 'Schema setup modified an unapproved history count'; end if;
  if not exists(select from public.youtube_watch_history where str_ident = 'repairtest1' and int_count = 2)
    then raise exception 'Repeat migration changed repaired count'; end if;
end $$;
select 'Import reconciliation schema checks passed' as result;
