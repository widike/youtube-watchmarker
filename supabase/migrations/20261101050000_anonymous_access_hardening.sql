begin;

-- Anonymous Auth sessions use authenticated, not anon. These restrictive
-- policies AND ownership with every permissive policy, including old policies
-- with a different name. Never infer ownership from user-editable JWT metadata.
do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'youtube_watch_history', 'youtube_watch_events', 'youtube_watch_time'
  ] loop
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('revoke all on public.%I from public, anon, authenticated', relation_name);
    execute format('drop policy if exists "Enforce history ownership" on public.%I', relation_name);
    execute format(
      'create policy "Enforce history ownership" on public.%I as restrictive for all to public
       using ((select auth.uid()) is not null and (select public.watchmarker_history_owner()) = user_id)
       with check ((select auth.uid()) is not null and (select public.watchmarker_history_owner()) = user_id)',
      relation_name
    );
  end loop;
end;
$$;

grant select, insert, update on public.youtube_watch_history, public.youtube_watch_time to authenticated;
grant select, insert on public.youtube_watch_events to authenticated;

-- Membership and invitation hashes are never Data API tables. Definer RPCs
-- run as their owner; browser roles get neither schema nor table access.
revoke all on schema private from public, anon, authenticated;
revoke all on private.watchmarker_devices, private.watchmarker_links from public, anon, authenticated;
alter table private.watchmarker_devices enable row level security;
alter table private.watchmarker_links enable row level security;

revoke execute on function public.watchmarker_history_owner(), public.watchmarker_create_link(), public.watchmarker_claim_link(text) from public, anon;
grant execute on function public.watchmarker_history_owner(), public.watchmarker_create_link(), public.watchmarker_claim_link(text) to authenticated;

-- Old installations may still expose administrative SECURITY DEFINER helpers.
-- Revoke every overload if present; keep server-side grants unchanged.
do $$
declare routine regprocedure;
begin
  for routine in
    select p.oid::regprocedure from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'audit_youtube_watch_history', 'cleanup_old_watch_history',
      'get_rls_status', 'get_user_watch_count',
      'preserve_watch_history_progress', 'summarize_watch_event', 'preserve_playback_time'
    )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', routine);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
