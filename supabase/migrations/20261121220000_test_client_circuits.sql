-- One-off: tomorrow's circuit workout for Andrew's own test client account (matched by email hash, so no email is stored here).
do $$
declare uid uuid; wid uuid;
begin
  select m.user_id into uid from public.members m where md5(lower(m.email)) = '13c28f98787fdf9518fc120e22b30d4e' and m.user_id is not null;
  if uid is null then raise notice 'test client not found; skipped'; return; end if;
  if exists (select 1 from public.workouts where user_id = uid and scheduled_on = '2026-11-22' and title = 'Full Body Circuits') then return; end if;
  insert into public.workouts (user_id, scheduled_on, title, kind, assigned)
  values (uid, '2026-11-22', 'Full Body Circuits', 'written', true)
  returning id into wid;
  insert into public.workout_exercises (user_id, workout_id, position, name, scheme, demo_video_id, superset, sets)
  select uid, wid, v.pos, v.name, v.scheme, v.demo, v.sup, v.sets
  from (values
  (0, 'Goblet Squat', '3 × 8', 'vm:121853329', 'A', '[{"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}]'::jsonb),
  (1, 'TRX Row', '3 × 8', null, 'A', '[{"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}]'::jsonb),
  (2, 'Hands-Elevated Push-Up', '3 × 8', 'vm:121949309', 'A', '[{"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}]'::jsonb),
  (3, 'Hex Bar Deadlift', '4 × 8', 'vm:124064396', 'B', '[{"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}]'::jsonb),
  (4, 'Dumbbell Shoulder Press', '4 × 8', 'vm:122797099', 'B', '[{"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}]'::jsonb),
  (5, 'Kneeling Single-Arm Row', '4 × 8', 'vm:123132865', 'B', '[{"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}]'::jsonb),
  (6, 'Farmer''s Carry', '3 × 8', 'vm:124064965', 'C', '[{"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}]'::jsonb),
  (7, 'Ball Slam', '3 × 8', 'TKom9YCmrDs', 'C', '[{"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}, {"reps": "8", "weight": "", "done": false}]'::jsonb)
  ) as v(pos, name, scheme, demo, sup, sets);
end $$;
