begin;

-- Each installation has its own Auth session. Only these narrow RPCs can
-- change membership; publishing a project key does not grant history access.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.watchmarker_devices (
  device_id uuid primary key references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  linked_at timestamptz not null default now()
);
create table if not exists private.watchmarker_links (
  token_hash bytea primary key,
  owner_id uuid not null references auth.users(id),
  issued_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  claimed_by uuid references auth.users(id) on delete cascade
);
revoke all on private.watchmarker_devices, private.watchmarker_links from public, anon, authenticated;

create or replace function public.watchmarker_history_owner()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((select owner_id from private.watchmarker_devices where device_id = auth.uid()), auth.uid());
$$;

create or replace function public.watchmarker_create_link()
returns text language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  owner uuid;
  token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if caller is null then raise exception 'A device session is required'; end if;
  -- Serialize issuance by this installation; a new code replaces its old code.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  owner := public.watchmarker_history_owner();
  insert into private.watchmarker_devices(device_id, owner_id) values (caller, owner) on conflict do nothing;
  delete from private.watchmarker_links where issued_by = caller or expires_at < now();
  insert into private.watchmarker_links(token_hash, owner_id, issued_by, expires_at)
    values (sha256(convert_to(token, 'UTF8')), owner, caller, now() + interval '10 minutes');
  return token;
end;
$$;

create or replace function public.watchmarker_claim_link(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  invitation private.watchmarker_links%rowtype;
  existing_owner uuid;
begin
  if caller is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid connection code'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  select * into invitation from private.watchmarker_links
    where token_hash = sha256(convert_to(p_token, 'UTF8')) and expires_at > now() for update;
  if not found or (invitation.claimed_by is not null and invitation.claimed_by <> caller) then
    raise exception 'Connection code expired or already used. Create another code on a connected device.';
  end if;
  select owner_id into existing_owner from private.watchmarker_devices where device_id = caller;
  if existing_owner is not null and existing_owner <> invitation.owner_id then
    raise exception 'Device is already linked to another history';
  end if;
  -- Never strand an existing account's cloud rows by rebinding its identity.
  if caller <> invitation.owner_id and exists (select 1 from public.youtube_watch_history where user_id = caller) then
    raise exception 'This device already owns a different cloud history';
  end if;
  insert into private.watchmarker_devices(device_id, owner_id) values (caller, invitation.owner_id) on conflict do nothing;
  update private.watchmarker_links set claimed_by = caller where token_hash = invitation.token_hash;
  return invitation.owner_id;
end;
$$;

revoke execute on function public.watchmarker_history_owner(), public.watchmarker_create_link(), public.watchmarker_claim_link(text) from public, anon;
grant execute on function public.watchmarker_history_owner(), public.watchmarker_create_link(), public.watchmarker_claim_link(text) to authenticated;

alter table public.youtube_watch_history alter column user_id set default public.watchmarker_history_owner();
drop policy if exists "Users can view their watch history" on public.youtube_watch_history;
create policy "Users can view their watch history" on public.youtube_watch_history for select to authenticated
  using ((select public.watchmarker_history_owner()) = user_id);
drop policy if exists "Users can insert their watch history" on public.youtube_watch_history;
create policy "Users can insert their watch history" on public.youtube_watch_history for insert to authenticated
  with check ((select public.watchmarker_history_owner()) = user_id);
drop policy if exists "Users can update their watch history" on public.youtube_watch_history;
create policy "Users can update their watch history" on public.youtube_watch_history for update to authenticated
  using ((select public.watchmarker_history_owner()) = user_id)
  with check ((select public.watchmarker_history_owner()) = user_id);

alter table public.youtube_watch_events alter column user_id set default public.watchmarker_history_owner();
drop policy if exists "Read own watches" on public.youtube_watch_events;
create policy "Read own watches" on public.youtube_watch_events for select to authenticated
  using ((select public.watchmarker_history_owner()) = user_id);
drop policy if exists "Append own watches" on public.youtube_watch_events;
create policy "Append own watches" on public.youtube_watch_events for insert to authenticated
  with check ((select public.watchmarker_history_owner()) = user_id);

notify pgrst, 'reload schema';
commit;
