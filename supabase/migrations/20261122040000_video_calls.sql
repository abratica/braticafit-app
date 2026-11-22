-- In-app video calls (Daily) with call notes written from Daily's live transcript.
-- The coach books calls; clients only read their own. The transcript itself stays coach-only.

alter table public.calls
  add column if not exists room_name    text unique,
  add column if not exists joined_at    timestamptz,
  add column if not exists reminded_at  timestamptz,
  add column if not exists notes        jsonb,
  add column if not exists notes_status text not null default 'waiting',
  add column if not exists notes_tries  int not null default 0,
  add column if not exists notes_at     timestamptz;
alter table public.calls drop constraint if exists calls_notes_status_check;
alter table public.calls add constraint calls_notes_status_check check (notes_status in ('waiting', 'done', 'none', 'failed'));
alter table public.calls drop constraint if exists calls_minutes_check;
alter table public.calls add constraint calls_minutes_check check (minutes between 5 and 180);
create index if not exists calls_starts on public.calls (starts_at);

create table if not exists public.call_transcripts (
  call_id    uuid primary key references public.calls on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
alter table public.call_transcripts enable row level security;   -- no policies: coach reads through coach_call()

alter table public.members add column if not exists call_consent_at timestamptz;

-- Clients (and the coach for their own rows) can read calls; nobody writes them directly.
drop policy if exists own_rows on public.calls;
drop policy if exists owner_all on public.calls;
drop policy if exists own_read on public.calls;
create policy own_read on public.calls for select to authenticated
  using (user_id = (select auth.uid()) and (select public.can_use()));

-- ---------- client ----------
create or replace function public.call_consent()
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select call_consent_at from public.members where user_id = (select auth.uid());
$$;

create or replace function public.give_call_consent()
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare t timestamptz;
begin
  update public.members set call_consent_at = coalesce(call_consent_at, now())
   where user_id = (select auth.uid()) returning call_consent_at into t;
  return t;
end;
$$;

-- ---------- coach ----------
create or replace function public.coach_calls(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'coach only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'user_id', c.user_id, 'starts_at', c.starts_at, 'minutes', c.minutes, 'title', c.title,
             'joined_at', c.joined_at, 'notes', c.notes, 'notes_status', c.notes_status, 'notes_at', c.notes_at,
             'name', coalesce(m.name, m.email, 'You'), 'consent', m.call_consent_at is not null,
             'has_transcript', exists (select 1 from public.call_transcripts t where t.call_id = c.id))
           order by c.starts_at)
    from public.calls c left join public.members m on m.user_id = c.user_id
    where c.starts_at >= p_from and c.starts_at < p_to), '[]'::jsonb);
end;
$$;

-- Book a call (p_id null) or move/rename one. Changing the time drops the old room so a fresh one is made.
create or replace function public.coach_save_call(p_id uuid, p_client uuid, p_starts timestamptz, p_minutes int, p_title text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare cid uuid;
begin
  perform public.assert_coach_of(p_client);
  if p_starts is null then raise exception 'pick a time'; end if;
  if p_id is null then
    insert into public.calls (user_id, starts_at, minutes, title)
    values (p_client, p_starts, coalesce(p_minutes, 30), coalesce(nullif(btrim(p_title), ''), 'Check-in call'))
    returning id into cid;
  else
    update public.calls
       set user_id = p_client,
           room_name = case when starts_at = p_starts and minutes = coalesce(p_minutes, minutes) then room_name end,
           reminded_at = case when starts_at = p_starts then reminded_at end,
           starts_at = p_starts, minutes = coalesce(p_minutes, minutes),
           title = coalesce(nullif(btrim(p_title), ''), title)
     where id = p_id and joined_at is null
    returning id into cid;
    if cid is null then raise exception 'That call already happened'; end if;
  end if;
  return cid;
end;
$$;

create or replace function public.coach_delete_call(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'coach only'; end if;
  delete from public.calls where id = p_id;
end;
$$;

-- One call with its transcript.
create or replace function public.coach_call(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare out jsonb;
begin
  if not public.is_owner() then raise exception 'coach only'; end if;
  select to_jsonb(c) || jsonb_build_object('name', coalesce(m.name, m.email, 'You'), 'transcript', t.body)
    into out
    from public.calls c
    left join public.members m on m.user_id = c.user_id
    left join public.call_transcripts t on t.call_id = c.id
   where c.id = p_id;
  return out;
end;
$$;

-- Fix up notes before (or after) the client reads them.
create or replace function public.coach_save_notes(p_id uuid, p_notes jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'coach only'; end if;
  update public.calls set notes = p_notes, notes_status = 'done', notes_at = coalesce(notes_at, now()) where id = p_id;
end;
$$;

revoke all on function public.call_consent() from public, anon;
revoke all on function public.give_call_consent() from public, anon;
revoke all on function public.coach_calls(timestamptz, timestamptz) from public, anon;
revoke all on function public.coach_save_call(uuid, uuid, timestamptz, int, text) from public, anon;
revoke all on function public.coach_delete_call(uuid) from public, anon;
revoke all on function public.coach_call(uuid) from public, anon;
revoke all on function public.coach_save_notes(uuid, jsonb) from public, anon;
grant execute on function public.call_consent() to authenticated;
grant execute on function public.give_call_consent() to authenticated;
grant execute on function public.coach_calls(timestamptz, timestamptz) to authenticated;
grant execute on function public.coach_save_call(uuid, uuid, timestamptz, int, text) to authenticated;
grant execute on function public.coach_delete_call(uuid) to authenticated;
grant execute on function public.coach_call(uuid) to authenticated;
grant execute on function public.coach_save_notes(uuid, jsonb) to authenticated;

-- Reminders and call notes: every 5 minutes.
select cron.unschedule('bf-calls') where exists (select 1 from cron.job where jobname = 'bf-calls');
select cron.schedule('bf-calls', '*/5 * * * *', $$ select private.call_jobs('calls') $$);
