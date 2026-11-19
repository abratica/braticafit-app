-- Welcome email for new clients: the coach's editable wording, and when each client was sent it.

create table public.coach_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.coach_settings enable row level security;
create policy coach_all on public.coach_settings for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

alter table public.members add column if not exists welcomed_at timestamptz;
