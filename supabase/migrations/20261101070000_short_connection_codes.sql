begin;

-- Existing memberships/history stay untouched. Long codes are replaced.
alter table private.watchmarker_links add column if not exists registration_hash bytea;
create table if not exists private.watchmarker_link_attempts (
  device_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default clock_timestamp()
);
create index if not exists watchmarker_link_attempts_time
  on private.watchmarker_link_attempts(attempted_at);
revoke all on private.watchmarker_link_attempts from public, anon, authenticated;
alter table private.watchmarker_link_attempts enable row level security;

drop function if exists public.watchmarker_create_link();
create or replace function public.watchmarker_create_short_link()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  owner uuid;
  token text;
  proof text := encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex');
  entropy bytea;
  byte_value integer;
  i integer;
begin
  if caller is null then raise exception 'A device session is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('watchmarker-short-links', 0));
  owner := public.watchmarker_history_owner();
  insert into private.watchmarker_devices(device_id, owner_id) values (caller, owner) on conflict do nothing;
  delete from private.watchmarker_links where issued_by = caller or expires_at < clock_timestamp();
  loop
    token := '';
    -- UUID entropy, hashed and rejection sampled to avoid alphabet bias.
    while length(token) < 6 loop
      entropy := sha256(convert_to(gen_random_uuid()::text, 'UTF8'));
      for i in 0..31 loop
        byte_value := get_byte(entropy, i);
        if byte_value < 234 then token := token || chr(65 + byte_value % 26); end if;
        exit when length(token) = 6;
      end loop;
    end loop;
    begin
      insert into private.watchmarker_links(token_hash, owner_id, issued_by, expires_at, registration_hash)
        values (sha256(convert_to(token, 'UTF8')), owner, caller, clock_timestamp() + interval '10 minutes', sha256(convert_to(proof, 'UTF8')));
      return jsonb_build_object('code', token, 'proof', proof);
    exception when unique_violation then
      -- A live code is never reassigned to a second history.
    end;
  end loop;
end;
$$;

-- The directory verifies issuance without receiving any device Auth token.
-- A random 256-bit proof is required, so this cannot test guesses at short codes.
create or replace function public.watchmarker_link_registration(p_token text, p_proof text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('expiresAt', expires_at,
    'issuer', encode(sha256(convert_to(issued_by::text, 'UTF8')), 'hex'))
  from private.watchmarker_links
  where p_token ~ '^[A-Z]{6}$' and p_proof ~ '^[a-f0-9]{64}$'
    and token_hash = sha256(convert_to(p_token, 'UTF8'))
    and registration_hash = sha256(convert_to(p_proof, 'UTF8'))
    and claimed_by is null and expires_at > now();
$$;
revoke execute on function public.watchmarker_link_registration(text, text) from public;
grant execute on function public.watchmarker_link_registration(text, text) to anon, authenticated;

create or replace function public.watchmarker_claim_link(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  invitation private.watchmarker_links%rowtype;
  existing_owner uuid;
begin
  if caller is null then raise exception 'A device session is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('watchmarker-short-links', 0));
  delete from private.watchmarker_link_attempts where attempted_at <= clock_timestamp() - interval '10 minutes';
  if p_token ~ '^[A-Z]{6}$' then
    select * into invitation from private.watchmarker_links
      where token_hash = sha256(convert_to(p_token, 'UTF8')) and expires_at > clock_timestamp() for update;
    -- A lost successful response can always be retried by that same identity.
    if found and invitation.claimed_by = caller then return invitation.owner_id; end if;
  end if;
  if (select count(*) from private.watchmarker_link_attempts where device_id = caller) >= 5
    or (select count(*) from private.watchmarker_link_attempts) >= 100 then return null; end if;
  insert into private.watchmarker_link_attempts(device_id) values (caller);
  -- Return failures rather than raising: exceptions would roll back the limit.
  if p_token is null or p_token !~ '^[A-Z]{6}$' then return null; end if;
  if invitation.token_hash is null or invitation.claimed_by is not null then return null; end if;
  select owner_id into existing_owner from private.watchmarker_devices where device_id = caller;
  if existing_owner is not null and existing_owner <> invitation.owner_id then return null; end if;
  if caller <> invitation.owner_id and exists (select 1 from public.youtube_watch_history where user_id = caller) then return null; end if;
  insert into private.watchmarker_devices(device_id, owner_id) values (caller, invitation.owner_id) on conflict do nothing;
  update private.watchmarker_links set claimed_by = caller where token_hash = invitation.token_hash;
  return invitation.owner_id;
end;
$$;

revoke execute on function public.watchmarker_create_short_link(), public.watchmarker_claim_link(text) from public, anon;
grant execute on function public.watchmarker_create_short_link(), public.watchmarker_claim_link(text) to authenticated;
notify pgrst, 'reload schema';
commit;
