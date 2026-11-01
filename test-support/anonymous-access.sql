\set ON_ERROR_STOP on
-- Run only in a disposable local database: psql -f test-support/anonymous-access.sql.
\ir playback-time-schema.sql

-- Simulate a pre-existing installation with overly broad grants and policies.
create policy "Old shared history" on public.youtube_watch_history for all to public using (true) with check (true);
create policy "Old shared events" on public.youtube_watch_events for all to authenticated using (true) with check (true);
create policy "Old shared time" on public.youtube_watch_time for all to public using (true) with check (true);
grant all on public.youtube_watch_history, public.youtube_watch_events, public.youtube_watch_time to public;
create function public.get_rls_status() returns boolean language sql security definer as $$ select true; $$;
create function public.cleanup_old_watch_history(integer) returns integer language sql security definer as $$ select 1; $$;
\ir ../supabase/migrations/20261101050000_anonymous_access_hardening.sql
\ir ../supabase/migrations/20261101050000_anonymous_access_hardening.sql

-- A real anonymous Auth user has authenticated role and is_anonymous=true.
-- The claim is descriptive: ownership still comes from the verified subject.
set role authenticated;
select set_config('request.jwt.claims', '{"is_anonymous":true}', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select public.assert_link_test((select count(*) = 2 from public.youtube_watch_history));
select public.assert_link_test((select count(*) = 1 from public.youtube_watch_events));
select public.assert_link_test((select sum(milliseconds) = 45000 from public.youtube_watch_time));
insert into public.youtube_watch_events(str_ident,event_id,watched_at,source,precision)
values ('abcdefghijk','anonymous-linked-playback',300000,'playback','exact');
update public.youtube_watch_history set str_title = 'Shared device' where str_ident = 'abcdefghijk';
select public.assert_link_test((select str_title = 'Shared device' from public.youtube_watch_history where str_ident = 'abcdefghijk'));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
-- Neither an anonymous user nor a permanent user may access another history.
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_history));
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_events));
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_time));
select set_config('request.jwt.claims', '{"is_anonymous":false}', false);
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_history));
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_events));
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_time));
do $$
declare relation_name text; affected integer;
begin
  foreach relation_name in array array['youtube_watch_history', 'youtube_watch_time'] loop
    execute format('update public.%I set user_id = auth.uid()', relation_name);
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Cross-owner update accepted'; end if;
  end loop;
  begin
    insert into public.youtube_watch_history(user_id,str_ident,int_timestamp)
    values ('00000000-0000-0000-0000-000000000001','zzzzzzzzzzz',100);
    raise exception 'Cross-owner history insert accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.youtube_watch_events(user_id,str_ident,event_id,watched_at,source,precision)
    values ('00000000-0000-0000-0000-000000000001','abcdefghijk','forged',400000,'playback','exact');
    raise exception 'Cross-owner event insert accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.youtube_watch_time(user_id,snapshot_id,event_id,str_ident,minute_at,from_at,to_at,milliseconds)
    values ('00000000-0000-0000-0000-000000000001','forged','forged','abcdefghijk',180000,180000,190000,10000);
    raise exception 'Cross-owner time insert accepted';
  exception when insufficient_privilege then null; end;
end $$;

-- ACLs must protect operations RLS cannot protect, such as TRUNCATE.
select public.assert_link_test(not has_table_privilege(current_user,'public.youtube_watch_history','DELETE,TRUNCATE,REFERENCES,TRIGGER'));
select public.assert_link_test(not has_table_privilege(current_user,'public.youtube_watch_events','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
select public.assert_link_test(not has_table_privilege(current_user,'public.youtube_watch_time','DELETE,TRUNCATE,REFERENCES,TRIGGER'));
select public.assert_link_test(not has_schema_privilege(current_user,'private','USAGE'));
select public.assert_link_test(not has_function_privilege(current_user,'public.get_rls_status()','EXECUTE'));
select public.assert_link_test(not has_function_privilege(current_user,'public.cleanup_old_watch_history(integer)','EXECUTE'));
-- Missing subject must fail closed, even if the DB role is authenticated.
select set_config('request.jwt.claim.sub', '', false);
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_history));
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_events));
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_time));
reset role;
set role anon;
select public.assert_link_test(not has_table_privilege(current_user,'public.youtube_watch_history','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
select public.assert_link_test(not has_table_privilege(current_user,'public.youtube_watch_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
select public.assert_link_test(not has_table_privilege(current_user,'public.youtube_watch_time','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
select public.assert_link_test(not has_function_privilege(current_user,'public.watchmarker_history_owner()','EXECUTE'));
select public.assert_link_test(not has_function_privilege(current_user,'public.watchmarker_claim_link(text)','EXECUTE'));
reset role;
select 'Anonymous sessions isolated despite permissive policies; linked sync and ACL checks passed' as result;
