// CI check that the Groq key, the Whisper model and the suggestion model all work.
import { transcribe, groqJson, SYSTEM, chatModel } from "../supabase/functions/_shared/voice.ts";

const wav = await Deno.readFile(Deno.args[0]);
const text = await transcribe(new Blob([wav], { type: "audio/wav" }), "check.wav");
console.log("TRANSCRIPT:", text);
if (!/knee/i.test(text)) throw new Error("transcript looks wrong");

console.log("MODEL:", await chatModel());
const catalog = [
  "L0 | Goblet Squat | exercise | dumbbell | Squat | in coach's Library",
  "P1 | Bodyweight Split Squat With Blocked Knee | exercise | bodyweight | Single-leg | harder: Goblet Split Squat With Blocked Knee",
  "P2 | Dumbbell Bench Press | exercise | dumbbell | Horizontal push",
  "P3 | Goblet Split Squat With Blocked Knee | exercise | dumbbell | Single-leg | easier: Bodyweight Split Squat With Blocked Knee",
].join("\n");
const res = await groqJson(SYSTEM, `Client's latest message:\n"""${text}"""\n\nRecent thread:\n(none)\n\nClient's recent workouts (newest first):\n2026-11-19 Lower A (done, felt solid): Goblet Split Squat With Blocked Knee, Goblet Squat\n\nCatalog (ref | name | type | equipment | movement | notes):\n${catalog}`);
console.log("SUGGESTIONS:", JSON.stringify(res));
if (!Array.isArray(res.items) || !res.items.length) throw new Error("no suggestions");
const small = await groqJson(SYSTEM, `Client's latest message:\n"""Can we move Friday's session to Saturday?"""\n\nCatalog:\n${catalog}`);
console.log("SMALL TALK:", JSON.stringify(small));
