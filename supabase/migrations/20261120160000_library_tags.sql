-- Library entries get tags so the Library and Browse pages can filter them:
-- kind (exercise vs. full workout), equipment, movement pattern, coaching cues, and a thumbnail.

alter table public.coach_demos
  add column kind      text   not null default 'exercise' check (kind in ('exercise', 'workout')),
  add column equipment text[] not null default '{}',
  add column pattern   text,
  add column cues      text,
  add column thumb     text;

-- Existing saves: anything longer than 3 minutes counts as a workout.
update public.coach_demos set kind = 'workout' where seconds > 180;

-- The six Precision Nutrition test demos.
update public.coach_demos d set equipment = v.eq, pattern = v.pattern
from (values
  ('vm:121853329', array['dumbbell'],   'Squat'),
  ('vm:111129796', array['dumbbell'],   'Squat'),
  ('vm:121851656', array['dumbbell'],   'Hinge'),
  ('vm:122357903', array['bodyweight'], 'Horizontal push'),
  ('vm:123132865', array['dumbbell'],   'Horizontal pull'),
  ('vm:121850313', array['bodyweight'], 'Core')
) as v(video_id, eq, pattern)
where d.video_id = v.video_id;
