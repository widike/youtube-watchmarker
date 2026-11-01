\set ON_ERROR_STOP on
\ir pairing-directory.sql
-- Copy setup SQL must remain usable after the new short-code RPC is installed.
\ir ../supabase/migrations/20261101000000_durable_history_sync.sql
\ir ../supabase/migrations/20261101010000_watch_events.sql
\ir ../supabase/migrations/20261101020000_device_linking.sql
\ir ../supabase/migrations/20261101030000_import_reconciliation.sql
\ir ../supabase/migrations/20261101040000_playback_time_sync.sql
\ir ../supabase/migrations/20261101050000_anonymous_access_hardening.sql
\ir ../supabase/migrations/20261101060000_captcha_configuration.sql
\ir ../supabase/migrations/20261101070000_short_connection_codes.sql
select public.assert_link_test(to_regprocedure('public.watchmarker_create_link()') is null);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
select public.assert_link_test(public.watchmarker_history_owner()='00000000-0000-0000-0000-000000000001');
select public.assert_link_test((select count(*)>0 from public.youtube_watch_history));
select public.assert_link_test(public.watchmarker_create_short_link()->>'code' ~ '^[A-Z]{6}$');
reset role;
select 'Full setup reapplication preserves history and supports short codes' as result;
