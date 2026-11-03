begin;

create table if not exists public.youtube_video_durations (
  user_id uuid not null default public.watchmarker_history_owner() references auth.users(id),
  str_ident varchar(11) collate "C" not null check (str_ident ~ '^[A-Za-z0-9_-]{11}$'),
  seconds double precision check (seconds > 0 and seconds < 'Infinity'::float8),
  fetched_at bigint not null check (fetched_at between 0 and 9007199254740991),
  expires_at bigint check (expires_at between 1 and 9007199254740991),
  unavailable boolean not null default false,
  primary key (user_id, str_ident),
  check ((unavailable and seconds is null and expires_at is null)
    or (not unavailable and expires_at is not null and expires_at > fetched_at))
);
alter table public.youtube_video_durations enable row level security;
revoke all on public.youtube_video_durations from public, anon, authenticated;
grant select, insert, update, delete on public.youtube_video_durations to authenticated;
drop policy if exists "Read shared video durations" on public.youtube_video_durations;
create policy "Read shared video durations" on public.youtube_video_durations for select to authenticated
  using ((select public.watchmarker_history_owner()) = user_id);
drop policy if exists "Insert shared video durations" on public.youtube_video_durations;
create policy "Insert shared video durations" on public.youtube_video_durations for insert to authenticated
  with check ((select public.watchmarker_history_owner()) = user_id);
drop policy if exists "Update shared video durations" on public.youtube_video_durations;
create policy "Update shared video durations" on public.youtube_video_durations for update to authenticated
  using ((select public.watchmarker_history_owner()) = user_id)
  with check ((select public.watchmarker_history_owner()) = user_id);
drop policy if exists "Purge expired video durations" on public.youtube_video_durations;
create policy "Purge expired video durations" on public.youtube_video_durations for delete to authenticated
  using ((select public.watchmarker_history_owner()) = user_id
    and expires_at <= extract(epoch from now()) * 1000);

create or replace function public.preserve_video_duration()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (new.user_id, new.str_ident) is distinct from (old.user_id, old.str_ident)
      then raise exception 'Video duration identity is immutable'; end if;
    -- Deterministic ordering matches local merge, even for simultaneous fetches.
    if (new.fetched_at, new.unavailable, coalesce(new.seconds, 0), coalesce(new.expires_at, 0))
       <= (old.fetched_at, old.unavailable, coalesce(old.seconds, 0), coalesce(old.expires_at, 0))
      then return old; end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.preserve_video_duration() from public, anon;
drop trigger if exists preserve_video_duration on public.youtube_video_durations;
create trigger preserve_video_duration before insert or update on public.youtube_video_durations
  for each row execute function public.preserve_video_duration();

-- Playback clients keep contract 4; duration-cache support is checked by table access.
notify pgrst, 'reload schema';
commit;
