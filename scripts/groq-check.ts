// CI check that the Groq key, the Whisper model and the suggestion model all work.
import { transcribe, groqJson, SYSTEM, chatModel, rankBrowse } from "../supabase/functions/_shared/voice.ts";

const wav = await Deno.readFile(Deno.args[0]);
const text = await transcribe(new Blob([wav], { type: "audio/wav" }), "check.wav");
console.log("TRANSCRIPT:", text);
if (!/knee/i.test(text)) throw new Error("transcript looks wrong");

console.log("MODEL:", await chatModel());
const catalog = [
  "L0 | Goblet Squat | exercise | dumbbell | Squat | in coach's Library",
  "L1 | Why You Feel Push-Ups In Your Shoulders | education | - | - | in coach's Library | coach says it helps with: shoulders take over on push-ups, front of shoulder sore after pressing",
  "P4 | Pushup | exercise | bodyweight | Horizontal push | easier: Hands-Elevated Pushup | cues: 1. Only lower as far down as you can without your shoulders popping forward. 2. Keep your abs tight.",
  "P5 | Hands-Elevated Pushup | exercise | bodyweight | Horizontal push | harder: Pushup",
  "P1 | Bodyweight Split Squat With Blocked Knee | exercise | bodyweight | Single-leg | harder: Goblet Split Squat With Blocked Knee",
  "P2 | Dumbbell Bench Press | exercise | dumbbell | Horizontal push",
  "P3 | Goblet Split Squat With Blocked Knee | exercise | dumbbell | Single-leg | easier: Bodyweight Split Squat With Blocked Knee",
].join("\n");
const res = await groqJson(SYSTEM, `Client's latest message:\n"""${text}"""\n\nRecent thread:\n(none)\n\nClient's recent workouts (newest first):\n2026-11-19 Lower A (done, felt solid): Goblet Split Squat With Blocked Knee, Goblet Squat\n\nCatalog (ref | name | type | equipment | movement | notes):\n${catalog}`);
console.log("SUGGESTIONS:", JSON.stringify(res));
if (!Array.isArray(res.items) || !res.items.length) throw new Error("no suggestions");
const small = await groqJson(SYSTEM, `Client's latest message:\n"""Can we move Friday's session to Saturday?"""\n\nCatalog:\n${catalog}`);
console.log("SMALL TALK:", JSON.stringify(small));
const shoulder = await groqJson(SYSTEM, `Client's latest message:\n"""I feel push ups mostly in my shoulders, not my chest"""\n\nCatalog (ref | name | type | equipment | movement | notes):\n${catalog}`);
console.log("SHOULDERS:", JSON.stringify(shoulder));
if (!shoulder.items?.some((i: any) => i.ref === "L1")) throw new Error("education video not picked for the shoulder question");

// Real Browse data: Andrew's message from his test, no Library help.
const msg = "i was doing push ups and only feeling it my front shoulders and not my chest";
const yt = await rankBrowse(msg);
console.log("BROWSE TOP:\n" + yt.map(({ v, sc }) => `  ${sc.toFixed(1)}  ${v.channel} | ${v.title} | ${Math.round(v.seconds / 60)} min`).join("\n"));
const lines = yt.map(({ v }, i) => `Y${i} | ${v.title} | ${v.channel} | ${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, "0")} long | in Browse, not in coach's Library`);
const real = await groqJson(SYSTEM, `Client's latest message:\n"""${msg}"""\n\nCatalog (ref | name | type | equipment | movement | notes):\n${catalog.split("\n").filter((l) => !l.startsWith("L1")).join("\n")}\n${lines.join("\n")}`);
console.log("REAL PICK:", JSON.stringify(real.items?.map((i: any) => ({ ...i, title: i.ref.startsWith("Y") ? yt[Number(i.ref.slice(1))]?.v.title : i.ref }))));
