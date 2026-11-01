begin;
create schema if not exists private;
create table if not exists private.watchmarker_pairing_directory (
  code_hash bytea primary key,
  project_id text not null,
  publishable_key text not null,
  issuer text not null,
  expires_at timestamptz not null,
  unique(project_id, issuer)
);
create table if not exists private.watchmarker_directory_attempts (
  kind text not null,
  project_id text,
  attempted_at timestamptz not null default clock_timestamp()
);
revoke all on private.watchmarker_pairing_directory, private.watchmarker_directory_attempts from public, anon, authenticated;
alter table private.watchmarker_pairing_directory enable row level security;
alter table private.watchmarker_directory_attempts enable row level security;

create or replace function public.watchmarker_directory_reserve(
  p_code text, p_project text, p_key text, p_issuer text, p_expires timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  hashed bytea := sha256(convert_to(p_code, 'UTF8'));
  previous private.watchmarker_pairing_directory%rowtype;
begin
  if p_code is null or p_code !~ '^[A-Z]{6}$' or p_project is null or p_project !~ '^[a-z]{20}$'
    or p_key is null or p_key !~ '^sb_publishable_[A-Za-z0-9_-]+$' or length(p_key) > 300
    or p_issuer is null or p_issuer !~ '^[a-f0-9]{64}$'
    or p_expires is null or p_expires <= clock_timestamp() or p_expires > clock_timestamp() + interval '10 minutes'
    then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('watchmarker-directory', 0));
  delete from private.watchmarker_pairing_directory where expires_at <= clock_timestamp();
  delete from private.watchmarker_directory_attempts where attempted_at <= clock_timestamp() - interval '10 minutes';
  select * into previous from private.watchmarker_pairing_directory where code_hash = hashed;
  if found then
    return previous.project_id = p_project and previous.issuer = p_issuer and previous.publishable_key = p_key;
  end if;
  if (select count(*) from private.watchmarker_directory_attempts where kind = 'register' and project_id = p_project) >= 20
    or (select count(*) from private.watchmarker_directory_attempts where kind = 'register') >= 1000
    or (select count(*) from private.watchmarker_pairing_directory) >= 10000 then return false; end if;
  insert into private.watchmarker_directory_attempts(kind, project_id) values ('register', p_project);
  delete from private.watchmarker_pairing_directory where project_id = p_project and issuer = p_issuer;
  insert into private.watchmarker_pairing_directory values (hashed, p_project, p_key, p_issuer, p_expires);
  return true;
end;
$$;

create or replace function public.watchmarker_directory_resolve(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('watchmarker-directory', 0));
  delete from private.watchmarker_pairing_directory where expires_at <= clock_timestamp();
  delete from private.watchmarker_directory_attempts where attempted_at <= clock_timestamp() - interval '10 minutes';
  if (select count(*) from private.watchmarker_directory_attempts where kind = 'resolve') >= 100 then return null; end if;
  insert into private.watchmarker_directory_attempts(kind) values ('resolve');
  select jsonb_build_object('projectId', project_id, 'publishableKey', publishable_key)
    into result from private.watchmarker_pairing_directory
    where code_hash = sha256(convert_to(p_code, 'UTF8')) and expires_at > clock_timestamp();
  return result;
end;
$$;

-- Only the Edge Function may call these. Public clients cannot forge mappings,
-- list codes, read tables or bypass the server's origin-proof verification.
revoke execute on function public.watchmarker_directory_reserve(text,text,text,text,timestamptz), public.watchmarker_directory_resolve(text) from public, anon, authenticated;
grant execute on function public.watchmarker_directory_reserve(text,text,text,text,timestamptz), public.watchmarker_directory_resolve(text) to service_role;
notify pgrst, 'reload schema';
commit;
