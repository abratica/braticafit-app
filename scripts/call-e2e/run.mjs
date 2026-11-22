// End-to-end check of call notes: a headless "coach" joins a real Daily room and plays a
// recorded voice into the mic; then we pull Daily's transcript the same way the app does.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const KEY = process.env.DAILY_API_KEY, D = "https://api.daily.co/v1";
const api = async (path, init = {}) => {
  const r = await fetch(D + path, { ...init, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" } });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: t ? JSON.parse(t) : null };
};
const now = Math.floor(Date.now() / 1000);
const room = await api("/rooms", { method: "POST", body: JSON.stringify({ name: `bf-e2e-${now}`, privacy: "private",
  properties: { nbf: now - 60, exp: now + 900, eject_at_room_exp: true, enable_transcription_storage: true, enable_prejoin_ui: false, lang: "en" } }) });
console.log("room", room.status, room.body?.name);
const tok = await api("/meeting-tokens", { method: "POST", body: JSON.stringify({ properties: { room_name: room.body.name, exp: now + 900,
  user_name: "Andrew", is_owner: true, auto_start_transcription: true } }) });
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  "--use-file-for-fake-audio-capture=/tmp/talk.wav", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ permissions: ["microphone", "camera"] });
const pg = await ctx.newPage();
await pg.goto(`http://localhost:8790/page.html?url=${encodeURIComponent(room.body.url)}&token=${tok.body.token}`);
await pg.waitForTimeout(80000);
console.log("events:", await pg.evaluate(() => window.log));
await pg.evaluate(() => window.leave()).catch(() => {});
await pg.waitForTimeout(5000);
await browser.close();

let vtt = "", ids = [];
for (let i = 0; i < 24; i++) {
  const l = await api(`/transcript?room_name=${room.body.name}&limit=5`);
  const list = l.body?.data ?? [];
  console.log("transcripts:", JSON.stringify(list.map((t) => [t.status, t.isVttAvailable, t.duration])));
  const done = list.filter((t) => t.status === "t_finished");
  if (done.length && !list.some((t) => t.status === "t_in_progress")) {
    for (const t of done) {
      ids.push(t.transcriptId);
      const link = await api(`/transcript/${t.transcriptId}/access-link`);
      console.log("link keys:", Object.keys(link.body ?? {}));
      const url = link.body?.link ?? link.body?.download_link;
      vtt += await (await fetch(url)).text();
    }
    break;
  }
  await new Promise((r) => setTimeout(r, 10000));
}
console.log("VTT (start):\n" + vtt.slice(0, 1500));
writeFileSync("/tmp/call.vtt", vtt);
for (const id of ids) console.log("delete transcript", (await api(`/transcript/${id}`, { method: "DELETE" })).status);
console.log("delete room", (await api(`/rooms/${room.body.name}`, { method: "DELETE" })).status);
if (!vtt.trim()) { console.log("NO TRANSCRIPT"); process.exit(1); }
