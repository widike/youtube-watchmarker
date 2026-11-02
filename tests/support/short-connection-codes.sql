\set ON_ERROR_STOP on
-- Disposable local database only. Includes the existing membership/RLS checks.
\ir captcha-configuration.sql
\ir ../../supabase/migrations/20261101070000_short_connection_codes.sql
select 'private.watchmarker_link_attempts'::regclass::oid as attempts_table_oid \gset
\ir ../../supabase/migrations/20261101070000_short_connection_codes.sql
insert into auth.users values
  ('00000000-0000-0000-0000-000000000005'),
  ('00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000007');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.assert_link_test((select count(*) > 0 from public.youtube_watch_history));
select public.watchmarker_create_short_link() as registration \gset
reset role;
set role anon;
select public.assert_link_test(public.watchmarker_link_registration(:'registration'::jsonb->>'code',repeat('0',64)) is null);
select public.assert_link_test(public.watchmarker_link_registration(:'registration'::jsonb->>'code',:'registration'::jsonb->>'proof')->>'issuer' ~ '^[a-f0-9]{64}$');
reset role;
set role authenticated;
select public.watchmarker_create_short_link()->>'code' as replaced_code \gset
select public.watchmarker_create_short_link()->>'code' as code \gset
select public.assert_link_test(:'code' ~ '^[A-Z]{6}$');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
select public.assert_link_test(public.watchmarker_claim_link(:'replaced_code') is null);
select public.assert_link_test(public.watchmarker_claim_link(:'code') = '00000000-0000-0000-0000-000000000001');
select public.assert_link_test(public.watchmarker_claim_link(:'code') = '00000000-0000-0000-0000-000000000001');
select public.assert_link_test((select count(*) > 0 from public.youtube_watch_history));
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
select public.assert_link_test(public.watchmarker_claim_link(:'code') is null);
select public.assert_link_test((select count(*) = 0 from public.youtube_watch_history));
-- The limit must survive unsuccessful RPC calls and reject a valid code too.
select public.assert_link_test(public.watchmarker_claim_link('123456') is null);
select public.assert_link_test(public.watchmarker_claim_link(null) is null);
select public.assert_link_test(public.watchmarker_claim_link('bad-format') is null);
select public.assert_link_test(public.watchmarker_claim_link('bad-format') is null);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.watchmarker_create_short_link()->>'code' as limited_code \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
select public.assert_link_test(public.watchmarker_claim_link(:'limited_code') is null);
reset role;
select public.assert_link_test((select count(*) = 5 from private.watchmarker_link_attempts where device_id = '00000000-0000-0000-0000-000000000006'));
update private.watchmarker_link_attempts set attempted_at = clock_timestamp() - interval '11 minutes';
set role authenticated;
select public.assert_link_test(public.watchmarker_claim_link(:'limited_code') = '00000000-0000-0000-0000-000000000001');
-- A valid code cannot rebind an established installation to another history.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select public.watchmarker_create_short_link()->>'code' as other_code \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
select public.assert_link_test(public.watchmarker_claim_link(:'other_code') is null);
select public.assert_link_test(public.watchmarker_history_owner() = '00000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.watchmarker_create_short_link()->>'code' as expired_code \gset
reset role;
update private.watchmarker_links set expires_at = clock_timestamp() - interval '1 second';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',false);
select public.assert_link_test(public.watchmarker_claim_link(:'expired_code') is null);
-- A global cap prevents bypass by creating more anonymous identities.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.watchmarker_create_short_link()->>'code' as global_code \gset
reset role;
delete from private.watchmarker_link_attempts;
insert into private.watchmarker_link_attempts(device_id)
  select '00000000-0000-0000-0000-000000000001' from generate_series(1,100);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',false);
select public.assert_link_test(public.watchmarker_claim_link(:'global_code') is null);
reset role;
update private.watchmarker_link_attempts set attempted_at = clock_timestamp() - interval '11 minutes';
set role authenticated;
select public.assert_link_test(public.watchmarker_claim_link(:'global_code') = '00000000-0000-0000-0000-000000000001');
select public.assert_link_test(not has_table_privilege(current_user, :attempts_table_oid, 'SELECT,INSERT,UPDATE,DELETE'));
reset role;
set role anon;
select public.assert_link_test(not has_function_privilege(current_user,'public.watchmarker_claim_link(text)','execute'));
select public.assert_link_test(not has_function_privilege(current_user,'public.watchmarker_create_short_link()','execute'));
reset role;
select 'Short codes: membership preserved, single use, expiry, replacement, isolation and durable limits passed' as result;
