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
type PNItem = { name: string; pattern?: string; group?: string; eq: string[]; men?: string; women?: string; easier?: string; harder?: string };
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
const words = (s: string) => (s.toLowerCase().match(/[a-z]+(?:-[a-z]+)?/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
const BODY: Record<string, string[]> = {
  knee: ["Squat", "Single-leg"], knees: ["Squat", "Single-leg"], quad: ["Squat", "Single-leg"], quads: ["Squat", "Single-leg"],
  back: ["Hinge", "Core"], spine: ["Hinge", "Core"], hamstring: ["Hinge"], hamstrings: ["Hinge"], glute: ["Hinge", "Single-leg"], glutes: ["Hinge", "Single-leg"],
  hip: ["Hinge", "Warmup & mobility"], hips: ["Hinge", "Warmup & mobility"], shoulder: ["Horizontal push", "Vertical push", "Corrective"],
  shoulders: ["Horizontal push", "Vertical push", "Corrective"], elbow: ["Arms", "Horizontal pull"], wrist: ["Horizontal push"],
  chest: ["Horizontal push"], lats: ["Vertical pull"], core: ["Core"], abs: ["Core"], ankle: ["Warmup & mobility", "Squat"], ankles: ["Warmup & mobility", "Squat"],
  mobility: ["Warmup & mobility"], stretch: ["Warmup & mobility"], tight: ["Warmup & mobility"], posture: ["Corrective"],
};

type Cand = { ref: string; line: string; score: number; out: Record<string, unknown> };

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
  const lib = await sql`select video_id, exercise_name, kind, equipment, pattern, title, thumb from public.coach_demos order by created_at`;
  const seen = new Set<string>();
  lib.forEach((d, i) => {
    const key = d.exercise_name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      ref: `L${i}`, score: score(d.exercise_name, d.pattern) + 1,
      line: `L${i} | ${d.exercise_name} | ${d.kind} | ${(d.equipment ?? []).join("/") || "-"} | ${d.pattern ?? "-"} | in coach's Library`,
      out: { video_id: d.video_id, name: d.exercise_name, title: d.title, thumb: d.thumb, source: "library" },
    });
  });
  const pn = await pnCatalog();
  pn.items.forEach((e, i) => {
    if (seen.has(e.name.toLowerCase())) return;
    const id = e.men ?? e.women;
    if (!id) return;
    out.push({
      ref: `P${i}`, score: score(e.name, e.pattern),
      line: `P${i} | ${e.name} | exercise | ${e.eq.join("/")} | ${e.pattern ?? "-"}${e.easier ? ` | easier: ${e.easier}` : ""}${e.harder ? ` | harder: ${e.harder}` : ""}`,
      out: {
        video_id: "vm:" + id, alt_id: e.men && e.women ? "vm:" + e.women : null, name: e.name, title: e.name,
        thumb: pn.media[id]?.[1] ?? null, source: "pn",
      },
    });
  });
  // Keep the prompt small: everything that overlaps the message or recent training, then a few of the Library.
  const ranked = out.filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 70);
  if (ranked.length < 25) for (const c of out.filter((c) => c.ref.startsWith("L") && !ranked.includes(c)).slice(0, 25 - ranked.length)) ranked.push(c);
  return ranked;
}

// Groq retires models now and then, so pick the best one it currently offers.
const PREFER = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-32b", "meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];
let modelCache: { id: string; at: number } | null = null;
export async function chatModel(): Promise<string> {
  if (modelCache && Date.now() - modelCache.at < 6 * 3600e3) return modelCache.id;
  const r = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${groqKey()}` } });
  const ids: string[] = r.ok ? ((await r.json()).data ?? []).filter((m: any) => m.active !== false).map((m: any) => m.id) : [];
  const id = PREFER.find((p) => ids.includes(p))
    ?? ids.find((i) => !/whisper|tts|guard|playai|orpheus|distil|compound|prompt/i.test(i)) ?? PREFER[0];
  modelCache = { id, at: Date.now() };
  return id;
}

export async function groqJson(system: string, user: string): Promise<any> {
  const model = await chatModel();
  const r = await fetch(`${GROQ}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${groqKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, temperature: 0.2, max_tokens: 1500,
      ...(/gpt-oss/.test(model) ? { reasoning_effort: "low" } : /qwen3/.test(model) ? { reasoning_format: "hidden" } : {}),
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`groq chat ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return JSON.parse((await r.json()).choices?.[0]?.message?.content ?? "{}");
}

export const SYSTEM = `You help a personal trainer answer a client's message. Pick up to 3 exercise videos from the catalog that the trainer could send back to genuinely help with what the client said: a form-cue video for an exercise that felt off, an easier or joint-friendlier swap if something hurt, or a mobility drill for tightness.
Rules:
- Only use refs that appear in the catalog. Prefer videos from the coach's Library (L refs) when they fit equally well.
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
