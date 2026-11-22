-- One-off: Monday's interval workout for Andrew's own account (the app owner).
-- 3 rounds of 5 exercises, 30 s on / 30 s off, 2 minutes between rounds, 30 s to get ready.
do $$
declare uid uuid; wid uuid;
begin
  select value::uuid into uid from private.config where key = 'owner_id';
  if uid is null then raise notice 'no owner yet; skipped'; return; end if;
  if exists (select 1 from public.workouts where user_id = uid and scheduled_on = '2026-11-23' and title = 'Full Body Intervals') then return; end if;
  insert into public.workouts (user_id, scheduled_on, title, kind, duration_min, assigned)
  values (uid, '2026-11-23', 'Full Body Intervals', 'written', 18, false)
  returning id into wid;
  insert into public.workout_exercises (user_id, workout_id, position, name, scheme, interval, sets)
  values (uid, wid, 0, 'Full Body Intervals', '3 rounds · 30s on / 30s off',
          '{"work": 30, "rest": 30, "rounds": 3, "round_rest": 120, "prep": 30, "circuit": true,
            "moves": ["Goblet Squat", "Dumbbell Shoulder Press", "TRX Row", "Hex Bar Deadlift", "Push-Up"]}'::jsonb,
          '[{"reps": "", "weight": "", "done": false}]'::jsonb);
end $$;
