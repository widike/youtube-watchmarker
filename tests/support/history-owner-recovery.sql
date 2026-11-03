\set ON_ERROR_STOP on
\ir device-link.sql
\ir ../../supabase/migrations/20261101030000_import_reconciliation.sql
\ir ../../supabase/migrations/20261101040000_playback_time_sync.sql
\ir ../../supabase/migrations/20261103000000_video_duration_sync.sql
\ir ../../supabase/migrations/20261103010000_watch_event_precision.sql
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
insert into public.youtube_watch_history(str_ident,int_timestamp,int_imported_count) values('abcdefghijk',100,1),('unique_____',300,1);
insert into public.youtube_watch_events(str_ident,event_id,watched_at,source,precision) values('abcdefghijk','same-import',100,'saved','day'),('unique_____','unique-import',300,'saved','exact');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into public.youtube_watch_events(str_ident,event_id,watched_at,source,precision) values('abcdefghijk','same-import',100,'saved','inferred');
reset role;
select set_config('watchmarker.recovery_source','00000000-0000-0000-0000-000000000004',false);
select set_config('watchmarker.recovery_target','00000000-0000-0000-0000-000000000001',false);
\ir ../../supabase/admin/reconnect-history.sql
\ir ../../supabase/admin/reconnect-history.sql
select public.assert_link_test((select relrowsecurity from pg_class where oid='private.watchmarker_history_recoveries'::regclass));
select public.assert_link_test((select count(*)=2 from public.youtube_watch_events where user_id='00000000-0000-0000-0000-000000000004'));
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select public.assert_link_test(public.watchmarker_history_owner()='00000000-0000-0000-0000-000000000001');
select public.assert_link_test((select count(*)=3 from public.youtube_watch_history));
select public.assert_link_test((select count(*)=1 from public.youtube_watch_events where event_id='unique-import'));
select public.assert_link_test((select precision='day' from public.youtube_watch_events where event_id='same-import'));
insert into public.youtube_watch_events(str_ident,event_id,watched_at,source,precision) values('abcdefghijk','same-import',100,'saved','inferred')
on conflict(user_id,str_ident,event_id) do update set precision=excluded.precision;
select public.assert_link_test((select precision='day' from public.youtube_watch_events where event_id='same-import'));
do $$ begin
  begin update public.youtube_watch_events set watched_at=999 where event_id='same-import';
    raise exception 'Event timestamp changed';
  exception when raise_exception then if sqlerrm <> 'Watch event identity is immutable' then raise; end if; end;
  begin perform * from private.watchmarker_history_recoveries; raise exception 'Recovery audit exposed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
\ir ../../supabase/migrations/20261103010000_watch_event_precision.sql
select 'History recovery retained original rows, shared unique watches, and merged precision safely' as result;
