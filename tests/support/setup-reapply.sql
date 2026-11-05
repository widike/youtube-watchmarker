\set ON_ERROR_STOP on
\ir pairing-directory.sql
\ir ../../supabase/migrations/20261103000000_video_duration_sync.sql
\ir ../../supabase/migrations/20261103010000_watch_event_precision.sql

-- Populate every existing feature before adding the missing blocked-video table.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into public.youtube_video_durations(str_ident,seconds,fetched_at,expires_at)
values ('abcdefghijk',120,1000,2000);
update public.youtube_watch_history set int_deleted_at=400000 where str_ident='mnopqrstuvw';
reset role;
create table public.unrelated_settings(value text);
insert into public.unrelated_settings values ('Keep existing project data');

create function pg_temp.setup_snapshot() returns jsonb language plpgsql as $$
declare relation_name text; rows jsonb; snapshot jsonb := '{}'::jsonb;
begin
  foreach relation_name in array array[
    'auth.users', 'public.youtube_watch_history', 'public.youtube_watch_events',
    'public.youtube_watch_time', 'public.youtube_video_durations',
    'private.watchmarker_devices', 'private.watchmarker_links',
    'private.watchmarker_link_attempts', 'private.watchmarker_captcha_configuration',
    'private.watchmarker_pairing_directory', 'private.watchmarker_directory_attempts',
    'public.unrelated_settings'
  ] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from %s t', relation_name) into rows;
    snapshot := snapshot || jsonb_build_object(relation_name, rows);
  end loop;
  return snapshot;
end;
$$;
create temp table setup_before as select pg_temp.setup_snapshot() as snapshot;

-- A deliberate late failure must roll back even the newly created table.
\set ON_ERROR_STOP off
\i :failed_setup_file
\set ON_ERROR_STOP on
select public.assert_link_test(to_regclass('public.youtube_blocked_videos') is null);
select public.assert_link_test(pg_temp.setup_snapshot()=(select snapshot from setup_before));

-- Run exactly the SQL copied by the UI, twice, against the existing project.
\i :setup_file
select public.assert_link_test(to_regclass('public.youtube_blocked_videos') is not null);
select public.assert_link_test(pg_temp.setup_snapshot()=(select snapshot from setup_before));
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
select public.assert_link_test(public.watchmarker_history_owner()='00000000-0000-0000-0000-000000000001');
select public.assert_link_test((select count(*)>0 from public.youtube_watch_history));
insert into public.youtube_blocked_videos(str_ident,title,blocked,updated_at,change_id)
values ('abcdefghijk','Keep block',true,123,gen_random_uuid()),
  ('mnopqrstuvw','Keep unblock tombstone',false,124,gen_random_uuid());
reset role;
create temp table blocks_before as select * from public.youtube_blocked_videos;
\i :setup_file
select public.assert_link_test(pg_temp.setup_snapshot()=(select snapshot from setup_before));
select public.assert_link_test(not exists (
  (select * from blocks_before except select * from public.youtube_blocked_videos)
  union all (select * from public.youtube_blocked_videos except select * from blocks_before)
));
select public.assert_link_test(to_regprocedure('public.watchmarker_create_link()') is null);
set role authenticated;
select public.assert_link_test((select count(*)=2 from public.youtube_blocked_videos));
select public.assert_link_test(public.watchmarker_create_short_link()->>'code' ~ '^[A-Z]{6}$');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select public.assert_link_test((select count(*)=0 from public.youtube_blocked_videos));
select public.assert_link_test((select count(*)=0 from public.youtube_watch_history));
reset role;
select 'Copied setup preserves all existing rows, adds blocked-video sync, retains isolation and rolls back on failure' as result;
