-- Voice + text messages between the coach and each client, with transcripts and
-- coach-only video suggestions. Thread key: messages.user_id = the client.

alter table public.messages
  alter column body drop not null,
  add column audio_path        text,     -- voice/<client id>/<file> in the private "voice" bucket
  add column audio_sec         int,
  add column transcript        text,
  add column transcript_status text check (transcript_status in ('pending', 'done', 'failed')),
  add column video_id          text,     -- a video the coach attached
  add column video_title       text,
  add column video_thumb       text,
  add constraint messages_has_content check (coalesce(btrim(body), '') <> '' or audio_path is not null or video_id is not null);

-- Clients: read their own thread, send as themselves, and mark the coach's messages read. Nothing else.
drop policy if exists own_rows on public.messages;
create policy own_select on public.messages for select to authenticated
  using (user_id = (select auth.uid()) and (select public.can_use()));
create policy own_insert on public.messages for insert to authenticated
  with check (user_id = (select auth.uid()) and from_coach = false and (select public.can_use())
              and transcript is null and video_id is null
              and (audio_path is null or audio_path like (select auth.uid())::text || '/%'));
create policy own_mark_read on public.messages for update to authenticated
  using (user_id = (select auth.uid()) and from_coach and (select public.can_use()))
  with check (user_id = (select auth.uid()) and from_coach);
revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;
revoke delete on public.messages from authenticated;

-- Video suggestions for the coach. Never readable by clients (no policies; reached only through coach functions).
create table public.message_suggestions (
  message_id uuid primary key references public.messages on delete cascade,
  items      jsonb not null default '[]',   -- [{video_id, alt_id?, name, why, thumb?, source}]
  created_at timestamptz not null default now()
);
alter table public.message_suggestions enable row level security;
revoke all on public.message_suggestions from anon, authenticated;

-- Private audio bucket. Files live under <client id>/...; clients reach only their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', false, 26214400, array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/x-m4a'])
on conflict (id) do nothing;

create policy voice_read on storage.objects for select to authenticated
  using (bucket_id = 'voice' and ((select public.is_owner())
         or ((storage.foldername(name))[1] = (select auth.uid())::text and (select public.can_use()))));
create policy voice_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'voice' and ((select public.is_owner())
         or ((storage.foldername(name))[1] = (select auth.uid())::text and (select public.can_use()))));

-- ---------- coach functions ----------

-- Every client with their latest message and how many of their messages are unread.
create or replace function public.coach_inbox()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'coach only'; end if;
  return coalesce((
    select jsonb_agg(row order by (row->>'last_at') desc nulls last, row->>'name')
    from (
      select jsonb_build_object(
        'user_id', m.user_id, 'name', coalesce(m.name, m.email), 'email', m.email,
        'last_at', l.created_at, 'last_from_coach', l.from_coach,
        'last_text', coalesce(nullif(btrim(l.body), ''), l.transcript, case when l.audio_path is not null then 'Voice message' when l.video_id is not null then 'Video' end),
        'last_voice', l.audio_path is not null,
        'unread', (select count(*) from public.messages u where u.user_id = m.user_id and not u.from_coach and u.read_at is null)
      ) as row
      from public.members m
      left join lateral (select * from public.messages x where x.user_id = m.user_id order by x.created_at desc limit 1) l on true
      where m.user_id is not null
    ) s), '[]'::jsonb);
end;
$$;

create or replace function public.coach_unread()
returns int
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_owner() then return 0; end if;
  return (select count(*) from public.messages x join public.members m on m.user_id = x.user_id
          where not x.from_coach and x.read_at is null);
end;
$$;

-- One client's thread, with suggestions on their messages. Marks their messages read.
create or replace function public.coach_thread(p_client uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare out jsonb;
begin
  perform public.assert_coach_of(p_client);
  select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('suggestions', coalesce(s.items, '[]'::jsonb)) order by x.created_at), '[]'::jsonb)
    into out
    from (select * from public.messages where user_id = p_client order by created_at desc limit 300) x
    left join public.message_suggestions s on s.message_id = x.id;
  update public.messages set read_at = now() where user_id = p_client and not from_coach and read_at is null;
  return out;
end;
$$;

create or replace function public.coach_send(p_client uuid, p_body text, p_audio_path text, p_audio_sec int,
                                             p_video_id text, p_video_title text, p_video_thumb text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare mid uuid;
begin
  perform public.assert_coach_of(p_client);
  if p_audio_path is not null and p_audio_path not like p_client::text || '/%' then raise exception 'bad audio path'; end if;
  insert into public.messages (user_id, from_coach, body, audio_path, audio_sec, transcript_status, video_id, video_title, video_thumb)
  values (p_client, true, nullif(btrim(p_body), ''), p_audio_path, p_audio_sec,
          case when p_audio_path is not null then 'pending' end, p_video_id, p_video_title, p_video_thumb)
  returning id into mid;
  return mid;
end;
$$;

revoke all on function public.coach_inbox() from public, anon;
revoke all on function public.coach_unread() from public, anon;
revoke all on function public.coach_thread(uuid) from public, anon;
revoke all on function public.coach_send(uuid, text, text, int, text, text, text) from public, anon;
grant execute on function public.coach_inbox() to authenticated;
grant execute on function public.coach_unread() to authenticated;
grant execute on function public.coach_thread(uuid) to authenticated;
grant execute on function public.coach_send(uuid, text, text, int, text, text, text) to authenticated;
