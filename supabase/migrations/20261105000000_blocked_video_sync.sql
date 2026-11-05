begin;

create table if not exists public.youtube_blocked_videos (
  user_id uuid not null default public.watchmarker_history_owner() references auth.users(id),
  str_ident varchar(11) collate "C" not null check (str_ident ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null default '' check (length(title) <= 2000),
  blocked boolean not null,
  updated_at bigint not null check (updated_at between 0 and 9007199254740991),
  change_id uuid not null,
  primary key (user_id, str_ident)
);
alter table public.youtube_blocked_videos enable row level security;
revoke all on public.youtube_blocked_videos from public, anon, authenticated;
grant select, insert, update on public.youtube_blocked_videos to authenticated;
drop policy if exists "Read shared blocked videos" on public.youtube_blocked_videos;
create policy "Read shared blocked videos" on public.youtube_blocked_videos for select to authenticated
  using ((select public.watchmarker_history_owner()) = user_id);
drop policy if exists "Insert shared blocked videos" on public.youtube_blocked_videos;
create policy "Insert shared blocked videos" on public.youtube_blocked_videos for insert to authenticated
  with check ((select public.watchmarker_history_owner()) = user_id);
drop policy if exists "Update shared blocked videos" on public.youtube_blocked_videos;
create policy "Update shared blocked videos" on public.youtube_blocked_videos for update to authenticated
  using ((select public.watchmarker_history_owner()) = user_id)
  with check ((select public.watchmarker_history_owner()) = user_id);

create or replace function public.preserve_blocked_video_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (new.user_id, new.str_ident) is distinct from (old.user_id, old.str_ident)
      then raise exception 'Blocked video identity is immutable'; end if;
    if (new.updated_at, new.change_id) <= (old.updated_at, old.change_id)
      then return old; end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.preserve_blocked_video_revision() from public, anon;
drop trigger if exists preserve_blocked_video_revision on public.youtube_blocked_videos;
create trigger preserve_blocked_video_revision before insert or update on public.youtube_blocked_videos
  for each row execute function public.preserve_blocked_video_revision();

-- Retain unblocked rows as tombstones so stale offline blocks cannot reappear.
notify pgrst, 'reload schema';
commit;
