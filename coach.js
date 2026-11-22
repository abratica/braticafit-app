// BraticaFit coach mode. Loaded only after the database confirms the signed-in account is the coach,
// so client devices never download this file in normal use.

import { createTrain } from "./coach-train.js?v=7";
import { createInbox } from "./coach-inbox.js?v=2";

const DATA = "https://raw.githubusercontent.com/abratica/youtube-summaries/coach-data/";
const PAGE = 60;

const BUCKETS = [
  ["all", "All", 0, Infinity],
  ["15", "≤15s", 0, 15],
  ["30", "≤30s", 0, 30],
  ["60", "≤60s", 0, 60],
  ["180", "1–3 min", 61, 180],
  ["600", "3–10 min", 181, 600],
  ["long", "10+ min", 601, Infinity],
];

const EXERCISES = [
  "romanian deadlift", "single leg deadlift", "trap bar deadlift", "deadlift", "rdl", "goblet squat", "front squat", "back squat",
  "bulgarian split squat", "split squat", "cossack squat", "box squat", "squat", "reverse lunge", "walking lunge", "lunge",
  "step up", "hip thrust", "glute bridge", "good morning", "kettlebell swing", "swing", "bench press", "incline press",
  "overhead press", "shoulder press", "landmine press", "push up", "push-up", "pushup", "pull up", "pull-up", "pullup", "chin up",
  "lat pulldown", "pulldown", "seated row", "cable row", "dumbbell row", "barbell row", "inverted row", "row", "face pull",
  "lateral raise", "front raise", "rear delt fly", "chest fly", "bicep curl", "hammer curl", "curl", "tricep extension",
  "skull crusher", "pushdown", "dip", "plank", "side plank", "dead bug", "bird dog", "pallof press", "farmer carry", "carry",
  "copenhagen plank", "nordic curl", "calf raise", "hip flexor stretch", "hamstring stretch", "couch stretch", "90/90",
  "thoracic rotation", "cat cow", "world's greatest stretch", "ankle mobility", "hip mobility", "shoulder mobility", "stretch",
];
const EQUIP = [["bodyweight", "Bodyweight"], ["dumbbell", "Dumbbells"], ["barbell", "Barbell"], ["kettlebell", "Kettlebell"], ["band", "Bands"],
  ["cable", "Cable"], ["machine", "Machines"], ["suspension", "Rings / TRX"], ["other", "Other gear"]];
const EQ_LABEL = Object.fromEntries(EQUIP);
const EQ_RX = [["barbell", /\bbarbell|\bbb\b|trap[- ]bar|hex[- ]bar|landmine|zercher/], ["dumbbell", /dumbbell|\bdb\b|goblet/], ["kettlebell", /kettlebell|\bkb\b/],
  ["band", /\bbands?\b|\bbanded|resistance band|mini[- ]?band/], ["cable", /\bcable/],
  ["machine", /machine|leg press|smith|pull-?down|pec deck|leg curl|leg extension|hack squat|chest press|seated row machine|assisted pull/],
  ["suspension", /\btrx|suspension|\brings?\b/], ["other", /\bplate\b|med(icine)? ball|sandbag|ab wheel|stability ball|swiss ball|foam roll|\bsled\b|slideboard|slider|\bdowel/]];
function guessEq(text) {
  const t = String(text || "").toLowerCase();
  const out = EQ_RX.filter(([, rx]) => rx.test(t)).map(([k]) => k);
  if (out.includes("machine") && /lat pull-?down|cable/.test(t)) out.splice(out.indexOf("machine"), 1, ...(out.includes("cable") ? [] : ["cable"]));
  return out.length ? [...new Set(out)] : ["bodyweight"];
}
const HYPE = /\b(and then|wrong|fail|failed|shock|shocked|insane|legendary|impressive|amazing|incredible|secret|caught|crazy|gone|terribly|horribly|everyone|satisfying|perfect|exact pr|vs\.?|side effects|unless)\b/i;
const STORY = /\b(she|he|her|his|him|bro|man|men|woman|women|lady|girl|guy|wife|husband|year old|kid|grandma|grandpa)\b/i;
const INSTRUCT = /\b(how to|how-to|proper form|form tips|form guide|technique|tutorial|demo|demonstration|step by step|cues?|setup|explained)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;

function demoScore(title) {
  const t = title.toLowerCase();
  let s = 0;
  if (INSTRUCT.test(t)) s += 3;
  if (EXERCISES.some((e) => t.includes(e))) s += 2;
  if (EMOJI.test(title)) s -= 3;
  if (HYPE.test(title)) s -= 3;
  if (STORY.test(title)) s -= 2;
  if (/[!?]/.test(title)) s -= 1;
  const caps = (title.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !["RDL", "DB", "KB", "TRX"].includes(w)).length;
  s -= Math.min(caps, 2) * 2;
  return s;
}

function guessExercise(title) {
  const t = title.toLowerCase();
  const hit = EXERCISES.filter((e) => t.includes(e)).sort((a, b) => b.length - a.length)[0];
  if (hit) return hit.replace(/\b\w/g, (c) => c.toUpperCase()).replace("Rdl", "RDL");
  return title.replace(EMOJI, "").replace(/[!?|#].*$/, "").trim().slice(0, 60);
}

const dur = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
const views = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const isVm = (id) => String(id || "").startsWith("vm:");
const thumb = (id) => (isVm(id) ? `https://vumbnail.com/${id.slice(3)}.jpg` : `https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
const embed = (id, start = 0) => (isVm(id)
  ? `https://player.vimeo.com/video/${id.slice(3)}?autoplay=1&dnt=1&playsinline=1&title=0&byline=0&portrait=0${start ? `#t=${start}s` : ""}`
  : `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1${start ? `&start=${start}` : ""}`);
const KIND_LABEL = { exercise: "Exercise", workout: "Workout", education: "Education" };
// Channels whose videos count as Education (explainers rather than demos or follow-alongs).
const EDU_SLUGS = new Set(["e3rehab", "theprehabguys", "squatuniversity", "tommorrison", "jeffnippard"]);
const toSec = (v) => {
  const t = String(v || "").trim();
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  return parts.reduce((a, n) => a * 60 + n, 0);
};
const fromSec = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");
const watchUrl = (id) => (isVm(id) ? `https://vimeo.com/${id.slice(3)}` : `https://youtu.be/${id}`);

const SVG = (p, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const IC = {
  dash: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
  clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  programs: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  library: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  inbox: '<path d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M3.5 13.5H9l1 2h4l1-2h5.5"/>',
  calls: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  x: '<path d="M7 7l10 10M17 7 7 17"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
};

export async function openCoach({ db, user, esc, toast, ymd, api, view, exit }) {
  if (!document.querySelector('link[data-coach]')) {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = "coach.css?v=9"; l.dataset.coach = "1";
    document.head.appendChild(l);
  }
  document.body.classList.add("coach-on");
  const root = document.createElement("div");
  root.id = "coach-root";
  document.body.appendChild(root);

  const [view0, openId] = String(view || "").split(".");
  const st = {
    inbox: openId ? { threads: [], open: openId, msgs: [], urls: {}, attach: null, clip: null, rec: null, sig: "", draft: "" } : undefined, unread: 0,
    view: ["dashboard", "library", "clients", "programs", "inbox", "calls"].includes(view0) ? view0 : "dashboard", channels: [], data: {}, demos: [], pn: null, thumbs: {}, members: [], requests: [], confirmRm: null, mail: null,
    client: null, prog: null, progList: [],
    lib: { tab: "library", src: "pn", channel: null, bucket: "all", q: "", sort: "demo", clean: true, shown: PAGE,
      kind: "all", eq: "all", pattern: "all", version: "all", showIn: true, lq: "", lkind: "all", leq: "all" },
  };

  async function loadIndex() {
    try {
      const r = await fetch(DATA + "index.json?t=" + Math.floor(Date.now() / 60000), { cache: "no-store" });
      st.channels = (await r.json()).channels || [];
    } catch { st.channels = []; }
    if (!st.lib.channel && st.channels[0]) st.lib.channel = st.channels[0].slug;
  }
  async function loadChannel(slug) {
    if (st.data[slug]) return st.data[slug];
    const r = await fetch(DATA + "channels/" + slug + ".json", { cache: "no-store" });
    const j = await r.json();
    j.items = j.videos.map(([id, title, seconds, published, v]) => ({ id, title, seconds, published, views: v, score: demoScore(title) }));
    st.data[slug] = j;
    return j;
  }
  async function loadDemos() {
    const { data } = await db.from("coach_demos").select("*").order("exercise_name").order("created_at");
    st.demos = data ?? [];
    for (const d of st.demos) if (d.thumb) st.thumbs[d.video_id] = d.thumb;
  }

  // ---------- shell ----------
  function shell(inner) {
    const nav = [["dashboard", "Dashboard", "dash"], ["library", "Library", "library"], ["clients", "Clients", "clients"],
      ["programs", "Programs", "programs"], ["inbox", "Inbox", "inbox"], ["calls", "Calls", "calls"]];
    return `
      <aside class="c-side">
        <img class="c-wordmark" src="icons/wordmark.webp" alt="BraticaFit">
        <nav class="c-nav" aria-label="Coach">
          ${nav.map(([k, label, ic]) => `<button data-nav="${k}" ${st.view === k || (k === "clients" && st.view === "client") ? 'aria-current="page"' : ""}>${SVG(IC[ic])}<span>${label}</span>
            ${k === "library" && st.demos.length ? `<i class="c-badge">${st.demos.length}</i>` : ""}${k === "clients" && st.requests.length ? `<i class="c-badge hot">${st.requests.length}</i>` : ""}${k === "inbox" && st.unread ? `<i class="c-badge hot">${st.unread}</i>` : ""}</button>`).join("")}
        </nav>
        <div class="c-side-foot">
          <div class="c-mode" role="group" aria-label="Mode"><button aria-pressed="true">Coach</button><button aria-pressed="false" data-exit>Me</button></div>
          <div class="c-me"><img src="icons/logo.webp" alt="" width="34" height="34"><div><b>Andrew</b><span>Coach</span></div></div>
        </div>
      </aside>
      <main class="c-main"><div class="c-wrap">${inner}</div></main>
      <div class="c-modal" id="c-modal" hidden></div>`;
  }

  async function render() {
    if (st.view === "dashboard") root.innerHTML = shell(await dashboard());
    else if (st.view === "library") root.innerHTML = shell(await library());
    else if (st.view === "clients") root.innerHTML = shell(await clients());
    else if (st.view === "client" && st.client) root.innerHTML = shell(await train.clientView());
    else if (st.view === "programs") root.innerHTML = shell(await train.programsView());
    else if (st.view === "inbox") root.innerHTML = shell(await inbox.view());
    else root.innerHTML = shell(soon());
    root.scrollTop = 0;
    const msgs = root.querySelector("#ib-msgs");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function soon() {
    const what = {
      calls: ["Calls", "Scheduled video calls with reminders and Join inside the app."] }[st.view];
    return `<header class="c-head"><div><p class="c-eyebrow">Next up</p><h1>${what[0]}</h1></div></header>
      <section class="c-card c-empty"><p>${what[1]}</p><p class="muted">This part isn't built yet.</p>
      <button class="btn primary" data-nav="inbox">${SVG(IC.inbox, 18)}Go to the Inbox</button></section>`;
  }

  // ---------- clients ----------
  async function loadMembers() {
    const [{ data, error }, { data: reqs }] = await Promise.all([
      db.from("members").select("*").order("invited_at", { ascending: false }),
      db.from("access_requests").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    ]);
    if (error) toast(error.message);
    st.members = data ?? [];
    st.requests = reqs ?? [];
  }
  function requestsCard() {
    if (!st.requests.length) return "";
    return `<section class="c-card c-requests">
        <h3>Access requests <i class="c-badge">${st.requests.length}</i></h3>
        <ul class="c-clients">${st.requests.map((r) => `<li class="c-client">
          <div class="c-client-who"><b>${esc(r.name)}</b><span class="c-vm">${esc(r.email)} · ${esc(ago(r.created_at))}</span>
            ${r.note ? `<span class="c-req-note">“${esc(r.note)}”</span>` : ""}</div>
          <button class="btn primary c-rm" data-approve="${r.id}">Add as client</button>
          <button class="btn ghost c-rm" data-dismiss="${r.id}">Dismiss</button>
        </li>`).join("")}</ul>
      </section>`;
  }
  function ago(ts) {
    if (!ts) return "";
    const m = Math.round((Date.now() - new Date(ts)) / 60000);
    if (m < 2) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return d < 30 ? `${d}d ago` : new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  async function loadMail() {
    if (st.mail) return;
    let status = { configured: false, defaults: { subject: "", body: "" } };
    try { status = await api("email_status"); } catch {}
    const { data } = await db.from("coach_settings").select("key,value").in("key", ["welcome_subject", "welcome_body"]);
    const saved = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    st.mail = { configured: status.configured, subject: saved.welcome_subject ?? status.defaults.subject, body: saved.welcome_body ?? status.defaults.body, open: false };
  }
  async function sendWelcome(memberId, label) {
    try {
      await api("welcome", { member_id: memberId });
      toast(`Welcome email sent to ${label}`);
    } catch (e) { toast(e.message || "Couldn't send the email"); }
  }
  function mailCard() {
    const M = st.mail;
    return `<section class="c-card">
        <div class="c-card-head"><h3>Welcome email</h3><button class="c-link" id="c-mail-toggle">${M.open ? "Close" : "Edit"}</button></div>
        <p class="c-vm" style="margin:0">${M.configured ? "Sent from andrew@braticafit.com when you add a client." : "Email isn't connected yet. Your wording saves now and sends once it is."}
          Use <b>{first name}</b> for their name and <b>{button}</b> for the Open BraticaFit button.</p>
        ${M.open ? `<form id="c-mail" class="c-mail">
          <label><span>Subject</span><input id="c-mail-subject" value="${esc(M.subject)}" required></label>
          <label><span>Message</span><textarea id="c-mail-body" rows="11" required>${esc(M.body)}</textarea></label>
          <div class="c-mail-actions"><button class="btn primary">Save</button>
            <button type="button" class="btn ghost" id="c-mail-test" ${M.configured ? "" : "disabled"}>Send me a test</button></div>
        </form>` : ""}
      </section>`;
  }
  async function clients() {
    await Promise.all([loadMembers(), loadMail()]);
    const joined = st.members.filter((m) => m.user_id).length;
    const rows = st.members.map((m) => {
      const status = m.user_id
        ? `<span class="c-pill on">Joined</span><span class="c-vm">Active ${esc(ago(m.last_seen_at || m.joined_at))}</span>`
        : `<span class="c-pill">Invited</span><span class="c-vm">${m.welcomed_at ? `Welcome sent ${esc(ago(m.welcomed_at))}` : `Added ${esc(ago(m.invited_at))}`}</span>`;
      const welcomeBtn = !m.user_id && st.mail.configured
        ? `<button class="btn ghost c-rm" data-welcome="${m.id}">${m.welcomed_at ? "Resend welcome" : "Send welcome"}</button>` : "";
      const confirming = st.confirmRm === m.id;
      return `<li class="c-client">
        <div class="c-client-who">${m.user_id ? `<button class="c-namelink" data-open-client="${m.user_id}">${esc(m.name || m.email)}</button>` : `<b>${esc(m.name || m.email)}</b>`}${m.name ? `<span class="c-vm">${esc(m.email)}</span>` : ""}</div>
        <div class="c-client-status">${status}</div>
        ${m.user_id ? `<button class="btn primary c-rm" data-open-client="${m.user_id}">Open</button>` : ""}
        ${welcomeBtn}
        <button class="btn ${confirming ? "primary" : "ghost"} c-rm" data-rm="${m.id}">${confirming ? "Tap again to remove" : "Remove"}</button>
      </li>`;
    }).join("");
    return `<header class="c-head"><div><p class="c-eyebrow">${joined} joined · ${st.members.length - joined} invited</p><h1>Clients</h1></div></header>
      ${requestsCard()}
      <section class="c-card">
        <h3>Add a client</h3>
        <form id="c-add" class="c-add">
          <label><span>Full name</span><input id="c-add-name" required placeholder="First and last name" autocomplete="off" autocapitalize="words"></label>
          <label><span>Email</span><input id="c-add-email" type="email" required placeholder="name@email.com" autocomplete="off" inputmode="email"></label>
          <button class="btn primary">Add</button>
        </form>
        <label class="c-check"><input type="checkbox" id="c-add-welcome" ${st.mail.configured ? "checked" : "disabled"}> Send them the welcome email</label>
        <p class="c-vm" style="margin:8px 0 0">They sign in at the app with this email. Until you add them, that email can't get in.</p>
      </section>
      ${mailCard()}
      <section class="c-card">
        <h3>Your clients</h3>
        ${st.members.length ? `<ul class="c-clients">${rows}</ul>` : `<p class="c-empty-line">No clients yet. Add one above.</p>`}
      </section>`;
  }

  // ---------- dashboard ----------
  async function dashboard() {
    const now = new Date();
    const mon = new Date(now); mon.setHours(12, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
    const { data: ov, error } = await db.rpc("coach_overview", { p_from: ymd(days[0]), p_to: ymd(days[6]) });
    if (error) toast(error.message);
    const people = ov ?? [];
    const clientsOnly = people.filter((p) => !p.is_me);
    const today = ymd(now);
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
    const hr = now.getHours();
    const hello = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const totalVideos = st.channels.reduce((n, c) => n + (c.total || 0), 0);
    const wDone = clientsOnly.reduce((n, p) => n + p.workouts.filter((w) => w.done).length, 0);
    const wAll = clientsOnly.reduce((n, p) => n + p.workouts.length, 0);

    const cells = (p) => days.map((d) => {
      const key = ymd(d);
      const items = p.workouts.filter((w) => w.day === key);
      let cls = "rest", label = "Rest", inner = "–";
      if (items.length && items.every((w) => w.done)) { cls = "done"; label = "Done"; inner = SVG(IC.check, 16); }
      else if (items.length && key < today) { cls = "missed"; label = "Missed"; inner = SVG(IC.x, 14); }
      else if (items.length && key === today) { cls = "today"; label = "Today"; inner = "Today"; }
      else if (items.length) { cls = "planned"; label = "Planned"; inner = "<i></i>"; }
      return `<span class="c-cell ${cls}" title="${label}${items[0] ? ": " + esc(items.map((w) => w.title).join(", ")) : ""}">${inner}<span class="sr">${label}</span></span>`;
    }).join("");

    // Who needs a nudge: missed sessions, gone quiet, no food logs, rough sessions.
    const flags = [];
    for (const p of clientsOnly) {
      const s = { food: true, ...(p.settings || {}) };
      const missed = p.workouts.filter((w) => !w.done && w.day < today).length;
      if (missed) flags.push([p, `Missed ${missed} workout${missed === 1 ? "" : "s"} this week`]);
      const quiet = p.last_seen_at ? (Date.now() - new Date(p.last_seen_at)) / 864e5 : null;
      if (quiet != null && quiet >= 4) flags.push([p, `Hasn't opened the app in ${Math.floor(quiet)} days`]);
      if (s.food && p.food_days_7 <= 2) flags.push([p, `Logged food ${p.food_days_7} of the last 7 days`]);
      if (p.last_feel === "rough") flags.push([p, "Last workout felt rough"]);
      if (p.targets?.protein_g && p.avg_protein_7 != null && p.avg_protein_7 < p.targets.protein_g * 0.75) flags.push([p, `Protein averaging ${p.avg_protein_7}g of ${p.targets.protein_g}g`]);
    }
    const kcalLine = (p) => p.avg_kcal_7 == null ? "–" : `${Number(p.avg_kcal_7).toLocaleString()}${p.targets?.kcal ? ` <span class="c-vm">/ ${p.targets.kcal.toLocaleString()}</span>` : ""}`;

    let fresh = [];
    if (st.channels[0]) {
      const ch = await loadChannel(st.channels[0].slug);
      fresh = ch.items.filter((v) => v.seconds <= 60 && v.score >= 2).sort((a, b) => b.score - a.score || b.views - a.views).slice(0, 6);
    }

    return `
      <header class="c-head">
        <div><p class="c-eyebrow">${fmt.format(now)}</p><h1>${hello}, Andrew</h1></div>
        <div class="c-head-act"><button class="btn ghost" data-nav="programs">${SVG(IC.programs, 18)}Programs</button>
          <button class="btn primary" data-nav="clients">${SVG(IC.clients, 18)}Clients</button></div>
      </header>
      <div class="c-stats">
        <div class="c-stat"><span>Clients</span><b class="accent">${clientsOnly.length}</b><em>${st.members.length - clientsOnly.length ? `${st.members.length - clientsOnly.length} invited, not joined` : "Joined and active"}</em></div>
        <div class="c-stat"><span>Client workouts</span><b>${wDone}/${wAll}</b><em>Done this week</em></div>
        <div class="c-stat"><span>In your Library</span><b>${st.demos.length}</b><em>${(totalVideos + 793).toLocaleString()} videos to browse</em></div>
        <div class="c-stat"><span>Needs attention</span><b>${new Set(flags.map(([p]) => p.user_id)).size}</b><em>${flags.length ? "See below" : "All good"}</em></div>
      </div>
      <div class="c-row">
        <section class="c-card grow"><h3>Needs attention</h3>
          ${flags.length ? `<ul class="c-flags">${flags.slice(0, 8).map(([p, why]) => `<li><button class="c-namelink" data-open-client="${p.user_id}">${esc(p.name)}</button><span>${esc(why)}</span></li>`).join("")}</ul>`
            : `<p class="c-empty-line">${clientsOnly.length ? "Nobody's slipping right now." : "No clients yet. Once clients are in, anyone who misses workouts, goes quiet, or stops logging food shows up here."}</p>`}</section>
        <section class="c-card"><h3>Today's calls</h3><p class="c-empty-line">No calls scheduled.</p></section>
      </div>
      <section class="c-card"><h3>This week</h3>
        <div class="c-week-scroll"><div class="c-week wide">
          <div class="c-week-head"><span>Who</span>${days.map((d) => `<span>${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}</span>`).join("")}<span>Done</span><span>Food 7d</span><span>Avg cal</span><span>Protein</span></div>
          ${people.map((p) => `<div class="c-week-row">
            <span class="c-who"><button class="c-namelink" data-open-client="${p.user_id}">${p.is_me ? `<img src="icons/logo.webp" alt="" width="28" height="28">Andrew (you)` : esc(p.name)}</button></span>
            ${cells(p)}<span class="c-done">${p.workouts.filter((w) => w.done).length}/${p.workouts.length}</span>
            <span class="c-done">${p.settings?.food === false ? "off" : `${p.food_days_7}/7`}</span><span class="c-done">${kcalLine(p)}</span>
            <span class="c-done">${p.avg_protein_7 != null ? `${p.avg_protein_7}g` : "–"}</span></div>`).join("")}
        </div></div>
      </section>
      ${fresh.length ? `<section class="c-card"><div class="c-card-head"><h3>Best demo matches</h3><button class="c-link" data-nav="library" data-libtab="browse">Browse</button></div>
        <div class="c-grid six">${fresh.map(card).join("")}</div></section>` : ""}`;
  }

  // ---------- library (saved) + browse (everything) ----------
  const inLib = (id) => st.demos.find((d) => d.video_id === id);
  const thumbOf = (id) => st.thumbs[id] || thumb(id);
  const matchQ = (q, ...txt) => !q || q.split(/\s+/).every((w) => txt.some((t) => (t || "").toLowerCase().includes(w)));

  async function loadPN() {
    if (st.pn) return st.pn;
    const [cat, media] = await Promise.all([
      fetch("data/pn.json").then((r) => r.json()),
      fetch("data/pn-media.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    const items = [];
    for (const e of cat.items) {
      for (const ver of ["men", "women"]) {
        if (!e[ver]) continue;
        const id = "vm:" + e[ver];
        const [seconds, th] = media[e[ver]] || [];
        if (th) st.thumbs[id] = th;
        items.push({ id, name: e.name, title: e.name, version: ver, seconds: seconds || 0, channel: "Precision Nutrition", kind: "exercise",
          eq: e.eq, pattern: e.pattern, cues: e.cues || "", easier: e.easier, harder: e.harder, travel: e.travel, views: 0, published: "", score: 9 });
      }
    }
    st.pn = { channel: "Precision Nutrition", items, byName: new Map(items.map((x) => [x.name.toLowerCase() + "|" + x.version, x])) };
    return st.pn;
  }
  const ytKind = (v) => (v.seconds && v.seconds > 180 ? "workout" : "exercise");
  const asItem = (v, ch) => {
    const edu = EDU_SLUGS.has(ch.slug);
    return { ...v, channel: ch.channel, kind: edu ? "education" : ytKind(v), eq: guessEq(v.title), name: edu ? v.title.replace(EMOJI, "").replace(/\s*[|#].*$/, "").trim().slice(0, 80) : guessExercise(v.title) };
  };

  function eqChips(pool, cur, attr) {
    const counts = {};
    for (const x of pool) for (const k of x.eq) counts[k] = (counts[k] || 0) + 1;
    return `<button class="c-chip ${cur === "all" ? "on" : ""}" data-${attr}="all">Any equipment</button>`
      + EQUIP.filter(([k]) => counts[k]).map(([k, label]) => `<button class="c-chip ${cur === k ? "on" : ""}" data-${attr}="${k}">${label} <i>${counts[k]}</i></button>`).join("");
  }
  const kindChips = (cur, attr) => [["all", "All"], ["exercise", "Exercises"], ["workout", "Workouts"], ["education", "Education"]]
    .map(([k, l]) => `<button class="c-chip ${cur === k ? "on" : ""}" data-${attr}="${k}">${l}</button>`).join("");
  const verLabel = (v) => (v === "men" ? "Men's" : v === "women" ? "Women's" : "");

  function card(v) {
    const saved = inLib(v.id);
    return `<div class="c-demo">
      <button class="c-vid" data-vid="${v.id}">
        <span class="c-thumb" style="background-image:url('${thumbOf(v.id)}')"><span class="c-play">${SVG(IC.play, 16)}</span>${v.seconds ? `<span class="c-dur">${dur(v.seconds)}</span>` : ""}
          <span class="c-kind ${v.kind}">${KIND_LABEL[v.kind] || "Exercise"}</span></span>
        <span class="c-vt">${esc(v.title)}</span>
        <span class="c-vm">${v.version ? `${verLabel(v.version)} · ${esc(v.pattern || "")}` : `${v.views ? `${views(v.views)} views · ` : ""}${(v.published || "").slice(0, 4)}`}</span></button>
      <button class="c-icon c-add ${saved ? "on" : ""}" data-quick="${v.id}" aria-pressed="${!!saved}" aria-label="${saved ? "In your Library. Tap to remove" : "Add to Library"}" title="${saved ? "In your Library" : "Add to Library"}">${SVG(saved ? IC.check : IC.plus, 17)}</button>
    </div>`;
  }

  async function library() {
    const L = st.lib;
    const tabs = `<div class="c-tabs big"><button ${L.tab === "library" ? 'aria-current="page"' : ""} data-libtab="library">Library <i>${st.demos.length}</i></button>
      <button ${L.tab === "browse" ? 'aria-current="page"' : ""} data-libtab="browse">Browse</button></div>`;
    const head = `<header class="c-head"><div><p class="c-eyebrow">Videos</p><h1>${L.tab === "library" ? "Your Library" : "Browse videos"}</h1></div></header>${tabs}`;
    return head + (L.tab === "library" ? libraryTab() : await browseTab());
  }

  function libraryTab() {
    const L = st.lib;
    if (!st.demos.length) return `<section class="c-card c-empty"><p>Your Library is empty. Go to <button class="c-link" data-libtab="browse">Browse</button> and tap <b>+</b> on any video to add it.</p></section>`;
    const rows = st.demos.map((d) => ({ ...d, eqs: d.equipment?.length ? d.equipment : guessEq(`${d.exercise_name} ${d.title || ""}`) }));
    const q = L.lq.trim().toLowerCase();
    const base = rows.filter((d) => (L.lkind === "all" || d.kind === L.lkind) && matchQ(q, d.exercise_name, d.title));
    const list = base.filter((d) => L.leq === "all" || d.eqs.includes(L.leq));
    const groups = {};
    for (const d of list) (groups[d.exercise_name] ??= []).push(d);
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    return `
      <div class="c-tools"><label class="c-search">${SVG(IC.search, 17)}<span class="sr">Search your Library</span><input id="c-lq" value="${esc(L.lq)}" placeholder="Search your Library" autocomplete="off"></label></div>
      <div class="c-chips small">${kindChips(L.lkind, "lkind")}</div>
      <div class="c-chips small">${eqChips(base.map((d) => ({ eq: d.eqs })), L.leq, "leq")}</div>
      <p class="c-count">${names.length} ${names.length === 1 ? "entry" : "entries"} · ${list.length} video${list.length === 1 ? "" : "s"}</p>
      ${names.length ? names.map((name) => `
        <section class="c-card"><h3>${esc(name)} <span class="c-kind inline ${groups[name][0].kind}">${KIND_LABEL[groups[name][0].kind] || "Exercise"}</span></h3>
          ${groups[name].find((d) => d.helps_with) ? `<p class="c-helps">Helps with: ${esc(groups[name].find((d) => d.helps_with).helps_with)}</p>` : ""}
          <div class="c-grid">${groups[name].map((d) => `<div class="c-demo">
            <button class="c-vid" data-vid="${d.video_id}">
              <span class="c-thumb" style="background-image:url('${d.thumb || thumbOf(d.video_id)}')"><span class="c-play">${SVG(IC.play, 16)}</span>${d.seconds ? `<span class="c-dur">${dur(d.seconds)}</span>` : ""}</span>
              <span class="c-vt">${esc(d.title || "")}</span><span class="c-vm">${esc(d.channel || "")}${d.start_sec ? ` · starts ${fromSec(d.start_sec)}` : ""}${d.kind !== "education" && d.eqs.length ? ` · ${d.eqs.map((k) => EQ_LABEL[k] || k).join(", ")}` : ""}</span></button>
            <button class="c-icon" data-del="${d.id}" aria-label="Remove ${esc(name)} from your Library">${SVG(IC.trash, 17)}</button></div>`).join("")}</div>
        </section>`).join("") : `<section class="c-card c-empty"><p>Nothing in your Library matches those filters.</p></section>`}`;
  }

  async function browseTab() {
    const L = st.lib;
    if (L.src === "pn" || !st.channels.length) { L.src = "pn"; await loadPN(); }
    const srcChips = `<button class="c-chip ${L.src === "pn" ? "on" : ""}" data-src="pn">Precision Nutrition <i>${st.pn ? st.pn.items.length : "800"}</i></button>`
      + st.channels.map((c) => `<button class="c-chip ${L.src === c.slug ? "on" : ""}" data-src="${c.slug}">${esc(c.channel)} <i>${(c.total || 0).toLocaleString()}</i></button>`).join("");
    const isPN = L.src === "pn";
    let pool;
    if (isPN) pool = (await loadPN()).items;
    else { const ch = await loadChannel(L.src); pool = ch.items.map((v) => asItem(v, ch)); }
    const q = L.q.trim().toLowerCase();
    let base = pool.filter((v) => (L.kind === "all" || v.kind === L.kind) && matchQ(q, v.title, v.name) && (L.showIn || !inLib(v.id)));
    if (isPN) base = base.filter((v) => (L.pattern === "all" || v.pattern === L.pattern) && (L.version === "all" || v.version === L.version));
    else {
      const [, , lo, hi] = BUCKETS.find((b) => b[0] === L.bucket);
      base = base.filter((v) => v.seconds >= lo && v.seconds <= hi && (!L.clean || v.score >= (v.kind === "exercise" ? 1 : 0)));
    }
    let items = base.filter((v) => L.eq === "all" || v.eq.includes(L.eq));
    if (!isPN) {
      const by = { demo: (a, b) => b.score - a.score || b.views - a.views, views: (a, b) => b.views - a.views, new: (a, b) => (a.published < b.published ? 1 : -1) }[L.sort];
      items = items.sort(by);
    }
    const nIn = pool.filter((v) => inLib(v.id)).length;
    const patterns = isPN ? [...new Set(pool.map((v) => v.pattern))] : [];
    return `
      <div class="c-chips">${srcChips}</div>
      <div class="c-tools">
        <label class="c-search">${SVG(IC.search, 17)}<span class="sr">Search</span><input id="c-q" value="${esc(L.q)}" placeholder="${isPN ? "Search exercises, e.g. split squat" : "Search titles, e.g. lat pulldown"}" autocomplete="off"></label>
        ${isPN ? `<label class="c-select"><span class="sr">Movement</span><select id="c-pattern"><option value="all">All movements</option>
            ${patterns.map((p) => `<option ${L.pattern === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>`
          : `<label class="c-select"><span class="sr">Sort</span><select id="c-sort">
            <option value="demo" ${L.sort === "demo" ? "selected" : ""}>Best demo match</option>
            <option value="views" ${L.sort === "views" ? "selected" : ""}>Most viewed</option>
            <option value="new" ${L.sort === "new" ? "selected" : ""}>Newest</option></select></label>
          <button class="c-toggle" id="c-clean" aria-pressed="${L.clean}"><span class="c-knob"></span>Hide clickbait</button>`}
        <label class="c-check"><input type="checkbox" id="c-showin" ${L.showIn ? "checked" : ""}> Show ones in my Library${nIn ? ` <i>${nIn}</i>` : ""}</label>
      </div>
      <div class="c-chips small">${kindChips(L.kind, "kind")}${isPN
        ? `<span class="c-chip-sep"></span>${[["all", "Both versions"], ["men", "Men's"], ["women", "Women's"]].map(([k, l]) => `<button class="c-chip ${L.version === k ? "on" : ""}" data-version="${k}">${l}</button>`).join("")}`
        : `<span class="c-chip-sep"></span>${BUCKETS.map(([k, label]) => `<button class="c-chip ${L.bucket === k ? "on" : ""}" data-bucket="${k}">${label}</button>`).join("")}`}</div>
      <div class="c-chips small">${eqChips(base, L.eq, "eq")}</div>
      <p class="c-count">${items.length.toLocaleString()} video${items.length === 1 ? "" : "s"}${!L.showIn && nIn ? ` · ${nIn} already in your Library hidden` : ""}</p>
      ${items.length ? `<div class="c-grid">${items.slice(0, L.shown).map(card).join("")}</div>` : `<section class="c-card c-empty"><p>Nothing matches. Try loosening a filter.</p></section>`}
      ${items.length > L.shown ? `<button class="btn ghost block c-more" id="c-more">Show more (${(items.length - L.shown).toLocaleString()} left)</button>` : ""}`;
  }

  function browseItem(id) {
    const p = st.pn?.items.find((x) => x.id === id);
    if (p) return p;
    for (const ch of Object.values(st.data)) {
      const v = ch.items.find((x) => x.id === id);
      if (v) return asItem(v, ch);
    }
    return null;
  }

  async function addToLib(v, name = v.name, kind = v.kind, extra = {}) {
    const { error } = await db.from("coach_demos").insert({
      video_id: v.id, exercise_name: name, title: v.version ? `${verLabel(v.version)} ${v.title}` : v.title, seconds: v.seconds || null,
      channel: v.channel || null, kind, equipment: kind === "education" ? [] : v.eq || [], pattern: v.pattern || null, cues: v.cues || null, thumb: st.thumbs[v.id] || null,
      ...extra,
    });
    if (error) { toast(error.code === "23505" ? "Already in your Library" : error.message); return false; }
    await loadDemos();
    return true;
  }
  async function removeFromLib(id) {
    const { error } = await db.from("coach_demos").delete().eq("id", id);
    if (error) { toast(error.message); return false; }
    await loadDemos();
    return true;
  }
  function refreshBadges() {
    const b = root.querySelector('[data-nav="library"] .c-badge');
    if (b) b.textContent = st.demos.length;
    const t = root.querySelector('[data-libtab="library"] i');
    if (t) t.textContent = st.demos.length;
  }

  // ---------- player modal ----------
  function findVideo(id) {
    const v = browseItem(id);
    if (v) return v;
    const d = inLib(id);
    return d ? { id, title: d.title || "", name: d.exercise_name, seconds: d.seconds || 0, channel: d.channel, kind: d.kind, eq: d.equipment || [], pattern: d.pattern, cues: d.cues || "", views: 0, published: "" } : null;
  }
  const cueList = (s) => {
    const parts = String(s || "").split(/\s*\d+\.\s+/).map((x) => x.trim()).filter(Boolean);
    return parts.length ? `<ol class="c-cues">${parts.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : "";
  };
  function variantBtn(label, name, ver) {
    if (!name || !st.pn) return "";
    const hit = st.pn.byName.get(name.toLowerCase() + "|" + ver) || st.pn.byName.get(name.toLowerCase() + "|" + (ver === "men" ? "women" : "men"));
    return hit ? `<button class="c-chip" data-vid="${hit.id}">${label}: ${esc(name)}</button>` : `<span class="c-vm">${label}: ${esc(name)}</span>`;
  }

  function openPlayer(id) {
    const v = findVideo(id);
    if (!v) return;
    const saved = inLib(id);
    const tall = v.seconds && v.seconds <= 60 && !isVm(id);
    const m = root.querySelector("#c-modal");
    const defName = saved?.exercise_name || v.name || guessExercise(v.title);
    m.innerHTML = `<div class="c-modal-bg" data-close></div>
      <div class="c-modal-box ${tall ? "tall" : "side"}" role="dialog" aria-modal="true" aria-label="${esc(v.title)}">
        <button class="c-icon c-close" data-close aria-label="Close">${SVG(IC.x, 20)}</button>
        <div class="c-player ${tall ? "tall" : "side"}"><iframe src="${embed(id, saved?.start_sec || 0)}" title="${esc(v.title)}"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
        <div class="c-modal-info">
          <h2>${esc(v.version ? v.name : v.title)}</h2>
          <p class="c-vm">${v.version ? `${verLabel(v.version)} · ` : ""}${esc(v.channel || "")}${v.seconds ? ` · ${dur(v.seconds)}` : ""}${v.views ? ` · ${views(v.views)} views` : ""}
            · <a href="${watchUrl(id)}" target="_blank" rel="noopener">${isVm(id) ? "Vimeo" : "YouTube"} ${SVG(IC.ext, 13)}</a></p>
          ${v.kind !== "education" && (v.eq?.length || v.pattern) ? `<p class="c-tags">${v.pattern ? `<span>${esc(v.pattern)}</span>` : ""}${(v.eq || []).map((k) => `<span>${EQ_LABEL[k] || k}</span>`).join("")}</p>` : ""}
          ${cueList(v.cues)}
          ${v.easier || v.harder || v.travel ? `<div class="c-variants">${variantBtn("Easier", v.easier, v.version)}${variantBtn("Harder", v.harder, v.version)}${variantBtn("No gear", v.travel, v.version)}</div>` : ""}
          ${saved ? `<div class="c-saved-line">${SVG(IC.check, 16)} In your Library <button class="c-link" data-del="${saved.id}">Remove</button></div>` : ""}
          <form class="c-save" id="c-save">
            <label><span>Name in your Library</span><input id="c-ex" value="${esc(defName)}" required></label>
            <div class="c-save-row">
              <label class="c-select"><span>Type</span><select id="c-kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${(saved?.kind || v.kind || "exercise") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
              <label><span>Start at</span><input id="c-start" value="${esc(fromSec(saved?.start_sec))}" placeholder="0:00" inputmode="numeric"></label>
            </div>
            <label><span>Helps with <em>(the suggester reads this)</em></span><textarea id="c-helps" rows="2" placeholder="e.g. shoulders take over on push-ups; low back on squats">${esc(saved?.helps_with || "")}</textarea></label>
            <button class="btn primary">${saved ? `${SVG(IC.check, 17)}Save changes` : `${SVG(IC.plus, 17)}Add to Library`}</button></form>
        </div>
      </div>`;
    m.hidden = false;
    m.querySelector("#c-save")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = m.querySelector("#c-ex").value.trim();
      if (!name) return;
      const start = toSec(m.querySelector("#c-start").value);
      if (Number.isNaN(start)) return toast("Start time looks off. Use minutes:seconds, like 3:50");
      const extra = { start_sec: start, helps_with: m.querySelector("#c-helps").value.trim() || null };
      const kind = m.querySelector("#c-kind").value;
      if (saved) {
        const { error } = await db.from("coach_demos").update({ exercise_name: name, kind, ...extra }).eq("id", saved.id);
        if (error) return toast(error.message);
        await loadDemos();
        toast("Saved");
      } else {
        if (!(await addToLib(v, name, kind, extra))) return;
        toast(`Added ${name}`);
      }
      closePlayer();
      render();
    });
  }
  function closePlayer() {
    const m = root.querySelector("#c-modal");
    if (m) { m.hidden = true; m.innerHTML = ""; }
  }

  // ---------- events ----------
  let qTimer;
  root.addEventListener("click", async (e) => {
    const t = e.target.closest("button, [data-close]");
    if (!t) return;
    if (t.dataset.close !== undefined) return closePlayer();
    if (await inbox.onClick(t)) return;
    if (t.hasAttribute("data-exit")) return close();
    if (t.dataset.nav) {
      st.view = t.dataset.nav; if (st.view === "programs") st.prog = null;
      if (t.dataset.libtab) st.lib.tab = t.dataset.libtab;
      return render();
    }
    if (t.dataset.libtab) { closePlayer(); Object.assign(st.lib, { tab: t.dataset.libtab, shown: PAGE }); return render(); }
    if (t.dataset.src) { Object.assign(st.lib, { src: t.dataset.src, shown: PAGE, eq: "all", kind: "all", pattern: "all" }); return render(); }
    for (const k of ["kind", "eq", "version", "lkind", "leq"]) {
      if (t.dataset[k] !== undefined) { st.lib[k] = t.dataset[k]; st.lib.shown = PAGE; return render(); }
    }
    if (t.dataset.bucket) { Object.assign(st.lib, { bucket: t.dataset.bucket, shown: PAGE }); return render(); }
    if (t.dataset.quick) {
      const id = t.dataset.quick, saved = inLib(id);
      t.disabled = true;
      if (saved) {
        if (await removeFromLib(saved.id)) toast(`Removed ${saved.exercise_name}`);
      } else {
        const v = browseItem(id);
        if (v && (await addToLib(v))) toast(`Added ${v.name}`);
      }
      t.disabled = false;
      if (!st.lib.showIn && !saved && inLib(id)) return render();
      const on = !!inLib(id);
      t.classList.toggle("on", on); t.setAttribute("aria-pressed", on);
      t.title = on ? "In your Library" : "Add to Library";
      t.setAttribute("aria-label", on ? "In your Library. Tap to remove" : "Add to Library");
      t.innerHTML = SVG(on ? IC.check : IC.plus, 17);
      refreshBadges();
      return;
    }
    if (t.id === "c-clean") { st.lib.clean = !st.lib.clean; st.lib.shown = PAGE; return render(); }
    if (t.id === "c-more") { st.lib.shown += PAGE; return render(); }
    if (t.dataset.vid) return openPlayer(t.dataset.vid);
    if (t.dataset.openClient) return train.openClient(t.dataset.openClient, st.view === "dashboard" ? "dashboard" : "clients");
    if (t.dataset.welcome) {
      const m = st.members.find((x) => x.id === t.dataset.welcome);
      t.disabled = true;
      await sendWelcome(t.dataset.welcome, m?.name || m?.email || "them");
      return render();
    }
    if (t.dataset.approve) {
      const r = st.requests.find((x) => x.id === t.dataset.approve);
      if (!r) return;
      t.disabled = true;
      const { data: row, error } = await db.from("members").insert({ email: r.email, name: r.name }).select("id").single();
      if (error && error.code !== "23505") { t.disabled = false; return toast(error.message); }
      await db.from("access_requests").update({ status: "approved", handled_at: new Date().toISOString() }).eq("id", r.id);
      if (row && st.mail?.configured) await sendWelcome(row.id, r.name);
      else toast(`Added ${r.name}`);
      return render();
    }
    if (t.dataset.dismiss) {
      await db.from("access_requests").update({ status: "dismissed", handled_at: new Date().toISOString() }).eq("id", t.dataset.dismiss);
      toast("Request dismissed");
      return render();
    }
    if (t.id === "c-mail-toggle") { st.mail.open = !st.mail.open; return render(); }
    if (t.id === "c-mail-test") {
      t.disabled = true;
      await saveMail(false);
      try { const r = await api("welcome", { test: true }); toast(`Test sent to ${r.sent}`); }
      catch (err) { toast(err.message || "Couldn't send the test"); }
      t.disabled = false;
      return;
    }
    if (t.dataset.rm) {
      if (st.confirmRm !== t.dataset.rm) { st.confirmRm = t.dataset.rm; return render(); }
      const { error } = await db.from("members").delete().eq("id", t.dataset.rm);
      st.confirmRm = null;
      if (error) return toast(error.message);
      toast("Removed. Their logs are kept.");
      return render();
    }
    if (t.dataset.del) {
      if (!(await removeFromLib(t.dataset.del))) return;
      closePlayer();
      toast("Removed from your Library");
      return render();
    }
  });
  async function saveMail(announce = true) {
    const subject = root.querySelector("#c-mail-subject")?.value.trim();
    const body = root.querySelector("#c-mail-body")?.value.replace(/\r\n/g, "\n").trim();
    if (!subject || !body) return toast("Add a subject and a message");
    const now = new Date().toISOString();
    const { error } = await db.from("coach_settings").upsert([
      { key: "welcome_subject", value: subject, updated_at: now },
      { key: "welcome_body", value: body, updated_at: now },
    ]);
    if (error) return toast(error.message);
    Object.assign(st.mail, { subject, body });
    if (announce) toast("Welcome email saved");
  }
  root.addEventListener("submit", async (e) => {
    if (e.target.id === "c-mail") { e.preventDefault(); return saveMail(); }
    if (e.target.id !== "c-add") return;
    e.preventDefault();
    const email = root.querySelector("#c-add-email").value.trim().toLowerCase();
    const name = root.querySelector("#c-add-name").value.trim().replace(/\s+/g, " ");
    if (!email) return;
    if (name.split(" ").length < 2) return toast("Add their first and last name");
    if (email === (user.email || "").toLowerCase()) return toast("That's your coach email. Use a different one.");
    const welcome = root.querySelector("#c-add-welcome")?.checked;
    const { data: row, error } = await db.from("members").insert({ email, name }).select("id").single();
    if (error) return toast(error.code === "23505" ? "That email is already on your list" : error.message);
    if (welcome) await sendWelcome(row.id, name);
    else toast(`Added ${name}`);
    render();
  });
  root.addEventListener("change", (e) => {
    if (e.target.id === "c-sort") { st.lib.sort = e.target.value; st.lib.shown = PAGE; render(); }
    if (e.target.id === "c-pattern") { st.lib.pattern = e.target.value === "All movements" ? "all" : e.target.value; st.lib.shown = PAGE; render(); }
    if (e.target.id === "c-showin") { st.lib.showIn = e.target.checked; st.lib.shown = PAGE; render(); }
  });
  root.addEventListener("input", (e) => {
    const fid = e.target.id;
    if (fid !== "c-q" && fid !== "c-lq") return;
    clearTimeout(qTimer);
    qTimer = setTimeout(async () => {
      st.lib[fid === "c-q" ? "q" : "lq"] = e.target.value; st.lib.shown = PAGE;
      const pos = e.target.selectionStart;
      await render();
      const q = root.querySelector("#" + fid);
      if (q) { q.focus(); q.setSelectionRange(pos, pos); }
    }, 250);
  });
  const onKey = (e) => { if (e.key === "Escape") closePlayer(); };
  document.addEventListener("keydown", onKey);

  // Phone Back button: close the top thing in coach mode, then coach mode itself.
  function onBack(e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const m = root.querySelector("#c-modal");
    if (m && !m.hidden) return closePlayer();
    const box = document.querySelector("body > .c-modal");
    if (box) return box.querySelector("[data-x]")?.click();
    if (st.view === "inbox" && st.inbox?.open && window.innerWidth <= 800) { st.inbox.open = null; return render(); }
    if (st.view === "client") { st.view = "clients"; return render(); }
    if (st.view === "programs" && st.prog) { st.prog = null; return render(); }
    if (st.view !== "dashboard") { st.view = "dashboard"; return render(); }
    close();
  }
  window.addEventListener("bf-back", onBack);

  function close() {
    window.removeEventListener("bf-back", onBack);
    document.removeEventListener("keydown", onKey);
    inbox.stop();
    root.remove();
    document.body.classList.remove("coach-on");
    exit();
  }

  const train = createTrain({ db, esc, toast, SVG, IC, st, root, render, ago, user });
  const inbox = createInbox({ db, esc, toast, SVG, IC, st, root, api, thumbOf, openPlayer, loadPN, loadChannel });
  root.innerHTML = shell(`<p class="c-empty-line">Loading…</p>`);
  await Promise.all([loadIndex(), loadDemos(), loadMembers(), inbox.unreadNow()]);
  await render();
}
