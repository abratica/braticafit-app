// App API, called from the BraticaFit web app by the signed-in coach or a client.
import { createClient } from "npm:@supabase/supabase-js@2";
import { analyzeMeal } from "../_shared/food.ts";
import { lookupBarcode } from "../_shared/barcode.ts";
import { vapidKeys, pushToUser } from "../_shared/push.ts";
import { runWeekly } from "../_shared/tasks.ts";
import { sql } from "../_shared/db.ts";
import { DEFAULT_WELCOME, emailConfigured, renderWelcome, sendEmail } from "../_shared/email.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  try {
    const me = await getCaller(req);
    if (!me) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));

    switch (body.action) {
      case "analyze": {
        if (!body.image && !body.text) return json({ error: "Send a photo or a description" }, 400);
        const result = await analyzeMeal({ image: body.image, mediaType: body.mediaType, text: body.text });
        return json(result);
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
          await sendEmail(me.email, renderWelcome(tpl, "Andrew", me.email));
          return json({ sent: me.email });
        }
        const m = await sql`select id, email, name from public.members where id = ${body.member_id ?? null}`;
        if (!m.length) return json({ error: "Client not found" }, 404);
        await sendEmail(m[0].email, renderWelcome(tpl, m[0].name ?? "", m[0].email));
        await sql`update public.members set welcomed_at = now() where id = ${m[0].id}`;
        return json({ sent: m[0].email });
      }
      case "weekly_now": {
        if (me.role !== "coach") return json({ error: "unauthorized" }, 403);
        return json(await runWeekly({ notify: false }));
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
