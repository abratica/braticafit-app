-- Test batch: 6 Precision Nutrition demos (Vimeo) saved to the coach's Library under "My demos".
-- Video ids use the "vm:<vimeo id>" form. Each can be removed from the player with "Remove".

insert into public.coach_demos (user_id, video_id, exercise_name, title, seconds, channel)
select c.value::uuid, v.video_id, v.exercise_name, v.title, v.seconds, 'Precision Nutrition'
from private.config c
cross join (values
  ('vm:121853329', 'Goblet Squat',               'Men''s Goblet Squat',               48),
  ('vm:111129796', 'Goblet Squat',               'Women''s Goblet Squat',             44),
  ('vm:121851656', 'Dumbbell Romanian Deadlift', 'Men''s Dumbbell Romanian Deadlift', 45),
  ('vm:122357903', 'Pushup',                     'Men''s Pushup',                     50),
  ('vm:123132865', 'Single-Arm Dumbbell Row',    'Men''s Single-Arm Dumbbell Row',    50),
  ('vm:121850313', 'Dead Bug',                   'Men''s Dead Bug',                   44)
) as v(video_id, exercise_name, title, seconds)
where c.key = 'owner_id'
on conflict (user_id, video_id) do nothing;
