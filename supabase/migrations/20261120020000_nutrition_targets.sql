-- Daily calorie and macro targets, one row per person, plus the calculator inputs that produced them.

create table public.nutrition_targets (
  user_id        uuid primary key default auth.uid() references auth.users on delete cascade,
  sex            text check (sex in ('male', 'female')),
  age            int check (age between 13 and 100),
  height_in      numeric check (height_in between 48 and 96),
  weight_lb      numeric check (weight_lb > 0),
  activity       text check (activity in ('sedentary', 'light', 'moderate', 'very', 'extra')),
  goal           text check (goal in ('lose', 'maintain', 'gain')),
  pace_lb_wk     numeric not null default 0,
  protein_per_lb numeric not null default 0.8,
  fat_pct        numeric not null default 30,
  kcal           int not null check (kcal > 0),
  protein_g      int not null check (protein_g >= 0),
  carbs_g        int not null check (carbs_g >= 0),
  fat_g          int not null check (fat_g >= 0),
  custom         boolean not null default false,   -- numbers edited by hand instead of calculated
  updated_at     timestamptz not null default now()
);

alter table public.nutrition_targets enable row level security;
create policy own_rows on public.nutrition_targets for all to authenticated
  using (user_id = (select auth.uid()) and (select public.can_use()))
  with check (user_id = (select auth.uid()) and (select public.can_use()));
