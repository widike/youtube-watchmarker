\set ON_ERROR_STOP on
\ir device-link.sql
\ir ../../supabase/migrations/20261101030000_import_reconciliation.sql
\ir ../../supabase/migrations/20261101040000_playback_time_sync.sql
\ir ../../supabase/migrations/20261103000000_video_duration_sync.sql
\ir ../../supabase/migrations/20261103010000_watch_event_precision.sql
\ir ../../supabase/migrations/20261105000000_blocked_video_sync.sql
\ir ../../supabase/migrations/20261105010000_incremental_sync.sql
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.watchmarker_sync_state() as state \gset initial_
select public.assert_link_test((:'initial_state'::jsonb->>'version')::int=1);
select public.assert_link_test((select count(*)>0 from public.watchmarker_sync_page('history',0,9223372036854775807)));
-- Expired API metadata is purged once per history, while all streams stay
-- incremental and the fresh duration is returned through the bounded RPC.
insert into public.youtube_video_durations(str_ident,seconds,fetched_at,expires_at) values
  ('AAAAAAAAAAA',120,1,2), ('BBBBBBBBBBB',180,extract(epoch from now())*1000,extract(epoch from now()+interval '1 day')*1000);
reset role;
update private.watchmarker_sync_maintenance set maintained_at='-infinity';
set role authenticated;
select public.watchmarker_sync_state() as state \gset duration_
select public.assert_link_test((select count(*)=1 from public.youtube_video_durations));
select public.assert_link_test((select count(*)=1 from public.watchmarker_sync_page('durations',0,(:'duration_state'::jsonb->'revisions'->>'durations')::bigint,'',1)));
insert into public.youtube_watch_time(snapshot_id,event_id,str_ident,minute_at,from_at,to_at,milliseconds)
values ('delta:180000','delta-play','BBBBBBBBBBB',180000,180000,181000,1000);
insert into public.youtube_blocked_videos(str_ident,title,blocked,updated_at,change_id)
values ('BBBBBBBBBBB','Block',false,100,gen_random_uuid());
select public.watchmarker_sync_state() as state \gset initial_
select public.assert_link_test((select count(*)=1 from public.watchmarker_sync_page('watchTime',0,9223372036854775807)));
select public.assert_link_test((select bool_and((p->>'blocked')::boolean=false) from public.watchmarker_sync_page('blocked',0,9223372036854775807) p));

-- No-op retries, including event precision merges, cannot bump revisions.
update public.youtube_watch_history set int_timestamp=int_timestamp;
update public.youtube_watch_events set precision=precision;
select public.assert_link_test(public.watchmarker_sync_state()=:'initial_state'::jsonb);
-- A newly imported old watch is a new change, irrespective of its date or ID.
insert into public.youtube_watch_history(str_ident,int_timestamp,str_title) values ('AAAAAAAAAAA',1,'Old import');
select public.watchmarker_sync_state() as state \gset changed_
select public.assert_link_test((select count(*)=1 from public.watchmarker_sync_page('history',(:'initial_state'::jsonb->'revisions'->>'history')::bigint,(:'changed_state'::jsonb->'revisions'->>'history')::bigint)));
-- Events arrive after the summary and must invalidate it independently.
insert into public.youtube_watch_events(str_ident,event_id,watched_at,source,precision)
values ('AAAAAAAAAAA','new-old-event',1,'saved','exact');
select public.watchmarker_sync_state() as state \gset event_
select public.assert_link_test((select count(*)=1 from public.watchmarker_sync_page('history',(:'changed_state'::jsonb->'revisions'->>'history')::bigint,(:'event_state'::jsonb->'revisions'->>'history')::bigint)));
select public.assert_link_test((select jsonb_array_length(p->'watch_events')=1 from public.watchmarker_sync_page('history',0,9223372036854775807,'',1) p));
update public.youtube_watch_events set precision='day' where event_id='new-old-event';
select public.watchmarker_sync_state() as state \gset precision_
select public.assert_link_test((:'precision_state'::jsonb->'revisions'->>'history')::bigint>(:'event_state'::jsonb->'revisions'->>'history')::bigint);
-- A bounded window excludes later commits; a later window retrieves them.
select public.assert_link_test((select count(*)=0 from public.watchmarker_sync_page('history',(:'changed_state'::jsonb->'revisions'->>'history')::bigint,(:'event_state'::jsonb->'revisions'->>'history')::bigint)));
-- Linked devices share checkpoints; unrelated histories cannot read the owner.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.assert_link_test(public.watchmarker_sync_state()=:'precision_state'::jsonb);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select public.assert_link_test((select count(*)=0 from public.watchmarker_sync_page('history',0,9223372036854775807) p where p->>'str_ident'='AAAAAAAAAAA'));
select public.assert_link_test(public.watchmarker_sync_state()->>'owner'='00000000-0000-0000-0000-000000000004');
-- Authenticated clients cannot manufacture checkpoints or invoke internal writers.
do $$ begin
  begin perform * from private.watchmarker_sync_changes; raise exception 'Private read allowed'; exception when insufficient_privilege then null; end;
  begin perform private.watchmarker_record_change(auth.uid(),'history','fake'); raise exception 'Private write allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.watchmarker_sync_state(); raise exception 'Anonymous state allowed'; exception when insufficient_privilege then null; end;
  begin perform public.watchmarker_sync_page('history',0,1); raise exception 'Anonymous page allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- SQL reapplication preserves checkpoints exactly.
\ir ../../supabase/migrations/20261105010000_incremental_sync.sql
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.assert_link_test(public.watchmarker_sync_state()=:'precision_state'::jsonb);
reset role;
