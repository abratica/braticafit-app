-- Education videos, "helps with" notes and start times on Library entries; start time on sent videos.

alter table public.coach_demos drop constraint if exists coach_demos_kind_check;
alter table public.coach_demos add constraint coach_demos_kind_check check (kind in ('exercise', 'workout', 'education'));
alter table public.coach_demos
  add column helps_with text,   -- the coach's note: what this video helps with (read by the suggester)
  add column start_sec  int check (start_sec is null or start_sec >= 0);

-- Saves from the education channels count as Education.
update public.coach_demos set kind = 'education'
where channel in ('Squat University', 'E3 Rehab', 'The Prehab Guys', '[P]rehab', 'Tom Morrison', 'Jeff Nippard');

alter table public.messages add column video_start int;

drop function if exists public.coach_send(uuid, text, text, int, text, text, text);
create or replace function public.coach_send(p_client uuid, p_body text, p_audio_path text, p_audio_sec int,
                                             p_video_id text, p_video_title text, p_video_thumb text, p_video_start int default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare mid uuid;
begin
  perform public.assert_coach_of(p_client);
  if p_audio_path is not null and p_audio_path not like p_client::text || '/%' then raise exception 'bad audio path'; end if;
  insert into public.messages (user_id, from_coach, body, audio_path, audio_sec, transcript_status, video_id, video_title, video_thumb, video_start)
  values (p_client, true, nullif(btrim(p_body), ''), p_audio_path, p_audio_sec,
          case when p_audio_path is not null then 'pending' end, p_video_id, p_video_title, p_video_thumb,
          case when p_video_id is not null then nullif(p_video_start, 0) end)
  returning id into mid;
  return mid;
end;
$$;
revoke all on function public.coach_send(uuid, text, text, int, text, text, text, int) from public, anon;
grant execute on function public.coach_send(uuid, text, text, int, text, text, text, int) to authenticated;
