\set ON_ERROR_STOP on
\ir short-connection-codes.sql
create role service_role;
\ir ../supabase/directory/setup.sql
\ir ../supabase/directory/setup.sql
select 'private.watchmarker_pairing_directory'::regclass::oid as directory_table_oid \gset
set role service_role;
select public.assert_link_test(public.watchmarker_directory_reserve('KMTPXR',repeat('a',20),'sb_publishable_first',repeat('a',64),now()+interval '9 minutes'));
select public.assert_link_test(public.watchmarker_directory_reserve('KMTPXR',repeat('a',20),'sb_publishable_first',repeat('a',64),now()+interval '9 minutes'));
select public.assert_link_test(not public.watchmarker_directory_reserve('KMTPXR',repeat('b',20),'sb_publishable_other',repeat('b',64),now()+interval '9 minutes'));
select public.assert_link_test(public.watchmarker_directory_reserve('ABCDEF',repeat('b',20),'sb_publishable_other',repeat('b',64),now()+interval '9 minutes'));
select public.assert_link_test(public.watchmarker_directory_resolve('KMTPXR')->>'projectId' = repeat('a',20));
select public.assert_link_test(public.watchmarker_directory_resolve('ABCDEF')->>'projectId' = repeat('b',20));
select public.assert_link_test(public.watchmarker_directory_reserve('NEWNEW',repeat('a',20),'sb_publishable_first',repeat('a',64),now()+interval '9 minutes'));
select public.assert_link_test(public.watchmarker_directory_resolve('KMTPXR') is null);
select public.assert_link_test(not public.watchmarker_directory_reserve('BADBAD',repeat('a',20),'sb_secret_bad',repeat('a',64),now()+interval '9 minutes'));
reset role;
update private.watchmarker_pairing_directory set expires_at = now()-interval '1 second' where project_id=repeat('a',20);
set role service_role;
select public.assert_link_test(public.watchmarker_directory_resolve('NEWNEW') is null);
reset role;
insert into private.watchmarker_directory_attempts(kind) select 'resolve' from generate_series(1,100);
set role service_role;
select public.assert_link_test(public.watchmarker_directory_resolve('ABCDEF') is null);
reset role;
update private.watchmarker_directory_attempts set attempted_at=now()-interval '11 minutes';
set role service_role;
select public.assert_link_test(public.watchmarker_directory_resolve('ABCDEF')->>'projectId'=repeat('b',20));
reset role;
insert into private.watchmarker_directory_attempts(kind,project_id) select 'register',repeat('b',20) from generate_series(1,20);
set role service_role;
select public.assert_link_test(not public.watchmarker_directory_reserve('CAPCAP',repeat('b',20),'sb_publishable_other',repeat('c',64),now()+interval '9 minutes'));
reset role;
set role anon;
select public.assert_link_test(not has_function_privilege(current_user,'public.watchmarker_directory_resolve(text)','execute'));
select public.assert_link_test(not has_function_privilege(current_user,'public.watchmarker_directory_reserve(text,text,text,text,timestamptz)','execute'));
select public.assert_link_test(not has_table_privilege(current_user,:directory_table_oid,'SELECT,INSERT,UPDATE,DELETE'));
reset role;
set role authenticated;
select public.assert_link_test(not has_function_privilege(current_user,'public.watchmarker_directory_resolve(text)','execute'));
select public.assert_link_test(not has_function_privilege(current_user,'public.watchmarker_directory_reserve(text,text,text,text,timestamptz)','execute'));
reset role;
select 'Directory: multiple installations, collisions, replacement, expiry, limits and service-only ACLs passed' as result;
