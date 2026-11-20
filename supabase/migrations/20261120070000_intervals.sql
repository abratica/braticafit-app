-- Interval blocks inside a written workout: {"work": 40, "rest": 20, "rounds": 8, "moves": ["Jumping jacks", ...]}.
-- Each work period uses the next move in the list, cycling.
alter table public.workout_exercises add column if not exists interval jsonb;
