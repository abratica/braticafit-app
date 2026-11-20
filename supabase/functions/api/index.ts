// App API, called from the BraticaFit web app by the signed-in coach or a client.
import { createClient } from "npm:@supabase/supabase-js@2";
import { analyzeMeal, fatsecretConfigured, searchFatsecret, searchUsda } from "../_shared/food.ts";
import { lookupBarcode } from "../_shared/barcode.ts";
import { vapidKeys, pushToUser } from "../_shared/push.ts";
import { runWeekly } from "../_shared/tasks.ts";
import { sql, ownerId } from "../_shared/db.ts";
import { groqConfigured, suggestVideos, transcribe } from "../_shared/voice.ts";
import { APP_URL, COACH_INBOX, DEFAULT_WELCOME, emailConfigured, renderAccessRequest, renderWelcome, sendEmail } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://ktpztiyqyoalrwnqtqme.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_aUvlMasnVDO34rV8wBWnCw_oywTssOz";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Caller = { id: string; email: string; role: "coach" | "client" };

async function getCaller(req: Request): Promise<Caller | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await client.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return null;
  const { data: role, error } = await client.rpc("my_role");
  if (error || (role !== "coach" && role !== "client")) return null;
  return { id: user.id, email: user.email ?? "", role };
}

// Service-level auth client: only used to make sign-in links and send sign-in emails.
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();

// Is this email allowed in? The coach's own email, or someone on the client list.
async function isAllowed(email: string): Promise<boolean> {
  const rows = await sql`
    select (exists (select 1 from public.members where email = ${email})
         or exists (select 1 from auth.users u
                    join private.config c on c.key = 'owner_id' and c.value = u.id::text
                    where lower(u.email) = ${email})) as ok`;
  return rows[0]?.ok === true;
}

// One-time link that opens the app already signed in (valid for the sign-in link lifetime).
async function signInLink(email: string): Promise<string> {
  const redirectTo = `${APP_URL}?email=${encodeURIComponent(email)}`;
  let r = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
  if (r.error) r = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (r.error || !r.data?.properties?.action_link) throw r.error ?? new Error("Couldn't make a sign-in link");
  return r.data.properties.action_link;
}

// Actions anyone can call from the sign-in screen.
async function publicAction(body: Record<string, unknown>): Promise<Response | null> {
  if (body.action === "send_link") {
    const email = cleanEmail(body.email);
    if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email" }, 400);
    if (!(await isAllowed(email))) return json({ allowed: false });
    const { error } = await admin.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: APP_URL } });
    if (error) return json({ error: /rate|seconds/i.test(error.message) ? "Too many tries. Wait a minute and try again." : error.message }, 429);
    return json({ allowed: true, sent: true });
  }
  if (body.action === "request_access") {
    const email = cleanEmail(body.email);
    const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    const note = String(body.note ?? "").trim().slice(0, 500) || null;
    if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email" }, 400);
    if (name.split(" ").length < 2) return json({ error: "Add your first and last name" }, 400);
    if (await isAllowed(email)) return json({ allowed: true });
    const recent = await sql`select count(*)::int as n from public.access_requests where created_at > now() - interval '1 hour'`;
    if (recent[0].n >= 15) return json({ error: "Too many requests right now. Try again later." }, 429);
    const row = await sql`
      insert into public.access_requests (email, name, note) values (${email}, ${name}, ${note})
      on conflict (email) where status = 'pending' do update set name = excluded.name, note = excluded.note
      returning (xmax = 0) as is_new`;
    if (row[0]?.is_new && emailConfigured()) {
      try { await sendEmail(COACH_INBOX, renderAccessRequest({ name, email, note }), email); }
      catch (e) { console.error("request notice failed", e); }
    }
    return json({ requested: true });
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const pub = await publicAction(body);
    if (pub) return pub;

    const me = await getCaller(req);
    if (!me) return json({ error: "unauthorized" }, 401);

    switch (body.action) {
      case "analyze": {
        if (!body.image && !body.text) return json({ error: "Send a photo or a description" }, 400);
        const result = await analyzeMeal({ image: body.image, mediaType: body.mediaType, text: body.text });
        return json(result);
      }
      case "food_search": {
        // fatsecret first (brands + restaurants); USDA when fatsecret isn't set up, fails, or has nothing.
        const q = String(body.q ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
        if (q.length < 2) return json({ results: [] });
        const cachedAs = async (key: string) =>
          (await sql`select results from public.food_search_cache where q = ${key} and created_at > now() - interval '30 days'`)[0]?.results;
        const save = (key: string, results: unknown) =>
          sql`insert into public.food_search_cache (q, results) values (${key}, ${sql.json(results as any)})
              on conflict (q) do update set results = excluded.results, created_at = now()`;
        if (fatsecretConfigured()) {
          const hit = await cachedAs(`fs:${q}`);
          if (hit?.length) return json({ results: hit, provider: "fatsecret" });
          try {
            const results = await searchFatsecret(q);
            if (results.length) { await save(`fs:${q}`, results); return json({ results, provider: "fatsecret" }); }
          } catch (e) { console.error("fatsecret search failed", (e as Error).message); }
        }
        const usda = await cachedAs(`usda:${q}`);
        if (usda) return json({ results: usda, provider: "usda" });
        try {
          const results = await searchUsda(q);
          await save(`usda:${q}`, results);
          return json({ results, provider: "usda" });
        } catch (e) {
          if ((e as Error).message === "rate_limited") return json({ results: [], busy: true });
          throw e;
        }
      }
      case "barcode": {
        if (!body.code) return json({ error: "Send a barcode" }, 400);
        return json(await lookupBarcode(body.code));
      }
      case "vapid": {
        const { publicKey } = await vapidKeys();
        return json({ publicKey });
      }
      case "test_push": {
        const sent = await pushToUser(me.id, {
          title: "BraticaFit",
          body: "Notifications are working.",
          url: "./",
          tag: "test",
        });
        return json({ sent });
      }
      case "email_status": {
        if (me.role !== "coach") return json({ error: "unauthorized" }, 403);
        return json({ configured: emailConfigured(), defaults: DEFAULT_WELCOME });
      }
      case "welcome": {
        // Send the welcome email to a client (or a test copy to the coach).
        if (me.role !== "coach") return json({ error: "unauthorized" }, 403);
        const rows = await sql`select key, value from public.coach_settings where key in ('welcome_subject', 'welcome_body')`;
        const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        const tpl = { subject: saved.welcome_subject ?? DEFAULT_WELCOME.subject, body: saved.welcome_body ?? DEFAULT_WELCOME.body };
        if (body.test) {
          if (!me.email) return json({ error: "No email on your account" }, 400);
          await sendEmail(me.email, renderWelcome(tpl, "Andrew", me.email, await signInLink(me.email).catch(() => undefined)));
          return json({ sent: me.email });
        }
        const m = await sql`select id, email, name from public.members where id = ${body.member_id ?? null}`;
        if (!m.length) return json({ error: "Client not found" }, 404);
        const link = await signInLink(m[0].email).catch((e) => { console.error("sign-in link failed", e); return undefined; });
        await sendEmail(m[0].email, renderWelcome(tpl, m[0].name ?? "", m[0].email, link));
        await sql`update public.members set welcomed_at = now() where id = ${m[0].id}`;
        return json({ sent: m[0].email });
      }
      case "weekly_now": {
        if (me.role !== "coach") return json({ error: "unauthorized" }, 403);
        return json(await runWeekly({ notify: false }));
      }
      case "message_sent": {
        // After a message is saved: transcribe a voice note, notify the other side, and (client messages) suggest videos for the coach.
        const rows = await sql`select m.*, coalesce(mb.name, mb.email) as client_name from public.messages m
                               left join public.members mb on mb.user_id = m.user_id where m.id = ${body.message_id ?? null}`;
        const m = rows[0];
        if (!m) return json({ error: "Message not found" }, 404);
        if (me.role === "client" ? (m.user_id !== me.id || m.from_coach) : !m.from_coach) return json({ error: "unauthorized" }, 403);
        if (Date.now() - new Date(m.created_at).getTime() > 15 * 60e3) return json({ error: "too old" }, 400);

        let text = String(m.body ?? "").trim();
        if (m.audio_path && groqConfigured() && m.transcript_status !== "done") {
          await sql`update public.messages set transcript_status = 'pending' where id = ${m.id}`;
          try {
            const { data: blob, error } = await admin.storage.from("voice").download(m.audio_path);
            if (error || !blob) throw error ?? new Error("audio missing");
            const t = await transcribe(blob, m.audio_path.split("/").pop() || "voice.webm");
            await sql`update public.messages set transcript = ${t}, transcript_status = 'done' where id = ${m.id}`;
            text = [text, t].filter(Boolean).join("\n");
          } catch (e) {
            console.error("transcribe failed", (e as Error).message);
            await sql`update public.messages set transcript_status = 'failed' where id = ${m.id}`;
          }
        }
        const snippet = (text || (m.audio_path ? "Voice message" : m.video_title ? `Sent a video: ${m.video_title}` : "New message")).slice(0, 140);
        const voice = m.audio_path ? "🎤 " : "";
        const tasks: Promise<unknown>[] = [];
        if (m.from_coach) {
          tasks.push(pushToUser(m.user_id, { title: "Coach Andrew", body: voice + snippet, url: "./#msg", tag: "msg" }));
        } else {
          const owner = await ownerId();
          if (owner) tasks.push(pushToUser(owner, { title: m.client_name ?? "Client", body: voice + snippet, url: `./#coach=inbox.${m.user_id}`, tag: `msg-${m.user_id}` }));
          if (groqConfigured() && text) {
            tasks.push(suggestVideos(m.user_id, text).then((items) => sql`
              insert into public.message_suggestions (message_id, items) values (${m.id}, ${sql.json(items as any)})
              on conflict (message_id) do update set items = excluded.items`).catch((e) => console.error("suggest failed", (e as Error).message)));
          }
        }
        await Promise.allSettled(tasks);
        return json({ ok: true });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
