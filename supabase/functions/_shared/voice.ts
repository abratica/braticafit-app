// Voice notes: Groq Whisper transcripts, and coach-only video suggestions picked by a Groq model
// from the coach's Library and the Precision Nutrition catalog, using the client's recent training.
import { sql } from "./db.ts";
import { APP_URL } from "./email.ts";

const GROQ = "https://api.groq.com/openai/v1";
const groqKey = () => Deno.env.get("GROQ_API_KEY") ?? "";
export const groqConfigured = () => !!groqKey();

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "en");
  form.append("response_format", "json");
  const r = await fetch(`${GROQ}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${groqKey()}` }, body: form });
  if (!r.ok) throw new Error(`transcribe ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return String((await r.json()).text ?? "").trim();
}

// ---------- candidate videos ----------
type PNItem = { name: string; pattern?: string; group?: string; eq: string[]; men?: string; women?: string; easier?: string; harder?: string; cues?: string };
let pnCache: { items: PNItem[]; media: Record<string, [number, string]>; at: number } | null = null;
async function pnCatalog() {
  if (pnCache && Date.now() - pnCache.at < 6 * 3600e3) return pnCache;
  const [cat, media] = await Promise.all([
    fetch(`${APP_URL}data/pn.json`).then((r) => r.json()),
    fetch(`${APP_URL}data/pn-media.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  pnCache = { items: cat.items ?? [], media, at: Date.now() };
  return pnCache;
}

const STOP = new Set("the a an and or but to of on in at for with my me i it its is was were be been it's im i'm this that so just really very felt feel feels like did do does didn't dont don't had have has not no yes today yesterday week workout exercise set sets rep reps got get bit kind sort little lot".split(" "));
const stem = (w: string) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const words = (s: string) => (s.toLowerCase().replace(/push[\s-]*ups?/g, "pushup").replace(/pull[\s-]*ups?/g, "pullup").replace(/chin[\s-]*ups?/g, "chinup")
  .replace(/-/g, " ").match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
const BODY: Record<string, string[]> = {
  knee: ["Squat", "Single-leg"], knees: ["Squat", "Single-leg"], quad: ["Squat", "Single-leg"], quads: ["Squat", "Single-leg"],
  back: ["Hinge", "Core"], spine: ["Hinge", "Core"], hamstring: ["Hinge"], hamstrings: ["Hinge"], glute: ["Hinge", "Single-leg"], glutes: ["Hinge", "Single-leg"],
  hip: ["Hinge", "Warmup & mobility"], hips: ["Hinge", "Warmup & mobility"], shoulder: ["Horizontal push", "Vertical push", "Corrective"],
  shoulders: ["Horizontal push", "Vertical push", "Corrective"], pec: ["Horizontal push"], tricep: ["Arms"], bicep: ["Arms"], elbow: ["Arms", "Horizontal pull"], wrist: ["Horizontal push"],
  chest: ["Horizontal push"], lats: ["Vertical pull"], core: ["Core"], abs: ["Core"], ankle: ["Warmup & mobility", "Squat"], ankles: ["Warmup & mobility", "Squat"],
  mobility: ["Warmup & mobility"], stretch: ["Warmup & mobility"], tight: ["Warmup & mobility"], posture: ["Corrective"],
};

// Every channel scanned into Browse (public data the coach Library page also reads).
const COACH_DATA = "https://raw.githubusercontent.com/abratica/youtube-summaries/coach-data/";
const EDU_SLUGS = new Set(["e3rehab", "theprehabguys", "squatuniversity", "tommorrison", "jeffnippard"]);
const HYPE = /\b(and then|shock|shocked|insane|legendary|caught|crazy|gone wrong|prank|reacts?|vs\.?|challenge|vlog|podcast|ep\.? ?\d|episode|live|q&a|giveaway)\b/i;
type YT = { id: string; title: string; seconds: number; views: number; slug: string; channel: string; tw: string[] };
let ytCache: { items: YT[]; at: number } | null = null;
async function browseVideos(): Promise<YT[]> {
  if (ytCache && Date.now() - ytCache.at < 6 * 3600e3) return ytCache.items;
  const items: YT[] = [];
  try {
    const idx = await fetch(`${COACH_DATA}index.json`).then((r) => r.json());
    const chans = await Promise.all((idx.channels ?? []).map((c: any) =>
      fetch(`${COACH_DATA}channels/${c.slug}.json`).then((r) => r.json()).then((j) => ({ ...j, slug: c.slug })).catch(() => null)));
    for (const ch of chans) {
      if (!ch) continue;
      for (const [id, title, seconds, , views] of ch.videos ?? []) {
        if (!seconds || seconds < 20 || HYPE.test(title) || /\p{Extended_Pictographic}/u.test(title)) continue;
        items.push({ id, title, seconds, views: views || 0, slug: ch.slug, channel: ch.channel, tw: words(title) });
      }
    }
  } catch (e) { console.error("browse load failed", (e as Error).message); }
  ytCache = { items, at: Date.now() };
  return items;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export async function rankBrowse(text: string, skip = new Set<string>()) {
  const msgW = new Set(words(text));
  return (await browseVideos())
    .filter((v) => !skip.has(v.id))
    .map((v) => {
      const hits = new Set(v.tw.filter((w) => msgW.has(w)));
      const body = [...hits].some((w) => BODY[w] || BODY[w + "s"]);
      let sc = hits.size * 3 + (body ? 2 : 0) + (EDU_SLUGS.has(v.slug) ? 1 : 0) + (v.seconds <= 900 ? 1 : 0) + Math.min(2, Math.log10(1 + v.views) / 3);
      if (hits.size < 2 && !(hits.size === 1 && body)) sc = 0;
      return { v, sc };
    })
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 15);
}

type Cand = { ref: string; line: string; score: number; cues?: string; out: Record<string, unknown> };

async function candidates(text: string, recentNames: string[]): Promise<Cand[]> {
  const msgW = new Set(words(text));
  const exW = new Set(recentNames.flatMap(words));
  const pats = new Set([...msgW].flatMap((w) => BODY[w] ?? []));
  const score = (name: string, pattern?: string | null) => {
    const nw = words(name);
    let s = 0;
    for (const w of nw) { if (msgW.has(w)) s += 3; if (exW.has(w)) s += 1; }
    if (recentNames.some((r) => r.toLowerCase() === name.toLowerCase())) s += 4;
    if (pattern && pats.has(pattern)) s += 2;
    return s;
  };
  const out: Cand[] = [];
  const lib = await sql`select video_id, exercise_name, kind, equipment, pattern, title, thumb, helps_with, start_sec, cues
                        from public.coach_demos order by created_at`;
  const seen = new Set<string>();
  lib.forEach((d, i) => {
    const key = d.exercise_name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const helps = String(d.helps_with ?? "").trim();
    const hw = words(helps);
    const bonus = hw.filter((w) => msgW.has(w)).length * 4 + (d.kind === "education" ? words(d.title ?? "").filter((w) => msgW.has(w)).length * 2 : 0);
    out.push({
      ref: `L${i}`, score: score(d.exercise_name, d.pattern) + 1 + bonus,
      cues: d.cues ?? "",
      line: `L${i} | ${d.exercise_name} | ${d.kind} | ${(d.equipment ?? []).join("/") || "-"} | ${d.pattern ?? "-"} | in coach's Library${helps ? ` | coach says it helps with: ${helps}` : ""}${d.kind === "education" && d.title && d.title !== d.exercise_name ? ` | video title: ${d.title}` : ""}`,
      out: { video_id: d.video_id, name: d.exercise_name, title: d.title, thumb: d.thumb, source: "library", kind: d.kind, start_sec: d.start_sec ?? null },
    });
  });
  const pn = await pnCatalog();
  pn.items.forEach((e, i) => {
    if (seen.has(e.name.toLowerCase())) return;
    const id = e.men ?? e.women;
    if (!id) return;
    out.push({
      ref: `P${i}`, score: score(e.name, e.pattern), cues: e.cues ?? "",
      line: `P${i} | ${e.name} | exercise | ${e.eq.join("/")} | ${e.pattern ?? "-"}${e.easier ? ` | easier: ${e.easier}` : ""}${e.harder ? ` | harder: ${e.harder}` : ""}`,
      out: {
        video_id: "vm:" + id, alt_id: e.men && e.women ? "vm:" + e.women : null, name: e.name, title: e.name,
        thumb: pn.media[id]?.[1] ?? null, source: "pn",
      },
    });
  });
  // Browse: titles that share the most words with the message. A title needs 2+ shared words (or 1 plus a body part).
  const yt = await rankBrowse(text, new Set(lib.map((d) => d.video_id)));
  yt.forEach(({ v, sc }, i) => {
    const kind = EDU_SLUGS.has(v.slug) ? "education" : v.seconds > 180 ? "workout" : "exercise";
    out.push({
      ref: `Y${i}`, score: sc,
      line: `Y${i} | ${v.title} | ${kind} | ${v.channel} | ${mmss(v.seconds)} long | in Browse, not in coach's Library`,
      out: { video_id: v.id, name: v.title.replace(/\s*[|#].*$/, "").trim().slice(0, 90), title: v.title, thumb: null, source: "browse",
             kind, channel: v.channel, slug: v.slug, seconds: v.seconds },
    });
  });

  // Keep the prompt small: everything that overlaps the message or recent training, then a few of the Library.
  const ranked = out.filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 70);
  for (const c of out) if (c.ref.startsWith("Y") && !ranked.includes(c)) ranked.push(c);
  if (ranked.length < 25) for (const c of out.filter((c) => c.ref.startsWith("L") && !ranked.includes(c)).slice(0, 25 - ranked.length)) ranked.push(c);
  // Every Education video the coach has noted goes in, so "why does this feel..." questions can find one.
  for (const c of out) if (!ranked.includes(c) && c.out.kind === "education" && c.line.includes("helps with")) ranked.push(c);
  // The best matches also carry their coaching cues, so a demo can be picked for a specific cue.
  ranked.slice(0, 15).forEach((c) => { if (c.cues) c.line += ` | cues: ${c.cues.replace(/\s+/g, " ").slice(0, 220)}`; });
  return ranked;
}

// Groq retires models now and then, so pick the best one it currently offers.
const PREFER = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-32b", "meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];
// For long inputs (call transcripts), models with the most room per minute on Groq's free plan go first.
const PREFER_BIG = ["meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b",
  "moonshotai/kimi-k2-instruct", "qwen/qwen3-32b", "llama-3.1-8b-instant"];
let modelCache: { ids: string[]; at: number } | null = null;
async function liveModels(): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 6 * 3600e3) return modelCache.ids;
  const r = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${groqKey()}` } });
  const ids: string[] = r.ok ? ((await r.json()).data ?? []).filter((m: any) => m.active !== false).map((m: any) => m.id) : [];
  if (ids.length) modelCache = { ids, at: Date.now() };
  return ids;
}
export async function chatModels(big = false): Promise<string[]> {
  const ids = await liveModels();
  const order = (big ? PREFER_BIG : PREFER).filter((p) => ids.includes(p));
  const extra = ids.find((i) => !/whisper|tts|guard|playai|orpheus|distil|compound|prompt/i.test(i));
  return order.length ? order : [extra ?? PREFER[0]];
}
export async function chatModel(): Promise<string> {
  return (await chatModels())[0];
}

// JSON answer from a Groq model. If a model says the request is too big or it's busy, try the next one.
export async function groqChat(system: string, user: string, { big = false, maxTokens = 1500 } = {}): Promise<any> {
  const models = (await chatModels(big)).slice(0, 4);
  let last = "";
  for (const model of models) {
    const r = await fetch(`${GROQ}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, temperature: 0.2, max_tokens: maxTokens,
        ...(/gpt-oss/.test(model) ? { reasoning_effort: "low" } : /qwen3/.test(model) ? { reasoning_format: "hidden" } : {}),
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (r.ok) {
      try { return JSON.parse((await r.json()).choices?.[0]?.message?.content ?? "{}"); }
      catch { last = `${model}: bad JSON`; continue; }
    }
    last = `${model} ${r.status}: ${(await r.text()).slice(0, 160)}`;
    if (![400, 413, 429, 498, 500, 503].includes(r.status)) break;
  }
  throw new Error(`groq chat failed: ${last}`);
}

export async function groqJson(system: string, user: string): Promise<any> {
  return await groqChat(system, user);
}

export const SYSTEM = `You help a personal trainer answer a client's message. Pick up to 3 videos from the catalog that the trainer could send back to genuinely help with what the client said: an education video that explains why something feels the way it does, a demo whose coaching cue fixes the problem, an easier or joint-friendlier swap if something hurt, or a mobility drill for tightness.
Rules:
- Only use refs that appear in the catalog. Pick the best video for the problem from any source: the coach's Library (L), Precision Nutrition demos (P), or YouTube videos in Browse (Y). When two fit equally well, prefer the Library.
- Prefer short, focused videos over long general ones; judge a Browse video by its title and length.
- When the client says where they feel an exercise, that something feels off, or that something hurts, include an education video if one clearly fits (the coach's "helps with" note is the strongest signal), and pair it with a cue or swap rather than just the same exercise again.
- Only suggest the exact exercise they mentioned if its cues address their problem, and then say which cue in "why".
- If the message is small talk, scheduling, food, or anything a video wouldn't help with, return no items.
- Never diagnose. Keep each "why" under 15 words, written to the trainer (e.g. "Easier swap that keeps the knee behind the toes").
Answer as JSON: {"items":[{"ref":"P12","why":"..."}]}`;

export async function suggestVideos(clientId: string, text: string): Promise<Record<string, unknown>[]> {
  if (!text.trim()) return [];
  const recent = await sql`
    select w.scheduled_on, w.title, w.completed_at, w.feel, w.note,
           coalesce(jsonb_agg(x.name order by x.position) filter (where x.id is not null), '[]') as ex
    from public.workouts w left join public.workout_exercises x on x.workout_id = w.id
    where w.user_id = ${clientId} and w.scheduled_on between current_date - 14 and current_date + 3
    group by w.id order by w.scheduled_on desc limit 8`;
  const thread = await sql`
    select from_coach, coalesce(body, transcript) as t from public.messages
    where user_id = ${clientId} and coalesce(body, transcript) is not null order by created_at desc limit 6`;
  const names = recent.flatMap((w) => w.ex as string[]);
  const cands = await candidates(text, names);
  if (!cands.length) return [];
  const training = recent.map((w) => `${w.scheduled_on.toISOString?.().slice(0, 10) ?? w.scheduled_on} ${w.title}${w.completed_at ? ` (done${w.feel ? `, felt ${w.feel}` : ""})` : " (not done)"}: ${(w.ex as string[]).join(", ") || "video workout"}`).join("\n");
  const convo = thread.reverse().map((m) => `${m.from_coach ? "Coach" : "Client"}: ${String(m.t).slice(0, 300)}`).join("\n");
  const user = `Client's latest message:\n"""${text.slice(0, 1500)}"""\n\nRecent thread:\n${convo || "(none)"}\n\nClient's recent workouts (newest first):\n${training || "(none logged)"}\n\nCatalog (ref | name | type | equipment | movement | notes):\n${cands.map((c) => c.line).join("\n")}`;
  const res = await groqJson(SYSTEM, user);
  const byRef = new Map(cands.map((c) => [c.ref, c]));
  const picked: Record<string, unknown>[] = [];
  for (const it of Array.isArray(res.items) ? res.items : []) {
    const c = byRef.get(String(it.ref ?? "").trim());
    if (!c || picked.some((p) => p.video_id === c.out.video_id)) continue;
    picked.push({ ...c.out, why: String(it.why ?? "").slice(0, 140) });
    if (picked.length === 3) break;
  }
  return picked;
}
