\set ON_ERROR_STOP on
-- Run only in a disposable local database.
\ir anonymous-access.sql
\ir ../../supabase/migrations/20261101060000_captcha_configuration.sql
select 'private.watchmarker_captcha_configuration'::regclass::oid as captcha_table_oid \gset
set role anon;
select public.assert_link_test(public.watchmarker_captcha_config() is null);
reset role;
insert into private.watchmarker_captcha_configuration(site_key) values ('0x4public-widget-key');
\ir ../../supabase/migrations/20261101060000_captcha_configuration.sql
set role anon;
select public.assert_link_test(public.watchmarker_captcha_config() = '{"pageUrl":"https://widike.github.io/youtube-watchmarker/verification/","siteKey":"0x4public-widget-key"}'::jsonb);
select public.assert_link_test(not has_table_privilege(current_user, :captcha_table_oid, 'SELECT,INSERT,UPDATE,DELETE'));
do $$ begin
  begin
    update private.watchmarker_captcha_configuration set site_key = 'forged-widget-key';
    raise exception 'Public callers can replace the widget key';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
select public.assert_link_test(public.watchmarker_captcha_config()->>'siteKey' = '0x4public-widget-key');
select public.assert_link_test(not has_table_privilege(current_user, :captcha_table_oid, 'SELECT,INSERT,UPDATE,DELETE'));
reset role;
select 'Only public widget configuration is exposed; modification and table access denied' as result;
