\set ON_ERROR_STOP on
-- Run only in a disposable local database: psql -f test-support/device-link.sql.
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated, anon;
\ir ../../supabase/migrations/20261101000000_durable_history_sync.sql
\ir ../../supabase/migrations/20261101010000_watch_events.sql
\ir ../../supabase/migrations/20261101020000_device_linking.sql
-- Reapplying setup keeps memberships and history, including event policies.
\ir ../../supabase/migrations/20261101020000_device_linking.sql
insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004');
create function public.assert_link_test(ok boolean) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Device link assertion failed'; end if; end;
$$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
insert into public.youtube_watch_history(str_ident,int_timestamp) values ('abcdefghijk',100);
select public.watchmarker_create_link() as first_token \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select public.assert_link_test(public.watchmarker_claim_link(:'first_token') = '00000000-0000-0000-0000-000000000001');
-- A retry by the same device is idempotent, without sharing its Auth identity.
select public.assert_link_test(public.watchmarker_claim_link(:'first_token') = '00000000-0000-0000-0000-000000000001');
select public.assert_link_test((select count(*) = 1 from public.youtube_watch_history));
insert into public.youtube_watch_history(str_ident,int_timestamp) values ('mnopqrstuvw',200);
insert into public.youtube_watch_events(str_ident,event_id,watched_at,source,precision)
  values ('mnopqrstuvw','device-two-playback',200,'playback','exact');
select public.assert_link_test((select bool_and(user_id = '00000000-0000-0000-0000-000000000001') from public.youtube_watch_history));
select public.watchmarker_create_link() as second_token \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select public.assert_link_test(public.watchmarker_claim_link(:'second_token') = '00000000-0000-0000-0000-000000000001');
select public.assert_link_test((select count(*) = 2 from public.youtube_watch_history));
select public.assert_link_test((select count(*) = 1 from public.youtube_watch_events));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_history));
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_events));
-- An already linked installation cannot change owners, even with a valid code.
select public.watchmarker_create_link() as outsider_token \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select set_config('test.other_token', :'outsider_token', false);
do $$ begin
  begin
    perform public.watchmarker_claim_link(current_setting('test.other_token'));
    raise exception 'Cross-history relinking was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Device is already linked to another history' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
-- Reused codes, expired codes, and arbitrary owner IDs must not grant access.
select set_config('test.used_token', :'first_token', false);
do $$ begin
  begin
    perform public.watchmarker_claim_link(current_setting('test.used_token'));
    raise exception 'Reused code was accepted';
  exception when raise_exception then
    if sqlerrm not like 'Connection code expired%' then raise; end if;
  end;
  begin
    insert into public.youtube_watch_history(user_id,str_ident,int_timestamp)
      values ('00000000-0000-0000-0000-000000000001','zzzzzzzzzzz',100);
    raise exception 'Cross-history write was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from private.watchmarker_devices;
    raise exception 'Membership table was exposed';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select public.watchmarker_create_link() as expired_token \gset
reset role;
update private.watchmarker_links set expires_at = now() - interval '1 second';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select set_config('test.expired_token', :'expired_token', false);
do $$ begin
  begin
    perform public.watchmarker_claim_link(current_setting('test.expired_token'));
    raise exception 'Expired code was accepted';
  exception when raise_exception then
    if sqlerrm not like 'Connection code expired%' then raise; end if;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.watchmarker_create_link();
    raise exception 'Unauthenticated issuance was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'Three devices share history; isolation and invitation checks passed' as result;
