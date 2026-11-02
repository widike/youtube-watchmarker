\set ON_ERROR_STOP on
\ir device-link.sql
\ir ../../supabase/migrations/20261101030000_import_reconciliation.sql
\ir ../../supabase/migrations/20261101040000_playback_time_sync.sql
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into public.youtube_watch_time(snapshot_id,event_id,str_ident,minute_at,from_at,to_at,milliseconds)
values ('device-one:180000','playback:device-one','abcdefghijk',180000,180000,200000,20000);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.assert_link_test((select sum(milliseconds)=20000 from public.youtube_watch_time));
insert into public.youtube_watch_time(snapshot_id,event_id,str_ident,minute_at,from_at,to_at,milliseconds)
values ('device-one:180000','playback:device-one','abcdefghijk',180000,180000,210000,30000)
on conflict(user_id,snapshot_id) do update set milliseconds=excluded.milliseconds,to_at=excluded.to_at;
-- Stale replicas and lost replies cannot reduce or add cumulative time.
insert into public.youtube_watch_time(snapshot_id,event_id,str_ident,minute_at,from_at,to_at,milliseconds)
values ('device-one:180000','playback:device-one','abcdefghijk',180000,180000,200000,20000)
on conflict(user_id,snapshot_id) do update set milliseconds=excluded.milliseconds,to_at=excluded.to_at;
insert into public.youtube_watch_time(snapshot_id,event_id,str_ident,minute_at,from_at,to_at,milliseconds)
values ('device-two:180000','playback:device-two','mnopqrstuvw',180000,180000,195000,15000);
select public.assert_link_test((select sum(milliseconds)=45000 from public.youtube_watch_time));
do $$ begin
  begin update public.youtube_watch_time set str_ident='mnopqrstuvw' where snapshot_id='device-one:180000';
    raise exception 'Identity mutation accepted';
  exception when raise_exception then if sqlerrm not like 'Playback identity is immutable%' then raise; end if; end;
  begin delete from public.youtube_watch_time; raise exception 'Deletion allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select public.assert_link_test((select count(*)=0 from public.youtube_watch_time));
do $$ begin
  begin insert into public.youtube_watch_time(user_id,snapshot_id,event_id,str_ident,minute_at,from_at,to_at,milliseconds)
    values ('00000000-0000-0000-0000-000000000001','forged','forged','abcdefghijk',180000,180000,190000,10000);
    raise exception 'Cross-owner insert allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
\ir ../../supabase/migrations/20261101040000_playback_time_sync.sql
select public.assert_link_test((select sum(milliseconds)=45000 from public.youtube_watch_time));
select public.assert_link_test(public.watchmarker_sync_version()=4);
set role anon;
do $$ begin
  begin perform * from public.youtube_watch_time; raise exception 'Anonymous playback access allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'Shared playback duration, monotonic merge, recovery and RLS passed' as result;
