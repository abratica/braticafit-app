-- Rest between sets (seconds; empty = the 90 s default) and superset grouping
-- (exercises in one workout sharing a letter, shown as A1, A2, ...).
alter table public.workout_exercises add column if not exists rest_sec int check (rest_sec between 0 and 900);
alter table public.workout_exercises add column if not exists superset text check (superset ~ '^[A-Z]$');
