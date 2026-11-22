-- One-off: move Monday's "Full Body Intervals" from the coach account to Andrew's phone account
-- (his test client, matched by email hash so no email is stored here).
do $$
declare owner uuid; phone uuid;
begin
  select value::uuid into owner from private.config where key = 'owner_id';
  select m.user_id into phone from public.members m where md5(lower(m.email)) = '13c28f98787fdf9518fc120e22b30d4e' and m.user_id is not null;
  if owner is null or phone is null then raise notice 'account missing; skipped'; return; end if;
  update public.workout_exercises x set user_id = phone
    from public.workouts w
   where x.workout_id = w.id and w.user_id = owner and w.scheduled_on = '2026-11-23' and w.title = 'Full Body Intervals';
  update public.workouts set user_id = phone, assigned = true
   where user_id = owner and scheduled_on = '2026-11-23' and title = 'Full Body Intervals';
end $$;
