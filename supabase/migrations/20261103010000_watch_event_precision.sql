begin;

-- Import precision is evidence, not event identity. Preserve immutable dates,
-- sources and IDs while converging conservatively on date-only observations.
create or replace function public.preserve_watch_event_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.user_id,new.str_ident,new.event_id,new.watched_at,new.source,new.observed_deletion)
     is distinct from (old.user_id,old.str_ident,old.event_id,old.watched_at,old.source,old.observed_deletion)
    or (old.source <> 'saved' and new.precision <> old.precision)
    then raise exception 'Watch event identity is immutable'; end if;
  if old.source = 'saved' then
    new.precision := case
      when 'day' in (old.precision,new.precision) then 'day'
      when 'inferred' in (old.precision,new.precision) then 'inferred'
      else 'exact' end;
  end if;
  return new;
end;
$$;
revoke execute on function public.preserve_watch_event_identity() from public, anon;
drop trigger if exists preserve_watch_event_identity on public.youtube_watch_events;
create trigger preserve_watch_event_identity before update on public.youtube_watch_events
  for each row execute function public.preserve_watch_event_identity();
grant update on public.youtube_watch_events to authenticated;
drop policy if exists "Merge shared watch precision" on public.youtube_watch_events;
create policy "Merge shared watch precision" on public.youtube_watch_events for update to authenticated
  using ((select public.watchmarker_history_owner()) = user_id)
  with check ((select public.watchmarker_history_owner()) = user_id);

create or replace function public.watchmarker_event_merge_version()
returns integer language sql stable security invoker set search_path = '' as $$ select 1; $$;
revoke execute on function public.watchmarker_event_merge_version() from public, anon;
grant execute on function public.watchmarker_event_merge_version() to authenticated;
notify pgrst, 'reload schema';
commit;
