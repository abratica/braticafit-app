// Video calls on Daily: private rooms and join tokens, reminders, and call notes written
// by a Groq model from Daily's live transcript once the call ends.
import { sql, ownerId } from "./db.ts";
import { pushToUser } from "./push.ts";
import { groqChat, groqConfigured } from "./voice.ts";

const DAILY = "https://api.daily.co/v1";
const dailyKey = () => Deno.env.get("DAILY_API_KEY") ?? "";
export const dailyConfigured = () => !!dailyKey();

async function daily(path: string, init: RequestInit = {}) {
  const r = await fetch(`${DAILY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${dailyKey()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}

// People can join from 15 minutes before the start until an hour after the booked end.
export const EARLY_MIN = 15, LATE_MIN = 60;
const secs = (d: Date) => Math.floor(d.getTime() / 1000);
function windowOf(c: { starts_at: string | Date; minutes: number }) {
  const start = new Date(c.starts_at);
  return { open: new Date(start.getTime() - EARLY_MIN * 60e3), close: new Date(start.getTime() + (c.minutes + LATE_MIN) * 60e3) };
}

async function ensureRoom(c: any): Promise<{ name: string; url: string }> {
  const { open, close } = windowOf(c);
  if (c.room_name) {
    const got = await daily(`/rooms/${c.room_name}`);
    if (got.ok) return { name: got.body.name, url: got.body.url };
  }
  const name = `bf-${String(c.id).replace(/-/g, "").slice(0, 20)}-${Math.random().toString(36).slice(2, 6)}`;
  const made = await daily("/rooms", {
    method: "POST",
    body: JSON.stringify({
      name, privacy: "private",
      properties: {
        nbf: secs(open), exp: secs(close), eject_at_room_exp: true,
        enable_transcription_storage: true, enable_prejoin_ui: true, enable_knocking: false,
        enable_chat: true, enable_screenshare: true, lang: "en",
      },
    }),
  });
  if (!made.ok) throw new Error(`Couldn't set up the call room (${made.status}: ${JSON.stringify(made.body).slice(0, 160)})`);
  // Another device may have made a room at the same moment; keep whichever was saved first.
  const saved = await sql`update public.calls set room_name = ${made.body.name}
                          where id = ${c.id} and room_name is not distinct from ${c.room_name ?? null} returning room_name`;
  if (!saved.length) {
    await daily(`/rooms/${made.body.name}`, { method: "DELETE" });
    const [row] = await sql`select room_name from public.calls where id = ${c.id}`;
    const got = await daily(`/rooms/${row.room_name}`);
    if (!got.ok) throw new Error("Couldn't open the call room");
    return { name: got.body.name, url: got.body.url };
  }
  return { name: made.body.name, url: made.body.url };
}

// Everything the app needs to open the call. The coach joins as the room owner, which also
// starts Daily's live transcript (that's what the call notes are written from).
export async function joinCall(callId: string, me: { id: string; role: "coach" | "client" }) {
  if (!dailyConfigured()) return { error: "Calls aren't set up yet" };
  const [c]: any[] = await sql`select c.*, m.name as client_name, m.email as client_email, m.call_consent_at
                        from public.calls c left join public.members m on m.user_id = c.user_id where c.id = ${callId}`;
  if (!c || (me.role === "client" && c.user_id !== me.id)) return { error: "Call not found" };
  const { open, close } = windowOf(c);
  const now = new Date();
  if (now < open) return { error: `You can join from ${EARLY_MIN} minutes before the call`, early: true };
  if (now > close) return { error: "This call has ended" };
  if (me.role === "client" && !c.call_consent_at) return { need_consent: true };

  const room = await ensureRoom(c);
  const coach = me.role === "coach";
  const first = String(c.client_name || c.client_email || "Client").trim().split(/\s+/)[0];
  const tok = await daily("/meeting-tokens", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        room_name: room.name, exp: secs(close), eject_at_token_exp: true,
        user_name: coach ? "Andrew" : first, user_id: me.id.slice(0, 36),
        is_owner: coach, auto_start_transcription: coach,
        ...(coach ? {} : { permissions: { canAdmin: false } }),
      },
    }),
  });
  if (!tok.ok) throw new Error(`Couldn't make a call pass (${tok.status}: ${JSON.stringify(tok.body).slice(0, 160)})`);
  await sql`update public.calls set joined_at = coalesce(joined_at, now()) where id = ${c.id}`;
  return { url: room.url, token: tok.body.token, title: c.title, ends_at: close.toISOString(), coach };
}

// ---------- reminders ----------
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
async function sendReminders() {
  const due = await sql`
    update public.calls set reminded_at = now()
     where reminded_at is null and starts_at > now() and starts_at <= now() + interval '15 minutes'
    returning id, user_id, starts_at, title`;
  const owner = await ownerId();
  for (const c of due) {
    const at = timeFmt.format(new Date(c.starts_at));
    await pushToUser(c.user_id, { title: "Call with Andrew", body: `${c.title} at ${at}. Tap to join from the Coach tab.`, url: "./#msg", tag: `call-${c.id}` });
    if (owner && owner !== c.user_id) {
      const [m] = await sql`select coalesce(name, email) as name from public.members where user_id = ${c.user_id}`;
      await pushToUser(owner, { title: `Call with ${m?.name ?? "a client"}`, body: `${c.title} at ${at}`, url: "./#coach=calls", tag: `call-${c.id}` });
    }
  }
  return due.length;
}

// ---------- transcript -> notes ----------
// Daily stores the live transcript as WebVTT. Turn it into "Name: what they said" lines,
// merging a speaker's back-to-back cues.
export function vttToText(vtt: string): string {
  const lines: string[] = [];
  let who = "", said = "";
  const flush = () => { if (said.trim()) lines.push(`${who || "Speaker"}: ${said.trim()}`); said = ""; };
  for (const block of vtt.replace(/\r/g, "").split(/\n\n+/)) {
    const rows = block.split("\n");
    const at = rows.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;                                  // header, NOTE, STYLE
    for (const row of rows.slice(at + 1)) {
      // Daily writes "<v>Name:</v>text"; standard WebVTT is "<v Name>text</v>".
      const m = row.match(/^<v>\s*([^<]*?):?\s*<\/v>\s*(.*)$/) || row.match(/^<v\s+([^>]+)>(.*?)(<\/v>)?$/);
      const name = m ? m[1].trim() : who;
      const text = (m ? m[2] : row).replace(/<[^>]+>/g, "").trim();
      if (!text) continue;
      if (name !== who) { flush(); who = name; }
      said += " " + text;
    }
  }
  flush();
  return lines.join("\n");
}

const NOTES_SYSTEM = `You write the notes for a video call between Andrew, a personal trainer, and one of his coaching clients. The client will read these notes too, so write them to the client in plain, friendly language ("you", and "Andrew" for the coach).
Rules:
- Only include what was actually said in the transcript. Never invent numbers, exercises, or plans.
- "summary": 1-3 sentences on what the call covered.
- "points": up to 6 short bullet points: decisions, changes to training or food, how things are going, anything worth remembering.
- "actions": up to 6 next steps, each with "who" ("client" or "Andrew") and a short "text" starting with a verb.
- The transcript is automatic and may have mistakes; skip anything you can't make sense of.
- If the call was too short or had nothing of substance, return empty lists and a summary saying it was a short call.
Answer as JSON: {"summary":"...","points":["..."],"actions":[{"who":"client","text":"..."}]}`;

const PART_SYSTEM = `You take notes on one part of a video call between Andrew (a personal trainer) and his client. List every decision, change to training or food, update on how things are going, and next step that is in this part. Only what was said. Answer as JSON: {"notes":["..."]}`;

function clean(n: any) {
  const s = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return {
    summary: s(n?.summary, 600),
    points: (Array.isArray(n?.points) ? n.points : []).map((p: unknown) => s(p, 300)).filter(Boolean).slice(0, 8),
    actions: (Array.isArray(n?.actions) ? n.actions : [])
      .map((a: any) => ({ who: /andrew|coach/i.test(String(a?.who)) ? "Andrew" : "client", text: s(a?.text ?? a, 240) }))
      .filter((a: any) => a.text).slice(0, 8),
  };
}

export async function writeNotes(transcript: string) {
  const words = transcript.split(/\s+/).length;
  if (words <= 3500) return clean(await groqChat(NOTES_SYSTEM, transcript, { big: words > 1800 }));
  // Long call: note each part, then write the notes from those.
  const lines = transcript.split("\n"), parts: string[] = [];
  let cur: string[] = [], n = 0;
  for (const l of lines) {
    const w = l.split(/\s+/).length;
    if (n + w > 2500 && cur.length) { parts.push(cur.join("\n")); cur = []; n = 0; }
    cur.push(l); n += w;
  }
  if (cur.length) parts.push(cur.join("\n"));
  const notes: string[] = [];
  for (const [i, p] of parts.entries()) {
    const r = await groqChat(PART_SYSTEM, `Part ${i + 1} of ${parts.length}:\n${p}`, { big: true });
    notes.push(...(Array.isArray(r?.notes) ? r.notes.map(String) : []));
  }
  return clean(await groqChat(NOTES_SYSTEM, `Notes taken during the call, in order:\n- ${notes.join("\n- ")}`, { big: false }));
}

async function transcriptsFor(room: string) {
  const r = await daily(`/transcript?room_name=${encodeURIComponent(room)}&limit=20`);
  if (!r.ok) throw new Error(`transcript list ${r.status}`);
  return (r.body?.data ?? []) as any[];
}

async function processCall(c: any): Promise<string> {
  const end = new Date(new Date(c.starts_at).getTime() + c.minutes * 60e3);
  const giveUp = Date.now() > end.getTime() + 4 * 3600e3;
  if (!c.room_name || !c.joined_at) {
    if (Date.now() > end.getTime() + (LATE_MIN + 5) * 60e3) await sql`update public.calls set notes_status = 'none' where id = ${c.id}`;
    return "no room";
  }
  const list = await transcriptsFor(c.room_name);
  if (list.some((t) => t.status === "t_in_progress") && !giveUp) return "in progress";
  const done = list.filter((t) => t.status === "t_finished" && t.isVttAvailable !== false)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!done.length) {
    // The room is still open until an hour after the booked end; someone may rejoin.
    if (Date.now() > end.getTime() + (LATE_MIN + 5) * 60e3) await sql`update public.calls set notes_status = 'none' where id = ${c.id}`;
    return "no transcript";
  }
  const texts: string[] = [];
  for (const t of done) {
    const link = await daily(`/transcript/${t.transcriptId}/access-link`);
    const url = link.body?.link ?? link.body?.download_link;
    if (!link.ok || !url) throw new Error(`transcript link ${link.status}`);
    const f = await fetch(url);
    if (!f.ok) throw new Error(`transcript download ${f.status}`);
    texts.push(vttToText(await f.text()));
  }
  const transcript = texts.filter(Boolean).join("\n");
  if (transcript.split(/\s+/).length < 25) {
    await sql`update public.calls set notes_status = 'none' where id = ${c.id}`;
    return "too short";
  }
  await sql`insert into public.call_transcripts (call_id, body) values (${c.id}, ${transcript})
            on conflict (call_id) do update set body = excluded.body`;
  if (!groqConfigured()) throw new Error("GROQ_API_KEY not set");
  const notes = await writeNotes(transcript);
  await sql`update public.calls set notes = ${sql.json(notes as any)}, notes_status = 'done', notes_at = now() where id = ${c.id}`;

  // The transcript now lives with the call; clean up Daily's copies and the room.
  for (const t of done) await daily(`/transcript/${t.transcriptId}`, { method: "DELETE" }).catch(() => {});
  await daily(`/rooms/${c.room_name}`, { method: "DELETE" }).catch(() => {});

  const owner = await ownerId();
  await pushToUser(c.user_id, { title: "Call notes", body: notes.summary.slice(0, 140) || "Your notes from today's call are ready.", url: "./#msg", tag: `notes-${c.id}` });
  if (owner && owner !== c.user_id) {
    const [m] = await sql`select coalesce(name, email) as name from public.members where user_id = ${c.user_id}`;
    await pushToUser(owner, { title: `Call notes · ${m?.name ?? "client"}`, body: notes.summary.slice(0, 140), url: "./#coach=calls", tag: `notes-${c.id}` });
  }
  return "done";
}

export async function processCalls(onlyId?: string) {
  if (!dailyConfigured()) return { skipped: "no DAILY_API_KEY" };
  const rows = onlyId
    ? await sql`select * from public.calls where id = ${onlyId} and notes_status = 'waiting'`
    : await sql`select * from public.calls where notes_status = 'waiting' and starts_at < now() and starts_at > now() - interval '3 days'
                order by starts_at limit 10`;
  const out: Record<string, string> = {};
  for (const c of rows) {
    try { out[c.id] = await processCall(c); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("call notes", c.id, msg);
      await sql`update public.calls set notes_tries = notes_tries + 1,
                notes_status = case when notes_tries + 1 >= 6 then 'failed' else notes_status end where id = ${c.id}`;
      out[c.id] = "error: " + msg.slice(0, 120);
    }
  }
  return out;
}

export async function runCalls() {
  const reminded = await sendReminders();
  const notes = await processCalls();
  return { reminded, notes };
}
