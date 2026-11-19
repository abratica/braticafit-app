// App API, called from the BraticaFit web app by the signed-in coach or a client.
import { createClient } from "npm:@supabase/supabase-js@2";
import { analyzeMeal } from "../_shared/food.ts";
import { lookupBarcode } from "../_shared/barcode.ts";
import { vapidKeys, pushToUser } from "../_shared/push.ts";
import { runWeekly } from "../_shared/tasks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://ktpztiyqyoalrwnqtqme.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_aUvlMasnVDO34rV8wBWnCw_oywTssOz";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Caller = { id: string; role: "coach" | "client" };

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
  return { id: user.id, role };
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
