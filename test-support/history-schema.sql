-- Run ONLY in a disposable local Postgres database (see README verification).
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated, anon;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
\ir ../supabase/migrations/20261101000000_durable_history_sync.sql

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.youtube_watch_history(str_ident, int_timestamp, str_title, int_count)
values ('abcdefghijk', 200, 'Current title', 4), ('unknown0000', 0, 'Undated video', 1);
insert into public.youtube_watch_history(str_ident, int_timestamp, str_title, int_count)
values ('abcdefghijk', 10, 'Stale title', 1)
on conflict(user_id, str_ident) do update set
  int_timestamp = excluded.int_timestamp, str_title = excluded.str_title, int_count = excluded.int_count;
do $$ begin
  if not exists(select from public.youtube_watch_history where str_ident = 'abcdefghijk'
      and int_timestamp = 200 and int_count = 4 and str_title = 'Current title') then
    raise exception 'Stale device reduced history progress';
  end if;
  begin
    delete from public.youtube_watch_history;
    raise exception 'Client deletion was allowed';
  exception when insufficient_privilege then null; end;
end $$;
-- User deletion is an upserted marker, never a physical DELETE.
insert into public.youtube_watch_history(str_ident, int_timestamp, int_deleted_at)
values ('abcdefghijk', 200, 300)
on conflict(user_id, str_ident) do update set int_deleted_at = excluded.int_deleted_at;
-- A stale offline client with a future clock must not undo that deletion.
insert into public.youtube_watch_history(str_ident, int_timestamp)
values ('abcdefghijk', 999999)
on conflict(user_id, str_ident) do update set int_timestamp = excluded.int_timestamp, int_deleted_at = excluded.int_deleted_at;
do $$ begin
  if not exists(select from public.youtube_watch_history where str_ident = 'abcdefghijk'
      and int_deleted_at = 300 and int_timestamp = 200) then raise exception 'Stale client restored deletion'; end if;
end $$;
-- A new explicit watch that has observed the marker can restore the video.
insert into public.youtube_watch_history(str_ident, int_timestamp, int_deleted_at)
values ('abcdefghijk', 301, 300)
on conflict(user_id, str_ident) do update set int_timestamp = excluded.int_timestamp, int_deleted_at = excluded.int_deleted_at;
-- A retried old deletion is idempotent after the new watch.
insert into public.youtube_watch_history(str_ident, int_timestamp, int_deleted_at)
values ('abcdefghijk', 200, 300)
on conflict(user_id, str_ident) do update set int_timestamp = excluded.int_timestamp, int_deleted_at = excluded.int_deleted_at;
do $$ begin
  if not exists(select from public.youtube_watch_history where str_ident = 'abcdefghijk'
      and int_timestamp = 301 and int_deleted_at = 300) then raise exception 'Replayed deletion undid new watch'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
  if exists(select from public.youtube_watch_history) then raise exception 'Cross-user history leak'; end if;
  begin
    insert into public.youtube_watch_history(user_id, str_ident, int_timestamp) values
      ('00000000-0000-0000-0000-000000000001', 'forbidden00', 1);
    raise exception 'Cross-user write was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform * from public.youtube_watch_history;
    raise exception 'Anonymous history read was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Reapplying the schema cannot reset or delete previously recorded history.
\ir ../supabase/migrations/20261101000000_durable_history_sync.sql

do $$ begin
  if (select count(*) from public.youtube_watch_history) <> 2 then raise exception 'Setup lost existing history'; end if;
end $$;
select 'History schema checks passed' as result;
\ir watch-events-schema.sql
\ir import-reconciliation-schema.sql
