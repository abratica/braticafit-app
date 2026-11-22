// CI check for video calls: the Daily key works, a private room and join passes can be made,
// and the transcript list answers. Cleans up after itself.
const KEY = Deno.env.get("DAILY_API_KEY") ?? "";
const D = "https://api.daily.co/v1";
const call = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(D + path, { ...init, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" } });
  const t = await r.text();
  console.log(init.method ?? "GET", path.split("?")[0], r.status, t.slice(0, 300).replace(/"token":"[^"]+"/, '"token":"…"'));
  return { ok: r.ok, body: t ? JSON.parse(t) : null };
};
const now = Math.floor(Date.now() / 1000);
const dom = await call("/");
const room = await call("/rooms", { method: "POST", body: JSON.stringify({ name: `bf-ci-${now}`, privacy: "private",
  properties: { nbf: now - 60, exp: now + 600, eject_at_room_exp: true, enable_transcription_storage: true, enable_prejoin_ui: true, enable_knocking: false, enable_chat: true, lang: "en" } }) });
const coach = await call("/meeting-tokens", { method: "POST", body: JSON.stringify({ properties: { room_name: room.body?.name, exp: now + 600, eject_at_token_exp: true, user_name: "Andrew", is_owner: true, auto_start_transcription: true } }) });
const client = await call("/meeting-tokens", { method: "POST", body: JSON.stringify({ properties: { room_name: room.body?.name, exp: now + 600, user_name: "Test", is_owner: false, permissions: { canAdmin: false } } }) });
const list = await call(`/transcript?room_name=${room.body?.name}&limit=5`);
await call(`/rooms/${room.body?.name}`, { method: "DELETE" });
const ok = dom.ok && room.ok && coach.ok && client.ok && list.ok;
console.log(ok ? "DAILY CHECK OK" : "DAILY CHECK FAILED");
if (!ok) Deno.exit(1);
