-- Pull-Up: use Precision Nutrition's short demo instead of the long how-to.
-- Workouts store the men's version; the client app shows the women's version to clients whose
-- targets say female (and to clients with no sex set), so each client sees the matching demo.

insert into public.coach_demos (user_id, video_id, exercise_name, title, seconds, channel, kind, equipment, pattern, cues, thumb)
select c.value::uuid, v.video_id, 'Pull-Up', v.title, v.seconds, 'Precision Nutrition', 'exercise', array['bodyweight'], 'Vertical pull',
  '1. Fully extend your arms and let your shoulder blades spread at the bottom. 2. Pull the bar to your chest. 3. Finish the motion with your shoulder blades squeezed fully together and down and your elbows just behind your ribs. 4. Don''t let your shoulders pop forward at the finish.',
  v.thumb
from private.config c
cross join (values
  ('vm:122357901', 'Men''s Pull-Up', 40, 'https://i.vimeocdn.com/video/522093378-45ca3459de4fb8f3d99782ed6108285435237041bc2ee2c8ea63d95539ebd216-d_640x360?region=us'),
  ('vm:111472867', 'Women''s Pull-Up', 47, 'https://i.vimeocdn.com/video/519473290-cc43e1b5552d25bc509fc875d57e3c17f4e816fbfb24a49ec449672fa43dc5b7-d_640x360?region=us')
) as v(video_id, title, seconds, thumb)
where c.key = 'owner_id'
on conflict (user_id, video_id) do nothing;

-- Every plain "Pull-Up" already on a calendar.
update public.workout_exercises
set demo_video_id = 'vm:122357901'
where name ~* '^\s*pull[\s-]*ups?\s*$';

-- And in program templates, so future assignments get it too.
update public.program_workouts pw
set exercises = (
  select jsonb_agg(case when e->>'name' ~* '^\s*pull[\s-]*ups?\s*$'
                        then jsonb_set(e, '{demo_video_id}', '"vm:122357901"') else e end order by ord)
  from jsonb_array_elements(pw.exercises) with ordinality as t(e, ord))
where exists (select 1 from jsonb_array_elements(pw.exercises) e where e->>'name' ~* '^\s*pull[\s-]*ups?\s*$');
