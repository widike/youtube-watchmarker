begin;

-- Only public widget configuration is exposed. The provider secret belongs in
-- Supabase Auth settings and must never be stored here or shipped to a client.
create schema if not exists private;
create table if not exists private.watchmarker_captcha_configuration (
  singleton boolean primary key default true check (singleton),
  site_key text not null check (site_key ~ '^[A-Za-z0-9_-]{10,100}$')
);
revoke all on private.watchmarker_captcha_configuration from public, anon, authenticated;
alter table private.watchmarker_captcha_configuration enable row level security;

create or replace function public.watchmarker_captcha_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pageUrl', 'https://widike.github.io/youtube-watchmarker/verification/',
    'siteKey', site_key
  ) from private.watchmarker_captcha_configuration where singleton;
$$;
revoke execute on function public.watchmarker_captcha_config() from public;
grant execute on function public.watchmarker_captcha_config() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
