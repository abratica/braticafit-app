-- Coach Library: YouTube clips Andrew saves as the demo for a named exercise.
-- Coach-only data; same owner lock as everything else until client accounts exist.

create table public.coach_demos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  video_id      text not null,
  exercise_name text not null,
  title         text,
  seconds       int,
  channel       text,
  created_at    timestamptz not null default now(),
  unique (user_id, video_id)
);
create index coach_demos_user_name on public.coach_demos (user_id, exercise_name);

alter table public.coach_demos enable row level security;
create policy owner_all on public.coach_demos for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()))
  with check (user_id = (select auth.uid()) and (select public.is_owner()));
