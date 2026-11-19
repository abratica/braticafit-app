-- Client accounts.
-- The coach (the app owner) invites people by email. Someone who signs in with an
-- invited email becomes a client. Everyone, coach included, can only read and write
-- their own rows. The invite list and coach data (coach_demos) stay coach-only.

create table public.members (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique check (email = lower(btrim(email)) and email like '%_@_%'),
  name         text,
  user_id      uuid unique references auth.users on delete set null,
  invited_at   timestamptz not null default now(),
  joined_at    timestamptz,
  last_seen_at timestamptz
);

alter table public.members enable row level security;
create policy coach_all on public.members for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- Is the caller a client who has joined?
create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()));
$$;

-- Coach or client: allowed to use the app at all.
create or replace function public.can_use()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_owner() or public.is_member();
$$;

-- Read-only role check (used by the edge functions).
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = ''
as $$
  select case when public.is_owner() then 'coach'
              when public.is_member() then 'client' end;
$$;

-- Called on every sign-in. Claims the app for the first account (as before), links an
-- invited email to its account, and returns 'coach', 'client' or null (no access).
create or replace function public.join_app()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid  uuid := (select auth.uid());
  mail text;
begin
  if uid is null then return null; end if;
  if public.claim_owner() then return 'coach'; end if;

  select lower(email) into mail from auth.users where id = uid;
  update public.members
     set user_id = uid,
         joined_at = coalesce(joined_at, now()),
         last_seen_at = now()
   where email = mail and (user_id is null or user_id = uid);
  if found then return 'client'; end if;
  return null;
end;
$$;

-- Save this device's push subscription for whoever is signed in now. One phone can be
-- signed into different accounts over time, so the device moves to the current account.
create or replace function public.save_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_use() then raise exception 'no access'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> (select auth.uid());
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

revoke all on function public.is_member()  from public, anon;
revoke all on function public.can_use()    from public, anon;
revoke all on function public.my_role()    from public, anon;
revoke all on function public.join_app()   from public, anon;
revoke all on function public.save_push(text, text, text) from public, anon;
grant execute on function public.is_member()  to authenticated;
grant execute on function public.can_use()    to authenticated;
grant execute on function public.my_role()    to authenticated;
grant execute on function public.join_app()   to authenticated;
grant execute on function public.save_push(text, text, text) to authenticated;

-- Personal tables: each account (coach or client) sees only its own rows.
do $$
declare t text;
begin
  foreach t in array array['foods','meals','weights','labs','observations','push_subscriptions',
                           'workouts','workout_exercises','recaps','messages','calls'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated
         using (user_id = (select auth.uid()) and (select public.can_use()))
         with check (user_id = (select auth.uid()) and (select public.can_use()))', t);
  end loop;
end $$;
