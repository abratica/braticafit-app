-- Coaching: the coach reads and programs clients' training and nutrition through the functions
-- below (each checks the caller is the coach and the person is a client, or the coach), so the
-- table rules stay "your own rows only" and the coach's own screens never mix in client data.

-- Per-client feature switches the client app honors: {"food": true, "weight": true, "targets_edit": true, "move_days": true}
alter table public.members add column if not exists settings jsonb not null default '{}';

alter table public.workouts add column if not exists time_of_day text check (time_of_day in ('morning', 'midday', 'evening'));
alter table public.workouts add column if not exists assigned boolean not null default false;  -- put there by the coach

-- ---------------------------------------------------------------------------
-- Programs: multi-week templates. Assigning copies them onto a calendar.
-- ---------------------------------------------------------------------------
create table public.programs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null,
  description text,
  weeks       int not null default 1 check (weeks between 1 and 12),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table public.program_workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  program_id   uuid not null references public.programs on delete cascade,
  day_index    int not null check (day_index between 0 and 83),   -- days from the start (0 = day 1)
  position     int not null default 0,
  title        text not null,
  kind         text not null check (kind in ('video', 'written')),
  video_id     text,
  duration_min int,
  note         text,
  time_of_day  text check (time_of_day in ('morning', 'midday', 'evening')),
  exercises    jsonb not null default '[]',   -- [{name, scheme, demo_video_id, rest_sec, superset, interval, sets:[{reps, weight}]}]
  created_at   timestamptz not null default now()
);
create index program_workouts_program on public.program_workouts (program_id, day_index, position);
alter table public.workouts add column if not exists program_id uuid references public.programs on delete set null;

alter table public.programs enable row level security;
alter table public.program_workouts enable row level security;
create policy coach_all on public.programs for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()))
  with check (user_id = (select auth.uid()) and (select public.is_owner()));
create policy coach_all on public.program_workouts for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()))
  with check (user_id = (select auth.uid()) and (select public.is_owner()));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Stop unless the caller is the coach and p is one of their clients (or the coach themself).
create or replace function public.assert_coach_of(p uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'coach only'; end if;
  if p is null or not (p = (select auth.uid()) or exists (select 1 from public.members where user_id = p)) then
    raise exception 'not your client';
  end if;
end;
$$;

-- Insert one workout and its exercises for a person. Returns the new workout id.
create or replace function public.put_workout(p_user uuid, w jsonb, p_day date, p_program uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare wid uuid; x jsonb; i int := 0;
begin
  insert into public.workouts (user_id, scheduled_on, title, kind, video_id, duration_min, note, time_of_day, assigned, program_id)
  values (p_user, p_day, coalesce(nullif(btrim(w->>'title'), ''), 'Workout'), coalesce(w->>'kind', 'written'),
          nullif(w->>'video_id', ''), nullif(w->>'duration_min', '')::int, nullif(btrim(w->>'note'), ''),
          nullif(w->>'time_of_day', ''), p_user <> (select auth.uid()), p_program)
  returning id into wid;
  for x in select * from jsonb_array_elements(coalesce(w->'exercises', '[]'::jsonb)) loop
    insert into public.workout_exercises (user_id, workout_id, position, name, scheme, demo_video_id, rest_sec, superset, interval, sets)
    values (p_user, wid, i, coalesce(nullif(btrim(x->>'name'), ''), 'Exercise'), nullif(x->>'scheme', ''), nullif(x->>'demo_video_id', ''),
            nullif(x->>'rest_sec', '')::int, nullif(x->>'superset', ''), case when jsonb_typeof(x->'interval') = 'object' then x->'interval' end,
            coalesce((select jsonb_agg(jsonb_build_object('reps', coalesce(s->>'reps', ''), 'weight', coalesce(s->>'weight', ''),
                                                          'done', coalesce((s->>'done')::boolean, false)))
                      from jsonb_array_elements(coalesce(x->'sets', '[]'::jsonb)) s), '[]'::jsonb));
    i := i + 1;
  end loop;
  return wid;
end;
$$;
revoke all on function public.put_workout(uuid, jsonb, date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Coach functions
-- ---------------------------------------------------------------------------
-- Everything the client page needs: profile, targets, workouts in a date range, food by day, weights.
create or replace function public.coach_client_detail(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare out jsonb;
begin
  perform public.assert_coach_of(p_client);
  select jsonb_build_object(
    'member', (select to_jsonb(m) from public.members m where m.user_id = p_client),
    'targets', (select to_jsonb(t) from public.nutrition_targets t where t.user_id = p_client),
    'workouts', coalesce((
      select jsonb_agg(to_jsonb(w) || jsonb_build_object('exercises', coalesce((
               select jsonb_agg(to_jsonb(x) order by x.position) from public.workout_exercises x where x.workout_id = w.id), '[]'::jsonb))
             order by w.scheduled_on, w.created_at)
      from public.workouts w where w.user_id = p_client and w.scheduled_on between p_from and p_to), '[]'::jsonb),
    'food_days', coalesce((
      select jsonb_agg(d order by d->>'day' desc) from (
        select jsonb_build_object(
          'day', (m.eaten_at at time zone 'America/New_York')::date,
          'kcal', round(sum(coalesce((m.nutrients->>'kcal')::numeric, 0))),
          'protein', round(sum(coalesce((m.nutrients->>'protein')::numeric, 0))),
          'carbs', round(sum(coalesce((m.nutrients->>'carbs')::numeric, 0))),
          'fat', round(sum(coalesce((m.nutrients->>'fat')::numeric, 0))),
          'items', jsonb_agg(jsonb_build_object('name', m.name, 'meal', m.meal, 'at', m.eaten_at, 'servings', m.servings,
                                                'kcal', round(coalesce((m.nutrients->>'kcal')::numeric, 0))) order by m.eaten_at)) d
        from public.meals m
        where m.user_id = p_client and m.eaten_at >= now() - interval '21 days'
        group by (m.eaten_at at time zone 'America/New_York')::date) q), '[]'::jsonb),
    'weights', coalesce((
      select jsonb_agg(jsonb_build_object('at', x.measured_at, 'lb', x.weight_lb) order by x.measured_at)
      from (select * from public.weights where user_id = p_client order by measured_at desc limit 40) x), '[]'::jsonb)
  ) into out;
  return out;
end;
$$;

-- Create or replace one workout on a person's calendar. w = {id?, scheduled_on, title, kind, video_id, duration_min, note, time_of_day, exercises}.
create or replace function public.coach_save_workout(p_client uuid, w jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare wid uuid := nullif(w->>'id', '')::uuid; prog uuid;
begin
  perform public.assert_coach_of(p_client);
  if wid is not null then
    select program_id into prog from public.workouts where id = wid and user_id = p_client;
    if not found then raise exception 'workout not found'; end if;
    delete from public.workouts where id = wid;
  end if;
  return public.put_workout(p_client, w, (w->>'scheduled_on')::date, prog);
end;
$$;

create or replace function public.coach_move_workout(p_id uuid, p_day date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare u uuid;
begin
  select user_id into u from public.workouts where id = p_id;
  perform public.assert_coach_of(u);
  update public.workouts set scheduled_on = p_day where id = p_id;
end;
$$;

create or replace function public.coach_delete_workout(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare u uuid;
begin
  select user_id into u from public.workouts where id = p_id;
  perform public.assert_coach_of(u);
  delete from public.workouts where id = p_id;
end;
$$;

-- Set a person's daily targets. t = the nutrition_targets fields.
create or replace function public.coach_set_targets(p_client uuid, t jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_coach_of(p_client);
  insert into public.nutrition_targets (user_id, sex, age, height_in, weight_lb, activity, goal, pace_lb_wk, protein_per_lb, fat_pct,
                                        kcal, protein_g, carbs_g, fat_g, custom, updated_at)
  values (p_client, nullif(t->>'sex', ''), nullif(t->>'age', '')::int, nullif(t->>'height_in', '')::numeric, nullif(t->>'weight_lb', '')::numeric,
          nullif(t->>'activity', ''), nullif(t->>'goal', ''), coalesce(nullif(t->>'pace_lb_wk', '')::numeric, 0),
          coalesce(nullif(t->>'protein_per_lb', '')::numeric, 0.8), coalesce(nullif(t->>'fat_pct', '')::numeric, 30),
          (t->>'kcal')::int, (t->>'protein_g')::int, (t->>'carbs_g')::int, (t->>'fat_g')::int, coalesce((t->>'custom')::boolean, false), now())
  on conflict (user_id) do update set
    sex = excluded.sex, age = excluded.age, height_in = excluded.height_in, weight_lb = excluded.weight_lb, activity = excluded.activity,
    goal = excluded.goal, pace_lb_wk = excluded.pace_lb_wk, protein_per_lb = excluded.protein_per_lb, fat_pct = excluded.fat_pct,
    kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g,
    custom = excluded.custom, updated_at = now();
end;
$$;

-- Copy a program onto a person's calendar starting on p_start. Returns how many workouts were added.
create or replace function public.coach_assign_program(p_program uuid, p_client uuid, p_start date)
returns int
language plpgsql security definer set search_path = ''
as $$
declare pw record; n int := 0;
begin
  perform public.assert_coach_of(p_client);
  if not exists (select 1 from public.programs where id = p_program and user_id = (select auth.uid())) then
    raise exception 'program not found';
  end if;
  for pw in select * from public.program_workouts where program_id = p_program order by day_index, position loop
    perform public.put_workout(p_client, to_jsonb(pw), p_start + pw.day_index, p_program);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- One row per person (coach first, then clients who have joined) for the dashboard.
create or replace function public.coach_overview(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'coach only'; end if;
  return coalesce((
    select jsonb_agg(row order by (row->>'is_me')::boolean desc, row->>'name')
    from (
      select jsonb_build_object(
        'user_id', p.uid, 'member_id', m.id, 'is_me', p.uid = (select auth.uid()),
        'name', coalesce(m.name, 'You'), 'email', coalesce(m.email, u.email),
        'last_seen_at', m.last_seen_at, 'settings', coalesce(m.settings, '{}'::jsonb),
        'workouts', coalesce((select jsonb_agg(jsonb_build_object('day', w.scheduled_on, 'title', w.title, 'done', w.completed_at is not null, 'feel', w.feel) order by w.scheduled_on)
                              from public.workouts w where w.user_id = p.uid and w.scheduled_on between p_from and p_to), '[]'::jsonb),
        'last_feel', (select w.feel from public.workouts w where w.user_id = p.uid and w.completed_at is not null order by w.completed_at desc limit 1),
        'food_days_7', (select count(distinct (me.eaten_at at time zone 'America/New_York')::date) from public.meals me
                        where me.user_id = p.uid and me.eaten_at >= now() - interval '7 days'),
        'avg_kcal_7', (select round(avg(k)) from (select sum(coalesce((me.nutrients->>'kcal')::numeric, 0)) k from public.meals me
                        where me.user_id = p.uid and me.eaten_at >= now() - interval '7 days'
                        group by (me.eaten_at at time zone 'America/New_York')::date) q),
        'avg_protein_7', (select round(avg(k)) from (select sum(coalesce((me.nutrients->>'protein')::numeric, 0)) k from public.meals me
                        where me.user_id = p.uid and me.eaten_at >= now() - interval '7 days'
                        group by (me.eaten_at at time zone 'America/New_York')::date) q),
        'last_meal_at', (select max(me.eaten_at) from public.meals me where me.user_id = p.uid),
        'targets', (select jsonb_build_object('kcal', t.kcal, 'protein_g', t.protein_g) from public.nutrition_targets t where t.user_id = p.uid),
        'last_weight', (select jsonb_build_object('lb', x.weight_lb, 'at', x.measured_at) from public.weights x where x.user_id = p.uid order by x.measured_at desc limit 1)
      ) as row
      from (select (select auth.uid()) as uid union select user_id from public.members where user_id is not null) p
      left join public.members m on m.user_id = p.uid
      left join auth.users u on u.id = p.uid
    ) r), '[]'::jsonb);
end;
$$;

-- The signed-in client's feature switches (empty for the coach).
create or replace function public.my_settings()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((select settings from public.members where user_id = (select auth.uid())), '{}'::jsonb);
$$;

revoke all on function public.assert_coach_of(uuid) from public, anon;
revoke all on function public.coach_client_detail(uuid, date, date) from public, anon;
revoke all on function public.coach_save_workout(uuid, jsonb) from public, anon;
revoke all on function public.coach_move_workout(uuid, date) from public, anon;
revoke all on function public.coach_delete_workout(uuid) from public, anon;
revoke all on function public.coach_set_targets(uuid, jsonb) from public, anon;
revoke all on function public.coach_assign_program(uuid, uuid, date) from public, anon;
revoke all on function public.coach_overview(date, date) from public, anon;
revoke all on function public.my_settings() from public, anon;
grant execute on function public.coach_client_detail(uuid, date, date) to authenticated;
grant execute on function public.coach_save_workout(uuid, jsonb) to authenticated;
grant execute on function public.coach_move_workout(uuid, date) to authenticated;
grant execute on function public.coach_delete_workout(uuid) to authenticated;
grant execute on function public.coach_set_targets(uuid, jsonb) to authenticated;
grant execute on function public.coach_assign_program(uuid, uuid, date) to authenticated;
grant execute on function public.coach_overview(date, date) to authenticated;
grant execute on function public.my_settings() to authenticated;
