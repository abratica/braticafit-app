-- People who asked for access from the sign-in screen. Written by the api edge function;
-- only the coach can read or change them.

create table public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  name       text not null,
  note       text,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create unique index access_requests_one_pending on public.access_requests (email) where status = 'pending';

alter table public.access_requests enable row level security;
create policy coach_all on public.access_requests for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
