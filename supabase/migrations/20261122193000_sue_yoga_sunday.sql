-- One-off: save Kassandra's 20-min flexibility yoga to the coach's library as a workout,
-- and put it on Sue's day today (Sun Nov 22) as a video workout.
do $$
declare owner uuid; sue uuid; n int;
begin
  select value::uuid into owner from private.config where key = 'owner_id';
  if owner is not null then
    insert into public.coach_demos (user_id, video_id, exercise_name, title, seconds, channel, kind)
    values (owner, 's-1vMbAgYWU', 'Yoga for Flexibility (20 min)', '20 min Yoga for Flexibility - Sweet Release Feel Good Flow', 1200, 'Yoga with Kassandra', 'workout')
    on conflict (user_id, video_id) do nothing;
  end if;

  -- Sue: the one client whose name starts with Sue. Her account exists once she has made a password.
  select count(*) into n from public.members where name ilike 'sue%' or name ilike 'susan%';
  if n <> 1 then raise notice 'SUE: found % matching clients; workout not added', n; return; end if;
  select coalesce(m.user_id, (select u.id from auth.users u where lower(u.email) = m.email limit 1)) into sue
    from public.members m where m.name ilike 'sue%' or m.name ilike 'susan%';
  if sue is null then raise notice 'SUE: no account yet (password not made); workout not added'; return; end if;

  if not exists (select 1 from public.workouts where user_id = sue and scheduled_on = '2026-11-22' and video_id = 's-1vMbAgYWU') then
    insert into public.workouts (user_id, scheduled_on, title, kind, video_id, duration_min, assigned)
    values (sue, '2026-11-22', 'Yoga for Flexibility', 'video', 's-1vMbAgYWU', 20, true);
  end if;
  raise notice 'SUE: workout added';
end $$;
