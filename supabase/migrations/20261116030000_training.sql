-- PS Fit trainee app: workouts (video or written), exercises with sets, daily voice recaps,
-- coach messages and booked calls. Same single-owner lock as everything else.

create table public.workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  scheduled_on date not null,
  title        text not null,
  kind         text not null check (kind in ('video','written')),
  video_id     text,                 -- YouTube id for video workouts
  duration_min int,
  note         text,                 -- coach note shown at the top
  completed_at timestamptz,
  feel         text check (feel in ('easy','solid','tough','rough')),
  created_at   timestamptz not null default now()
);
create index workouts_user_day on public.workouts (user_id, scheduled_on);

create table public.workout_exercises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  workout_id    uuid not null references public.workouts on delete cascade,
  position      int not null default 0,
  name          text not null,
  scheme        text,                -- e.g. "3 x 10"
  demo_video_id text,                -- short YouTube demo
  sets          jsonb not null default '[]',  -- [{reps, weight, done}]
  created_at    timestamptz not null default now()
);
create index workout_exercises_workout on public.workout_exercises (workout_id, position);

create table public.recaps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  recorded_at timestamptz not null default now(),
  transcript  text not null
);
create index recaps_user_time on public.recaps (user_id, recorded_at desc);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  from_coach boolean not null default false,
  body       text not null,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index messages_user_time on public.messages (user_id, created_at);

create table public.calls (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  starts_at  timestamptz not null,
  minutes    int not null default 30,
  title      text not null default 'Weekly check-in',
  join_url   text,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['workouts','workout_exercises','recaps','messages','calls'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using (user_id = (select auth.uid()) and (select public.is_owner()))
         with check (user_id = (select auth.uid()) and (select public.is_owner()))', t);
  end loop;
end $$;
