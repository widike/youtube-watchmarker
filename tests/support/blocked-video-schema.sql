set role authenticated;
set test.owner = '00000000-0000-0000-0000-000000000001';

insert into public.youtube_blocked_videos(str_ident, title, blocked, updated_at, change_id)
values ('aaaaaaaaaaa', 'First', true, 100, '00000000-0000-0000-0000-000000000001');
insert into public.youtube_blocked_videos(str_ident, title, blocked, updated_at, change_id)
values ('aaaaaaaaaaa', '', false, 200, '00000000-0000-0000-0000-000000000002')
on conflict (user_id, str_ident) do update set title = excluded.title,
  blocked = excluded.blocked, updated_at = excluded.updated_at, change_id = excluded.change_id;
-- A returning offline device retries an older block after the unblock.
insert into public.youtube_blocked_videos(str_ident, title, blocked, updated_at, change_id)
values ('aaaaaaaaaaa', 'Stale', true, 100, 'ffffffff-ffff-ffff-ffff-ffffffffffff')
on conflict (user_id, str_ident) do update set title = excluded.title,
  blocked = excluded.blocked, updated_at = excluded.updated_at, change_id = excluded.change_id;
do $$ begin
  if (select blocked from public.youtube_blocked_videos where str_ident = 'aaaaaaaaaaa')
    then raise exception 'Stale block overwrote unblock'; end if;
end $$;
-- Equal-clock revisions use the same UUID ordering as the JavaScript merge.
update public.youtube_blocked_videos set blocked = true,
  change_id = '00000000-0000-0000-0000-000000000003' where str_ident = 'aaaaaaaaaaa';
do $$ begin
  if not (select blocked from public.youtube_blocked_videos where str_ident = 'aaaaaaaaaaa')
    then raise exception 'Equal-clock revision ordering differs'; end if;
  begin
    update public.youtube_blocked_videos set str_ident = 'bbbbbbbbbbb' where str_ident = 'aaaaaaaaaaa';
    raise exception 'Identity update was allowed';
  exception when raise_exception then
    if sqlerrm <> 'Blocked video identity is immutable' then raise; end if;
  end;
  begin
    delete from public.youtube_blocked_videos;
    raise exception 'Tombstone deletion was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Another linked device resolves the same owner; another history is isolated.
select count(*) from public.youtube_blocked_videos;
set test.owner = '00000000-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from public.youtube_blocked_videos) <> 0
    then raise exception 'Another history can read the blocks'; end if;
  begin
    insert into public.youtube_blocked_videos(user_id, str_ident, blocked, updated_at, change_id)
    values ('00000000-0000-0000-0000-000000000001', 'bbbbbbbbbbb', true, 300, '00000000-0000-0000-0000-000000000003');
    raise exception 'Another history can write the blocks';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform * from public.youtube_blocked_videos;
    raise exception 'Anonymous access was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
