\set ON_ERROR_STOP on
\ir device-link.sql
\ir ../../supabase/migrations/20261103000000_video_duration_sync.sql
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into public.youtube_video_durations(str_ident,seconds,fetched_at,expires_at)
values ('abcdefghijk',600,1000,9007199254740991);
-- A linked Mac reads and refreshes the same owner-scoped cache.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.assert_link_test((select seconds=600 from public.youtube_video_durations where str_ident='abcdefghijk'));
insert into public.youtube_video_durations(str_ident,seconds,fetched_at,expires_at)
values ('abcdefghijk',900,2000,9007199254740991)
on conflict(user_id,str_ident) do update set seconds=excluded.seconds,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at;
insert into public.youtube_video_durations(str_ident,seconds,fetched_at,expires_at)
values ('abcdefghijk',600,1000,9007199254740991)
on conflict(user_id,str_ident) do update set seconds=excluded.seconds,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at;
select public.assert_link_test((select seconds=900 and fetched_at=2000 from public.youtube_video_durations where str_ident='abcdefghijk'));
-- Equal observation dates use the same deterministic tie-break as IndexedDB.
insert into public.youtube_video_durations(str_ident,seconds,fetched_at,expires_at)
values ('abcdefghijk',1000,2000,9007199254740991)
on conflict(user_id,str_ident) do update set seconds=excluded.seconds,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at;
select public.assert_link_test((select seconds=1000 from public.youtube_video_durations where str_ident='abcdefghijk'));
insert into public.youtube_video_durations(str_ident,seconds,fetched_at,unavailable)
values ('missing____',null,3000,true);
insert into public.youtube_video_durations(str_ident,seconds,fetched_at,expires_at)
values ('live_______',null,3000,9007199254740991), ('expired____',600,1000,2000);
-- Only expired metadata can be deleted through the client API.
delete from public.youtube_video_durations;
select public.assert_link_test((select count(*)=3 from public.youtube_video_durations));
do $$ begin
  begin update public.youtube_video_durations set str_ident='mutated____' where str_ident='abcdefghijk';
    raise exception 'Identity mutation accepted';
  exception when raise_exception then if sqlerrm <> 'Video duration identity is immutable' then raise; end if; end;
  begin insert into public.youtube_video_durations(str_ident,seconds,fetched_at,expires_at)
    values ('invalid____','Infinity'::float8,1000,2000); raise exception 'Invalid duration accepted';
  exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select public.assert_link_test((select count(*)=0 from public.youtube_video_durations));
delete from public.youtube_video_durations;
do $$ begin
  begin insert into public.youtube_video_durations(user_id,str_ident,seconds,fetched_at,expires_at)
    values ('00000000-0000-0000-0000-000000000001','forged_____',600,1000,2000);
    raise exception 'Cross-owner insert allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
\ir ../../supabase/migrations/20261103000000_video_duration_sync.sql
select public.assert_link_test((select count(*)=3 from public.youtube_video_durations));
set role anon;
do $$ begin
  begin perform * from public.youtube_video_durations; raise exception 'Anonymous duration access allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'Shared durations, expiry, monotonic refresh and RLS passed' as result;
