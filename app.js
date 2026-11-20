import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://ktpztiyqyoalrwnqtqme.supabase.co";
const SUPABASE_KEY = "sb_publishable_aUvlMasnVDO34rV8wBWnCw_oywTssOz";
const API = `${SUPABASE_URL}/functions/v1/api`;
// A sign-in link that expired or was already used comes back with an error in the URL.
const linkError = (() => {
  const p = new URLSearchParams(location.hash.slice(1));
  const code = p.get("error_code") || p.get("error");
  if (!code) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return code;
})();
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } });

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const r0 = (n) => Math.round(Number(n) || 0);
const KEYS = ["kcal", "protein", "carbs", "fat", "sat_fat", "fiber", "soluble_fiber", "sugar", "sodium"];

const ENERGY = [["wired", "Wired"], ["good", "Good"], ["flat", "Flat"], ["crashed", "Crashed"]];
const STOMACH = [["great", "Great"], ["fine", "Fine"], ["bloated", "Bloated"], ["rough", "Rough"]];

let user = null;
let tab = "today";
let isCoach = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

async function api(action, payload = {}) {
  const { data: { session } } = await db.auth.getSession();
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
function when(d) {
  d = new Date(d);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return timeFmt.format(d);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${timeFmt.format(d)}`;
  return `${dayFmt.format(d)}, ${timeFmt.format(d)}`;
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const localInputValue = (d = new Date()) => {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 16);
};

function sumNutrients(list) {
  const t = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const n of list) for (const k of KEYS) t[k] += Number(n?.[k]) || 0;
  return t;
}
function scale(n, f) {
  return Object.fromEntries(KEYS.map((k) => [k, (Number(n?.[k]) || 0) * f]));
}
const macroLine = (n) => `${r0(n.kcal)} cal · ${r0(n.protein)}g protein`;

// Shrink a photo before sending: keeps cost and upload time low.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
function toJpeg(img, max, quality) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
function squareThumb(img, size = 160) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const m = Math.min(img.naturalWidth, img.naturalHeight);
  c.getContext("2d").drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.7);
}

// ---------------------------------------------------------------------------
// Sheet (bottom modal)
// ---------------------------------------------------------------------------
function openSheet(html) {
  $("#sheet-body").innerHTML = html;
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
  return $("#sheet-body");
}
function closeSheet() {
  stopScanner();
  stopRecap();
  $("#sheet").hidden = true;
  document.body.style.overflow = "";
}
$("#sheet").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });

// ---------------------------------------------------------------------------
// Sign in (6-digit email code)
// ---------------------------------------------------------------------------
function renderSignIn() {
  $("#tabs").hidden = true;
  $("#settings").hidden = true;
  document.body.classList.add("signin");
  const preset = new URLSearchParams(location.search).get("email") || "";
  app.innerHTML = `
    <div class="auth">
      <img class="auth-logo wide" src="icons/wordmark-lg.webp" alt="BraticaFit" width="320" height="122">
      <form id="f-email" class="auth-form">
        <p class="auth-head">Sign in</p>
        ${linkError ? `<p class="auth-msg">That sign-in link expired or was already used. Send yourself a fresh one.</p>`
          : `<p class="auth-sub">Use the email Andrew added you with.</p>`}
        <label class="auth-label" for="email">Email</label>
        <input class="auth-input" id="email" type="email" autocomplete="email" placeholder="you@email.com" required value="${esc(preset)}">
        <button class="auth-btn">Email me a sign-in link</button>
      </form>
      <div id="sent" class="auth-sent" hidden>
        <p class="auth-head">Check your email</p>
        <p>Tap <b>Log In</b> in the email. It opens BraticaFit signed in.</p>
        <p class="auth-fine">Use this same phone. Didn't get it? Check spam, or <button type="button" class="auth-link" id="resend">send again</button>.</p>
      </div>
      <form id="f-req" class="auth-form" hidden>
        <p class="auth-head">Not on the list yet</p>
        <p class="auth-sub"><span id="req-email"></span> isn't on the client list. Ask Andrew for access and you'll get an email once you're added.</p>
        <label class="auth-label" for="req-name">Full name</label>
        <input class="auth-input" id="req-name" autocomplete="name" placeholder="First and last name" required>
        <label class="auth-label" for="req-note" style="margin-top:14px">Note <span class="auth-opt">(optional)</span></label>
        <textarea class="auth-input auth-note" id="req-note" rows="3" maxlength="500" placeholder="Anything Andrew should know?"></textarea>
        <button class="auth-btn">Request access</button>
        <p class="auth-fine" style="margin-top:12px"><button type="button" class="auth-link" id="req-back">Use a different email</button></p>
      </form>
      <div id="req-done" class="auth-sent" hidden>
        <p class="auth-head">Request sent</p>
        <p>Andrew will get your request. Once he adds you, you'll get a welcome email that signs you right in.</p>
      </div>
    </div>`;
  const show = (id) => { for (const k of ["f-email", "sent", "f-req", "req-done"]) $("#" + k).hidden = k !== id; };
  const email = () => $("#email").value.trim().toLowerCase();
  const busy = (form, on, label) => { const b = $(`#${form} .auth-btn`); b.disabled = on; if (label) b.textContent = label; };

  const send = async () => {
    busy("f-email", true, "Sending…");
    try {
      const r = await api("send_link", { email: email() });
      if (r.allowed === false) {
        $("#req-email").textContent = email();
        show("f-req");
        $("#req-name").focus();
      } else show("sent");
    } catch (e) { toast(e.message); }
    busy("f-email", false, "Email me a sign-in link");
  };
  $("#f-email").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  $("#resend").addEventListener("click", send);
  $("#req-back").addEventListener("click", () => { show("f-email"); $("#email").focus(); });
  $("#f-req").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#req-name").value.trim();
    if (name.split(/\s+/).length < 2) return toast("Add your first and last name");
    busy("f-req", true, "Sending…");
    try {
      const r = await api("request_access", { email: email(), name, note: $("#req-note").value });
      if (r.allowed) return send();
      show("req-done");
    } catch (err) { toast(err.message); }
    busy("f-req", false, "Request access");
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
const VIEWS = { today: renderHome, train: renderTrain, food: renderFood, progress: renderProgress, coach: renderCoach, settings: renderSettings };
function go(next) {
  tab = next;
  document.body.classList.remove("has-composer");
  for (const b of document.querySelectorAll("#tabs button")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  window.scrollTo(0, 0);
  return VIEWS[tab]();
}
$("#settings").addEventListener("click", () => go("settings"));
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) go(b.dataset.tab);
});

// ---------------------------------------------------------------------------
// Shared helpers for training views
// ---------------------------------------------------------------------------
const ymd = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const fromYmd = (s) => new Date(`${s}T12:00:00`);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const weekStart = (d = new Date()) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const shortFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const wdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const callFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

const FEEL = [["easy", "Easy"], ["solid", "Solid"], ["tough", "Tough"], ["rough", "Rough"]];

function ytId(s) {
  if (!s) return null;
  const m = String(s).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(String(s).trim()) ? String(s).trim() : null;
}
const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const player = (id) => `<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1"
  title="Workout video" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;

const ICO = {
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  video: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg>`,
  train: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`,
  back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
  send: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  scan: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5h3M17 5h3v2M20 17v2h-3M7 19H4v-2M8 9v6M11 9v6M14 9v6M16.5 9v6"/></svg>`,
  type: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>`,
};

function workoutMeta(w, nEx) {
  const bits = [w.kind === "video" ? "Video" : "Written"];
  if (w.duration_min) bits.push(`${w.duration_min} min`);
  if (w.kind === "written" && nEx) bits.push(`${nEx} exercise${nEx === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

// ---------------------------------------------------------------------------
// Today (home): today's workout, quick food logging, check-ins when due, daily recap
// ---------------------------------------------------------------------------
async function renderHome(highlightId) {
  $("#sub").textContent = dayFmt.format(new Date());
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const [{ data: ws }, { data: pending }, { data: recaps }] = await Promise.all([
    db.from("workouts").select("*, workout_exercises(count)").eq("scheduled_on", ymd()).order("created_at"),
    db.from("meals").select("id,name,eaten_at,energy,stomach").gte("eaten_at", since).lte("checkin_due_at", new Date().toISOString()).is("checked_in_at", null).order("eaten_at", { ascending: false }),
    db.from("recaps").select("id").gte("recorded_at", startOfToday().toISOString()).limit(1),
  ]);
  const list = ws ?? [];
  const w = list.find((x) => !x.completed_at) ?? list[0];
  const nEx = w?.workout_exercises?.[0]?.count ?? 0;
  const recapDone = (recaps ?? []).length > 0;

  let workout;
  if (!w) {
    workout = `<div class="card rest">
      <div class="w-title">Rest day</div>
      <p class="small muted" style="margin:4px 0 14px">Nothing planned for today.</p>
      <button class="btn ghost block" id="plan">Plan a workout</button></div>`;
  } else {
    const thumb = w.kind === "video" && w.video_id
      ? `<button class="vthumb" data-open="${w.id}" style="background-image:url('${ytThumb(w.video_id)}')" aria-label="Play ${esc(w.title)}">
           <span class="play">${ICO.play}</span>${w.duration_min ? `<span class="dur">${w.duration_min} min</span>` : ""}<span class="tag">Video</span></button>`
      : "";
    workout = `<div class="card w-card">${thumb}
      <div class="w-title">${esc(w.title)}</div>
      <div class="small muted">${workoutMeta(w, nEx)}</div>
      ${w.completed_at
        ? `<div class="done-line">${ICO.check}<span>Done${w.feel ? ` · felt ${feelLabel(FEEL, w.feel).toLowerCase()}` : ""}</span></div>`
        : `<button class="btn primary block start" data-open="${w.id}">${ICO.play}Start workout</button>`}
    </div>`;
  }

  app.innerHTML = `
    <div id="install-slot"></div>
    <h3>Today's workout</h3>
    ${workout}
    <h3>Log food</h3>
    <div class="log-row">
      <button class="btn" id="snap">${ICO.camera}Snap</button>
      <button class="btn" id="scan">${ICO.scan}Scan</button>
      <button class="btn" id="type">${ICO.type}Type</button>
    </div>
    ${(pending ?? []).length ? `<h3>How do you feel?</h3>${pending.map(checkinCard).join("")}` : ""}
    <h3>Daily recap</h3>
    <button class="recap-btn" id="recap">
      <span class="recap-ico ${recapDone ? "done" : ""}">${recapDone ? ICO.check : ICO.mic}</span>
      <span><b>${recapDone ? "Today's recap is in" : "Tell me how today went"}</b>
      <span class="small muted">${recapDone ? "Tap to add more" : "Talk for about a minute"}</span></span>
    </button>`;

  app.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openSession(b.dataset.open)));
  $("#plan")?.addEventListener("click", () => openPlanner());
  $("#snap").addEventListener("click", () => $("#camera").click());
  $("#type").addEventListener("click", openTextLog);
  $("#scan").addEventListener("click", openScanner);
  $("#recap").addEventListener("click", openRecap);
  bindCheckins(app, () => renderHome());
  showInstallBar();

  if (highlightId) {
    const card = app.querySelector(`[data-checkin="${highlightId}"]`);
    if (card) { card.scrollIntoView({ block: "center" }); card.classList.add("flash"); }
    else openMeal(highlightId);
  }
}

// ---------------------------------------------------------------------------
// Daily voice recap (speech-to-text in the browser, editable before saving)
// ---------------------------------------------------------------------------
let activeRec = null;
function stopRecap() { try { activeRec?.stop(); } catch {} activeRec = null; }

function openRecap() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const body = openSheet(`
    <h2>Daily recap</h2>
    <p class="small muted">How did today go? Training, food, sleep, stress, anything worth noting.</p>
    ${SR ? `<button class="mic-big" id="mic" aria-pressed="false" aria-label="Start talking">${ICO.mic}</button>
            <p class="small muted center" id="mic-state">Tap to talk. Tap again to stop.</p>` : `<p class="small muted">Voice isn't available in this browser, so type it instead.</p>`}
    <label class="field"><span>Your recap</span><textarea class="input" id="rt" rows="6" placeholder="It shows up here as you talk. You can edit it."></textarea></label>
    <button class="btn primary block" id="save-recap">Save recap</button>`);
  const ta = $("#rt", body);
  if (SR) {
    const mic = $("#mic", body);
    let base = "";
    mic.addEventListener("click", () => {
      if (activeRec) { stopRecap(); return; }
      const rec = new SR();
      rec.lang = navigator.language || "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      base = ta.value ? ta.value.trim() + " " : "";
      rec.onresult = (e) => {
        let finalText = "", interim = "";
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        ta.value = (base + finalText + interim).replace(/\s+/g, " ").trimStart();
      };
      rec.onend = () => {
        activeRec = null;
        mic.setAttribute("aria-pressed", "false");
        mic.setAttribute("aria-label", "Start talking");
        $("#mic-state", body).textContent = "Tap to keep talking.";
      };
      rec.onerror = (e) => { if (e.error === "not-allowed") toast("Microphone access is blocked"); };
      activeRec = rec;
      rec.start();
      mic.setAttribute("aria-pressed", "true");
      mic.setAttribute("aria-label", "Stop");
      $("#mic-state", body).textContent = "Listening… tap to stop.";
    });
  }
  $("#save-recap", body).addEventListener("click", async () => {
    stopRecap();
    const text = ta.value.trim();
    if (!text) return toast("Nothing to save yet");
    const { error } = await db.from("recaps").insert({ transcript: text });
    if (error) return toast(error.message);
    closeSheet();
    toast("Recap saved");
    if (tab === "today") renderHome();
  });
}

// ---------------------------------------------------------------------------
// Train: this week, the plan, past workouts
// ---------------------------------------------------------------------------
async function renderTrain() {
  const mon = weekStart();
  const sun = addDays(mon, 6);
  $("#sub").textContent = `Week of ${shortFmt.format(mon)}`;
  const [{ data: week }, { data: past }] = await Promise.all([
    db.from("workouts").select("*, workout_exercises(count)").gte("scheduled_on", ymd(mon)).lte("scheduled_on", ymd(sun)).order("scheduled_on").order("created_at"),
    db.from("workouts").select("*").not("completed_at", "is", null).lt("scheduled_on", ymd(mon)).order("scheduled_on", { ascending: false }).limit(8),
  ]);
  const ws = week ?? [];
  const today = ymd();
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(mon, i);
    const key = ymd(d);
    const items = ws.filter((w) => w.scheduled_on === key);
    const done = items.length && items.every((w) => w.completed_at);
    const mark = done ? `<span class="wk-mark on">${ICO.check}</span>` : items.length ? `<span class="wk-dot"></span>` : `<span class="wk-mark"></span>`;
    return `<div class="wk-day ${key === today ? "today" : ""}"><span class="wk-dow">${wdayFmt.format(d).slice(0, 1)}</span><b>${d.getDate()}</b>${mark}</div>`;
  }).join("");

  const planRow = (w) => {
    const nEx = w.workout_exercises?.[0]?.count ?? 0;
    const when = w.scheduled_on === today ? "today" : wdayFmt.format(fromYmd(w.scheduled_on));
    const end = w.completed_at ? `<span class="ok">${ICO.check}</span>` : `<span class="go">${w.scheduled_on === today ? "Start" : "Open"}</span>`;
    return `<li><button class="row" data-open="${w.id}">
      <span class="ico-box">${w.kind === "video" ? ICO.video : ICO.train}</span>
      <div class="main"><div class="name">${esc(w.title)}</div><div class="meta">${workoutMeta(w, nEx)} · ${w.completed_at ? `done ${when}` : when}</div></div>
      <div class="end">${end}</div></button></li>`;
  };

  app.innerHTML = `
    <h3>This week</h3>
    <div class="wk">${strip}</div>
    ${ws.length ? `<div class="card" style="margin-top:12px;padding-top:4px;padding-bottom:4px"><ul class="list">${ws.map(planRow).join("")}</ul></div>`
      : `<p class="empty">Nothing planned this week yet.</p>`}
    <button class="btn ghost block" id="plan" style="margin-top:10px">${ICO.plus}Plan a workout</button>
    ${(past ?? []).length ? `<h3>Past workouts</h3><div class="card" style="padding-top:4px;padding-bottom:4px"><ul class="list">${past.map((w) => `
      <li><button class="row" data-open="${w.id}"><div class="main"><div class="name">${esc(w.title)}</div>
      <div class="meta">${dayFmt.format(fromYmd(w.scheduled_on))}${w.duration_min ? ` · ${w.duration_min} min` : ""}</div></div>
      <div class="end">${w.feel ? feelLabel(FEEL, w.feel) : ""}</div></button></li>`).join("")}</ul></div>` : ""}`;
  app.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openSession(b.dataset.open)));
  $("#plan").addEventListener("click", () => openPlanner());
}

// Plan a workout (until the Coach app exists, you plan your own)
function openPlanner() {
  let kind = "video";
  const body = openSheet(`
    <h2>Plan a workout</h2>
    <label class="field"><span>Day</span><input class="input" id="pd" type="date" value="${ymd()}"></label>
    <label class="field"><span>Name</span><input class="input" id="pt" placeholder="Lower body strength" required></label>
    <div class="field"><span class="muted small">Type</span>
      <div class="seg seg-wide" id="pk"><button data-v="video" aria-pressed="true">Video</button><button data-v="written" aria-pressed="false">Written</button></div></div>
    <div id="pv">
      <label class="field"><span>YouTube link</span><input class="input" id="pu" inputmode="url" placeholder="https://youtu.be/…"></label>
    </div>
    <div id="pw" hidden>
      <label class="field"><span>Exercises, one per line</span><textarea class="input" id="px" rows="6"
        placeholder="Goblet squat, 3x10, 50&#10;Romanian deadlift, 3x8, 60&#10;Side plank, 3x30 sec"></textarea></label>
      <p class="small muted" style="margin-top:-4px">Name, sets x reps, weight. Add a YouTube link on any line for its demo.</p>
    </div>
    <label class="field"><span>Minutes <span class="muted">(optional)</span></span><input class="input" id="pm" type="number" inputmode="numeric"></label>
    <label class="field"><span>Note <span class="muted">(optional)</span></span><input class="input" id="pn" placeholder="Slow 3-second lower on the squats"></label>
    <button class="btn primary block" id="psave">Save workout</button>`);
  $("#pk", body).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    kind = b.dataset.v;
    $("#pk", body).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("#pv", body).hidden = kind !== "video";
    $("#pw", body).hidden = kind !== "written";
  });
  $("#psave", body).addEventListener("click", async () => {
    const title = $("#pt", body).value.trim();
    if (!title) return toast("Give it a name");
    const row = {
      scheduled_on: $("#pd", body).value || ymd(), title, kind,
      duration_min: $("#pm", body).value ? Number($("#pm", body).value) : null,
      note: $("#pn", body).value.trim() || null,
    };
    let exercises = [];
    if (kind === "video") {
      row.video_id = ytId($("#pu", body).value);
      if (!row.video_id) return toast("That doesn't look like a YouTube link");
    } else {
      exercises = parseExercises($("#px", body).value);
      if (!exercises.length) return toast("Add at least one exercise");
    }
    $("#psave", body).disabled = true;
    const { data: w, error } = await db.from("workouts").insert(row).select().single();
    if (error) { $("#psave", body).disabled = false; return toast(error.message); }
    if (exercises.length) {
      const { error: e2 } = await db.from("workout_exercises").insert(exercises.map((x, i) => ({ ...x, workout_id: w.id, position: i })));
      if (e2) toast(e2.message);
    }
    closeSheet();
    toast("Workout planned");
    go(tab === "today" ? "today" : "train");
  });
}

function parseExercises(text) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
    let demo = null;
    const rest = parts.filter((p) => { const id = ytId(p); if (id && /youtu/.test(p)) { demo = id; return false; } return true; });
    const [name, scheme = "", weight = ""] = rest;
    const m = scheme.match(/^(\d+)\s*[x×]\s*(.+)$/i);
    const nSets = m ? Math.min(Number(m[1]), 10) : 0;
    const reps = m ? m[2].trim() : "";
    const wt = weight.replace(/\s*(lb|lbs|kg)$/i, "");
    return {
      name: name || line, scheme: m ? `${m[1]} × ${reps}` : scheme || null, demo_video_id: demo,
      sets: Array.from({ length: nSets }, () => ({ reps, weight: wt, done: false })),
    };
  });
}

// ---------------------------------------------------------------------------
// Workout session: video player, or written exercises with sets to check off
// ---------------------------------------------------------------------------
async function openSession(id) {
  const back = tab === "today" ? "today" : "train";
  const [{ data: w }, { data: exs }] = await Promise.all([
    db.from("workouts").select("*").eq("id", id).single(),
    db.from("workout_exercises").select("*").eq("workout_id", id).order("position"),
  ]);
  if (!w) return toast("Couldn't find that workout");
  window.scrollTo(0, 0);
  const list = exs ?? [];
  $("#sub").textContent = w.scheduled_on === ymd() ? "Today" : dayFmt.format(fromYmd(w.scheduled_on));

  const exCard = (x, i) => `
    <div class="card ex" data-ex="${i}">
      <div class="ex-head">
        ${x.demo_video_id ? `<button class="ex-demo" data-demo="${x.demo_video_id}" style="background-image:url('${ytThumb(x.demo_video_id)}')" aria-label="Watch the ${esc(x.name)} demo"><span class="play sm">${ICO.play}</span></button>` : ""}
        <div class="main"><div class="name">${esc(x.name)}</div><div class="small muted">${esc(x.scheme || "")}${x.demo_video_id ? " · tap the video for the demo" : ""}</div></div>
      </div>
      ${x.sets?.length ? `<div class="set-grid set-head"><span>Set</span><span>Reps</span><span>Weight</span><span></span></div>
        ${x.sets.map((s, j) => `<div class="set-grid" data-set="${j}">
          <span class="set-n">${j + 1}</span>
          <input class="input set-in" data-f="reps" value="${esc(s.reps)}" aria-label="Set ${j + 1} reps">
          <input class="input set-in" data-f="weight" value="${esc(s.weight)}" inputmode="decimal" aria-label="Set ${j + 1} weight">
          <button class="set-done" data-done aria-pressed="${!!s.done}" aria-label="Set ${j + 1} done">${ICO.check}</button></div>`).join("")}` : ""}
    </div>`;

  app.innerHTML = `
    <div class="sess-head">
      <button class="icon-btn" id="back" aria-label="Back">${ICO.back}</button>
      <div><div class="w-title">${esc(w.title)}</div><div class="small muted">${workoutMeta(w, list.length)}</div></div>
    </div>
    ${w.note ? `<h3>Coach note</h3><div class="card note">${esc(w.note)}</div>` : ""}
    ${w.kind === "video" && w.video_id ? `<div style="margin-top:14px">${player(w.video_id)}</div>` : ""}
    ${list.length ? `<h3>Exercises</h3>${list.map(exCard).join("")}` : ""}
    ${w.completed_at
      ? `<div class="done-line" style="margin-top:16px">${ICO.check}<span>Done${w.feel ? ` · felt ${feelLabel(FEEL, w.feel).toLowerCase()}` : ""}</span></div>
         <button class="btn ghost block" id="undo" style="margin-top:10px">Mark not done</button>`
      : `<button class="btn primary block" id="finish" style="margin-top:16px">${w.kind === "video" ? "Mark done" : "Finish workout"}</button>`}
    <button class="btn danger block" id="del-w" style="margin-top:10px">Delete workout</button>`;

  $("#back").addEventListener("click", () => go(back));
  app.querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", () => openSheet(`<h2>Demo</h2>${player(b.dataset.demo)}`)));

  const timers = {};
  const save = (i) => {
    clearTimeout(timers[i]);
    timers[i] = setTimeout(async () => {
      const { error } = await db.from("workout_exercises").update({ sets: list[i].sets }).eq("id", list[i].id);
      if (error) toast(error.message);
    }, 400);
  };
  app.querySelectorAll("[data-ex]").forEach((card) => {
    const i = Number(card.dataset.ex);
    card.addEventListener("input", (e) => {
      const inp = e.target.closest(".set-in");
      if (!inp) return;
      const j = Number(inp.closest("[data-set]").dataset.set);
      list[i].sets[j][inp.dataset.f] = inp.value;
      save(i);
    });
    card.addEventListener("click", (e) => {
      const b = e.target.closest("[data-done]");
      if (!b) return;
      const j = Number(b.closest("[data-set]").dataset.set);
      list[i].sets[j].done = !list[i].sets[j].done;
      b.setAttribute("aria-pressed", String(list[i].sets[j].done));
      save(i);
    });
  });

  $("#finish")?.addEventListener("click", () => {
    const body = openSheet(`<h2>How did it feel?</h2><div class="chips" id="feel">${FEEL.map(([k, l]) => `<button class="chip" data-v="${k}">${l}</button>`).join("")}</div>`);
    $("#feel", body).addEventListener("click", async (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      const { error } = await db.from("workouts").update({ completed_at: new Date().toISOString(), feel: b.dataset.v }).eq("id", w.id);
      if (error) return toast(error.message);
      closeSheet();
      toast("Nice work");
      go(back);
    });
  });
  $("#undo")?.addEventListener("click", async () => {
    await db.from("workouts").update({ completed_at: null, feel: null }).eq("id", w.id);
    openSession(w.id);
  });
  $("#del-w").addEventListener("click", async () => {
    if (!confirmDelete(w.title)) return;
    await db.from("workouts").delete().eq("id", w.id);
    toast("Deleted");
    go(back);
  });
}

// Two-tap delete without a browser dialog
let pendingDelete = null;
function confirmDelete(name) {
  if (pendingDelete === name) { pendingDelete = null; return true; }
  pendingDelete = name;
  toast("Tap delete again to confirm");
  setTimeout(() => { if (pendingDelete === name) pendingDelete = null; }, 4000);
  return false;
}

// ---------------------------------------------------------------------------
// Food: log, today's numbers, what you've logged, My foods
// ---------------------------------------------------------------------------
let foodSeg = "today";
const foodSegHtml = () => `<div class="seg seg-wide" id="fseg" style="margin:6px 0 4px">
  <button data-v="today" aria-pressed="${foodSeg === "today"}">Today</button><button data-v="mine" aria-pressed="${foodSeg === "mine"}">My foods</button></div>`;
function bindFoodSeg() {
  $("#fseg")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === foodSeg) return;
    foodSeg = b.dataset.v;
    renderFood();
  });
}

// Goal − Food = Remaining, plus a bar per macro against its target.
function targetCard(g, t) {
  const food = r0(t.kcal), left = g.kcal - food;
  const bar = (name, have, want) => {
    const h = r0(have), over = h > want;
    return `<div class="mbar${over ? " over" : ""}"><div class="mbar-top"><span>${name}</span><b>${h} <i>/ ${want}g${over ? ` · ${h - want} over` : ` · ${want - h} left`}</i></b></div>
      <div class="mbar-track"><div style="width:${want ? Math.min(100, (h * 100) / want) : 0}%"></div></div></div>`;
  };
  return `<div class="card">
    <div class="kcal-eq">
      <div><b>${g.kcal.toLocaleString()}</b><span>Goal</span></div><i>−</i>
      <div><b>${food.toLocaleString()}</b><span>Food</span></div><i>=</i>
      <div class="${left < 0 ? "neg" : "rem"}"><b>${Math.abs(left).toLocaleString()}</b><span>${left < 0 ? "Over" : "Remaining"}</span></div>
    </div>
    ${bar("Protein", t.protein, g.protein_g)}${bar("Carbs", t.carbs, g.carbs_g)}${bar("Fat", t.fat, g.fat_g)}
    ${isCoach ? `<button class="auth-link t-edit" id="edit-targets">Edit targets</button>` : ""}
  </div>`;
}

async function renderFood() {
  if (foodSeg === "mine") { await renderFoods(foodSegHtml()); bindFoodSeg(); return; }
  $("#sub").textContent = dayFmt.format(new Date());
  const [{ data: meals }, { data: goal }] = await Promise.all([
    db.from("meals").select("id,name,servings,nutrients,eaten_at,energy,stomach,food_id")
      .gte("eaten_at", startOfToday().toISOString()).order("eaten_at", { ascending: false }),
    db.from("nutrition_targets").select("kcal,protein_g,carbs_g,fat_g").maybeSingle(),
  ]);
  const t = sumNutrients((meals ?? []).map((m) => m.nutrients));
  const kcal = r0(t.kcal);
  const share = (g, per) => (kcal ? Math.round((g * per * 100) / kcal) : 0);
  const bar = (name, g, per) => `<div class="mbar"><div class="mbar-top"><span>${name}</span><b>${r0(g)}g${kcal ? ` <i>· ${share(g, per)}% of calories</i>` : ""}</b></div>
    <div class="mbar-track"><div style="width:${Math.min(100, share(g, per))}%"></div></div></div>`;

  app.innerHTML = `
    ${foodSegHtml()}
    <div class="log-actions" style="margin-top:12px">
      <button class="btn primary wide" id="snap">${ICO.camera}Snap food</button>
      <button class="btn" id="scan">${ICO.scan}Scan barcode</button>
      <button class="btn" id="type">${ICO.type}Type it</button>
    </div>
    <h3>Today, roughly</h3>
    ${goal ? targetCard(goal, t) : `<div class="card">
      <div class="kcal"><b>${kcal.toLocaleString()}</b><span>calories so far</span></div>
      ${bar("Protein", t.protein, 4)}${bar("Carbs", t.carbs, 4)}${bar("Fat", t.fat, 9)}
      ${isCoach ? `<button class="btn block" id="set-targets" style="margin-top:14px">Set daily targets</button>` : ""}
    </div>`}
    <h3>Logged today</h3>
    ${(meals ?? []).length
      ? `<div class="card" style="padding-top:2px;padding-bottom:2px"><ul class="list">${meals.map((m) => `
          <li><button class="row" data-meal="${m.id}">
            <div class="main"><div class="name">${esc(m.name)}${m.servings != 1 ? ` <span class="badge">×${m.servings}</span>` : ""}</div>
            <div class="meta">${timeFmt.format(new Date(m.eaten_at))} · ${macroLine(m.nutrients)}</div></div>
            <div class="end">${feelBadge(m)}</div>
          </button></li>`).join("")}</ul></div>`
      : `<p class="empty">Nothing logged yet today.</p>`}`;
  bindFoodSeg();
  $("#set-targets")?.addEventListener("click", openTargets);
  $("#edit-targets")?.addEventListener("click", openTargets);
  $("#snap").addEventListener("click", () => $("#camera").click());
  $("#type").addEventListener("click", openTextLog);
  $("#scan").addEventListener("click", openScanner);
  app.querySelectorAll("[data-meal]").forEach((b) => b.addEventListener("click", () => openMeal(b.dataset.meal)));
}

// ---------------------------------------------------------------------------
// Calorie & macro targets: Mifflin-St Jeor BMR × activity, adjusted for the goal
// ---------------------------------------------------------------------------
const ACTIVITY = [
  ["sedentary", 1.2, "Mostly sitting", "Desk job, little or no exercise"],
  ["light", 1.375, "Lightly active", "On your feet some, or 1–3 workouts a week"],
  ["moderate", 1.55, "Moderately active", "3–5 workouts a week"],
  ["very", 1.725, "Very active", "Hard training 6–7 days, or a physical job"],
  ["extra", 1.9, "Extremely active", "Physical job plus hard daily training"],
];
const PACES = { lose: [0.25, 0.5, 0.75, 1, 1.5], maintain: [0], gain: [0.25, 0.5] };
const PROTEIN_PER_LB = [0.7, 0.8, 0.9, 1, 1.1, 1.2];
const FAT_PCT = [20, 25, 30, 35, 40];

function calcTargets(i) {
  const kg = i.weight_lb * 0.453592, cm = i.height_in * 2.54;
  const bmr = 10 * kg + 6.25 * cm - 5 * i.age + (i.sex === "male" ? 5 : -161);
  const tdee = bmr * (ACTIVITY.find((a) => a[0] === i.activity)?.[1] ?? 1.2);
  const sign = i.goal === "lose" ? -1 : i.goal === "gain" ? 1 : 0;
  let kcal = tdee + sign * i.pace_lb_wk * 500;          // ~3,500 kcal per lb, spread over 7 days
  const floor = i.sex === "male" ? 1500 : 1200;
  const floored = kcal < floor;
  kcal = Math.round(Math.max(kcal, floor) / 10) * 10;
  const protein_g = Math.round(i.weight_lb * i.protein_per_lb);
  const fat_g = Math.max(Math.round((kcal * i.fat_pct) / 100 / 9), Math.round(i.weight_lb * 0.3));
  const carbs_g = Math.max(0, Math.round((kcal - protein_g * 4 - fat_g * 9) / 4));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein_g, carbs_g, fat_g, floored };
}

async function openTargets() {
  const [{ data: cur }, { data: lastW }] = await Promise.all([
    db.from("nutrition_targets").select("*").maybeSingle(),
    db.from("weights").select("weight_lb,measured_at").order("measured_at", { ascending: false }).limit(1),
  ]);
  const w = lastW?.[0];
  const f = {
    sex: cur?.sex ?? "male", age: cur?.age ?? "", height_in: cur?.height_in ?? "",
    weight_lb: cur?.weight_lb ?? (w ? Number(w.weight_lb) : ""), activity: cur?.activity ?? "moderate",
    goal: cur?.goal ?? "maintain", pace_lb_wk: Number(cur?.pace_lb_wk ?? 0),
    protein_per_lb: Number(cur?.protein_per_lb ?? 0.8), fat_pct: Number(cur?.fat_pct ?? 30),
  };
  let custom = !!cur?.custom;
  let manual = cur?.custom ? { kcal: cur.kcal, protein_g: cur.protein_g, carbs_g: cur.carbs_g, fat_g: cur.fat_g } : null;
  const ft = f.height_in ? Math.floor(f.height_in / 12) : "", inch = f.height_in ? Math.round(f.height_in % 12) : "";
  const seg = (id, opts, v) => `<div class="seg seg-wide" id="${id}">${opts.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${String(k) === String(v)}">${l}</button>`).join("")}</div>`;

  const body = openSheet(`
    <h2>Daily targets</h2>
    <p class="small muted" style="margin-top:-4px">Calories and macros from your stats and goal. You can fine-tune the numbers after.</p>
    <div class="field"><span>Sex</span>${seg("t-sex", [["male", "Male"], ["female", "Female"]], f.sex)}</div>
    <div class="grid2">
      <label class="field"><span>Age</span><input class="input" id="t-age" type="number" inputmode="numeric" min="13" max="100" value="${esc(f.age)}"></label>
      <label class="field"><span>Weight (lb)</span><input class="input" id="t-w" type="number" inputmode="decimal" step="0.1" value="${esc(f.weight_lb)}"></label>
    </div>
    ${w && !cur ? `<p class="small muted" style="margin:-4px 0 6px">Weight is from your last weigh-in.</p>` : ""}
    <div class="field"><span>Height</span><div class="grid2">
      <label class="unit"><input class="input" id="t-ft" type="number" inputmode="numeric" min="4" max="7" value="${esc(ft)}"><i>ft</i></label>
      <label class="unit"><input class="input" id="t-in" type="number" inputmode="numeric" min="0" max="11" value="${esc(inch)}"><i>in</i></label></div></div>
    <label class="field"><span>Activity</span><select class="input" id="t-act">${ACTIVITY.map(([k, , l, d]) => `<option value="${k}" ${k === f.activity ? "selected" : ""}>${l}: ${d}</option>`).join("")}</select></label>
    <div class="field"><span>Goal</span>${seg("t-goal", [["lose", "Lose"], ["maintain", "Maintain"], ["gain", "Gain"]], f.goal)}</div>
    <div class="field" id="t-pace-wrap"><span>Pace</span><div class="chips" id="t-pace"></div></div>
    <div class="grid2">
      <label class="field"><span>Protein per lb</span><select class="input" id="t-pro">${PROTEIN_PER_LB.map((v) => `<option value="${v}" ${v === f.protein_per_lb ? "selected" : ""}>${v} g</option>`).join("")}</select></label>
      <label class="field"><span>Fat</span><select class="input" id="t-fat">${FAT_PCT.map((v) => `<option value="${v}" ${v === f.fat_pct ? "selected" : ""}>${v}% of calories</option>`).join("")}</select></label>
    </div>
    <div class="card t-result" id="t-out"></div>
    <button class="btn primary block" id="t-save">Save targets</button>`);

  const read = () => {
    f.age = Number($("#t-age", body).value);
    f.weight_lb = Number($("#t-w", body).value);
    f.height_in = Number($("#t-ft", body).value) * 12 + Number($("#t-in", body).value || 0);
    f.activity = $("#t-act", body).value;
    f.protein_per_lb = Number($("#t-pro", body).value);
    f.fat_pct = Number($("#t-fat", body).value);
  };
  const ready = () => f.age >= 13 && f.weight_lb > 50 && f.height_in >= 48;
  const drawPace = () => {
    const opts = PACES[f.goal];
    if (!opts.includes(f.pace_lb_wk)) f.pace_lb_wk = f.goal === "maintain" ? 0 : 0.5;
    $("#t-pace-wrap", body).hidden = f.goal === "maintain";
    $("#t-pace", body).innerHTML = opts.map((v) => `<button type="button" class="chip" data-pace="${v}" aria-pressed="${v === f.pace_lb_wk}">${v} lb/wk</button>`).join("");
  };
  const draw = () => {
    read();
    const out = $("#t-out", body);
    if (!ready()) { out.innerHTML = `<p class="small muted" style="margin:0">Fill in age, weight and height to see your numbers.</p>`; return; }
    const c = calcTargets(f);
    const n = custom && manual ? manual : c;
    const mk = (k, label, unit) => custom
      ? `<label class="t-num"><input class="input" data-m="${k}" type="number" inputmode="numeric" value="${n[k]}"><span>${label}</span></label>`
      : `<div class="t-num"><b>${n[k].toLocaleString()}${unit}</b><span>${label}</span></div>`;
    const sum = n.protein_g * 4 + n.carbs_g * 4 + n.fat_g * 9;
    out.innerHTML = `
      <p class="small muted" style="margin:0 0 10px">You burn about <b>${c.tdee.toLocaleString()}</b> a day (${c.bmr.toLocaleString()} at rest).${f.goal !== "maintain" ? ` ${f.goal === "lose" ? "Minus" : "Plus"} ${Math.round(f.pace_lb_wk * 500)} for ${f.pace_lb_wk} lb/wk.` : ""}</p>
      <div class="t-nums">${mk("kcal", "Calories", "")}${mk("protein_g", "Protein", "g")}${mk("carbs_g", "Carbs", "g")}${mk("fat_g", "Fat", "g")}</div>
      ${c.floored && !custom ? `<p class="small" style="margin:10px 0 0">Held at ${c.kcal.toLocaleString()}, the usual minimum. A slower pace keeps it above that.</p>` : ""}
      ${custom && Math.abs(sum - n.kcal) > 60 ? `<p class="small muted" style="margin:10px 0 0">Your macros add up to ${Math.round(sum).toLocaleString()} calories.</p>` : ""}
      <button type="button" class="auth-link t-tune" id="t-tune">${custom ? "Use the calculated numbers" : "Fine-tune the numbers"}</button>`;
  };
  body.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const segEl = b.closest(".seg");
    if (segEl && b.dataset.v) {
      segEl.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (segEl.id === "t-sex") f.sex = b.dataset.v;
      if (segEl.id === "t-goal") { f.goal = b.dataset.v; drawPace(); }
      if (!custom) manual = null;
      return draw();
    }
    if (b.dataset.pace) { f.pace_lb_wk = Number(b.dataset.pace); drawPace(); return draw(); }
    if (b.id === "t-tune") {
      custom = !custom;
      if (custom && ready()) { const c = calcTargets(f); manual = { kcal: c.kcal, protein_g: c.protein_g, carbs_g: c.carbs_g, fat_g: c.fat_g }; }
      return draw();
    }
  });
  body.addEventListener("input", (e) => {
    const k = e.target.dataset.m;
    if (k) {
      manual[k] = Math.max(0, Math.round(Number(e.target.value) || 0));
      // Changing a macro updates calories so the numbers stay consistent.
      if (k !== "kcal") { manual.kcal = manual.protein_g * 4 + manual.carbs_g * 4 + manual.fat_g * 9; const kc = $('[data-m="kcal"]', body); if (kc) kc.value = manual.kcal; }
      return;
    }
    draw();
  });
  body.addEventListener("change", (e) => { if (e.target.tagName === "SELECT") draw(); });
  drawPace();
  draw();

  $("#t-save", body).addEventListener("click", async () => {
    read();
    if (!ready()) return toast("Fill in age, weight and height");
    const c = calcTargets(f);
    const n = custom && manual ? manual : c;
    if (!(n.kcal > 0)) return toast("Calories need to be above zero");
    const { error } = await db.from("nutrition_targets").upsert({
      user_id: user.id, sex: f.sex, age: f.age, height_in: f.height_in, weight_lb: f.weight_lb, activity: f.activity,
      goal: f.goal, pace_lb_wk: f.pace_lb_wk, protein_per_lb: f.protein_per_lb, fat_pct: f.fat_pct,
      kcal: n.kcal, protein_g: n.protein_g, carbs_g: n.carbs_g, fat_g: n.fat_g, custom, updated_at: new Date().toISOString(),
    });
    if (error) return toast(error.message);
    closeSheet();
    toast("Targets saved");
    if (tab === "food") renderFood();
  });
}

// ---------------------------------------------------------------------------
// Progress: the week in numbers, weight trend, summaries and patterns
// ---------------------------------------------------------------------------
async function renderProgress() {
  $("#sub").textContent = "Last 7 days";
  const since = new Date(Date.now() - 7 * 24 * 3600e3).toISOString();
  const mon = weekStart();
  const [{ data: obs }, { data: week }, { data: wks }, { data: weights }] = await Promise.all([
    db.from("observations").select("id,kind,title,short,created_at,read_at").order("created_at", { ascending: false }).limit(50),
    db.from("meals").select("name,nutrients,eaten_at,checked_in_at").gte("eaten_at", since),
    db.from("workouts").select("id,completed_at").gte("scheduled_on", ymd(mon)).lte("scheduled_on", ymd(addDays(mon, 6))),
    db.from("weights").select("weight_lb,measured_at").order("measured_at", { ascending: false }).limit(12),
  ]);
  const meals = week ?? [];
  const days = new Set(meals.map((m) => new Date(m.eaten_at).toDateString())).size || 1;
  const t = sumNutrients(meals.map((m) => m.nutrients));
  const planned = (wks ?? []).length;
  const done = (wks ?? []).filter((w) => w.completed_at).length;
  const checkins = meals.filter((m) => m.checked_in_at).length;
  const ws = (weights ?? []).slice().reverse();

  let spark = "";
  if (ws.length >= 2) {
    const vals = ws.map((w) => Number(w.weight_lb));
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 300).toFixed(1)},${(8 + (1 - (v - lo) / span) * 54).toFixed(1)}`).join(" ");
    spark = `<svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none" role="img" aria-label="Weight trend, ${vals[0]} to ${vals[vals.length - 1]} pounds">
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  app.innerHTML = `
    <h3>This week</h3>
    <div class="stat-grid">
      <div class="stat"><b>${planned ? `${done} of ${planned}` : done}</b><span>Workouts done</span></div>
      <div class="stat"><b>${meals.length ? `${r0(t.protein / days)}g` : "–"}</b><span>Avg protein</span></div>
      <div class="stat"><b>${meals.length ? r0(t.kcal / days).toLocaleString() : "–"}</b><span>Avg calories</span></div>
      <div class="stat"><b>${checkins}</b><span>Check-ins</span></div>
    </div>

    <h3>Weight</h3>
    <div class="card">
      ${ws.length ? `<div class="wt-top"><b>${ws[ws.length - 1].weight_lb} lb</b><span class="small muted">${dayFmt.format(new Date(ws[ws.length - 1].measured_at))}</span></div>${spark}` : `<p class="small muted" style="margin-top:0">Optional. Log it whenever you like and the trend shows here.</p>`}
      <form id="wf" class="wt-form"><input class="input" id="wt" type="number" inputmode="decimal" step="0.1" placeholder="lb" aria-label="Weight in pounds" required><button class="btn">Log</button></form>
    </div>

    ${isCoach ? `<h3>Summaries & patterns</h3>
    ${meals.length ? `<button class="btn ghost block" id="gen" style="margin-bottom:10px">Write my summary now</button>` : ""}
    ${(obs ?? []).length ? obs.map((o) => `
      <button class="card obs row ${o.read_at ? "" : "unread"}" data-obs="${o.id}" style="display:block">
        <div class="when">${o.kind === "weekly" ? "Weekly summary" : "Pattern"} · ${dayFmt.format(new Date(o.created_at))}</div>
        <div class="title">${esc(o.title)}</div>
        <div class="small muted">${esc(o.short)}</div>
      </button>`).join("")
    : `<p class="empty">Your first weekly summary arrives Sunday morning. Patterns show up once something repeats a few times in your check-ins.</p>`}` : ""}`;

  $("#wf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await db.from("weights").insert({ weight_lb: Number($("#wt").value) });
    if (error) return toast(error.message);
    toast("Weight logged");
    renderProgress();
  });
  $("#gen")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Writing…";
    try {
      const r = await api("weekly_now");
      if (r.id) openObservation(r.id);
      else toast("Not enough logged yet");
    } catch (err) { toast(err.message); }
    renderProgress();
  });
  app.querySelectorAll("[data-obs]").forEach((b) => b.addEventListener("click", () => openObservation(b.dataset.obs)));
  refreshDot();
}

// ---------------------------------------------------------------------------
// Coach: next call and messages
// ---------------------------------------------------------------------------
async function renderCoach() {
  $("#sub").textContent = "Your coach";
  const [{ data: calls }, { data: msgs }] = await Promise.all([
    db.from("calls").select("*").gte("starts_at", new Date(Date.now() - 3600e3).toISOString()).order("starts_at").limit(1),
    db.from("messages").select("*").order("created_at").limit(300),
  ]);
  const call = (calls ?? [])[0];
  const list = msgs ?? [];
  const live = call && Date.now() >= new Date(call.starts_at).getTime() - 10 * 60e3;

  app.innerHTML = `
    <div class="card call">
      <img src="icons/logo.webp" alt="" width="54" height="54">
      <div class="main">
        <div class="call-title">${call ? `Next call · ${callFmt.format(new Date(call.starts_at))}` : "No call booked"}</div>
        <div class="small muted">${call ? `${esc(call.title)} · ${call.minutes} min` : "Your next check-in call shows up here."}</div>
      </div>
    </div>
    ${call?.join_url ? `<a class="btn ${live ? "primary" : ""} block" href="${esc(call.join_url)}" target="_blank" rel="noopener" style="margin-top:8px;text-decoration:none">${ICO.video}Join call</a>` : ""}
    <h3>Messages</h3>
    <div class="bubbles" id="bubbles">
      ${list.length ? list.map((m) => `<div class="bubble ${m.from_coach ? "them" : "me"}"><div>${esc(m.body)}</div>
        <span>${m.from_coach ? "Coach · " : ""}${when(m.created_at)}</span></div>`).join("")
        : `<p class="empty">Messages with your coach show up here.</p>`}
    </div>
    <form class="composer" id="cmp">
      <input class="input" id="msg" placeholder="Message your coach" aria-label="Message your coach" autocomplete="off">
      <button class="send" aria-label="Send">${ICO.send}</button>
    </form>`;
  document.body.classList.add("has-composer");
  $("#cmp").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = $("#msg").value.trim();
    if (!body) return;
    $("#msg").value = "";
    const { error } = await db.from("messages").insert({ body });
    if (error) return toast(error.message);
    await renderCoach();
    window.scrollTo(0, document.body.scrollHeight);
  });
  const unread = list.filter((m) => m.from_coach && !m.read_at).map((m) => m.id);
  if (unread.length) await db.from("messages").update({ read_at: new Date().toISOString() }).in("id", unread);
  refreshDot();
}

const feelLabel = (list, v) => list.find(([k]) => k === v)?.[1] ?? "";
function feelBadge(m) {
  const bits = [m.energy && feelLabel(ENERGY, m.energy), m.stomach && feelLabel(STOMACH, m.stomach)].filter(Boolean);
  return bits.length ? bits.join(" · ") : "";
}

function checkinCard(m) {
  const chips = (field, list) => list.map(([k, label]) =>
    `<button class="chip" data-field="${field}" data-val="${k}" aria-pressed="${m[field] === k}">${label}</button>`).join("");
  return `
    <div class="card checkin" data-checkin="${m.id}">
      <div class="name" style="font-weight:600">${esc(m.name)}</div>
      <div class="small muted">Eaten ${when(m.eaten_at)}</div>
      <div class="q">Energy</div><div class="chips">${chips("energy", ENERGY)}</div>
      <div class="q">Stomach</div><div class="chips">${chips("stomach", STOMACH)}</div>
    </div>`;
}

function bindCheckins(root, onDone) {
  root.querySelectorAll("[data-checkin]").forEach((card) => {
    card.addEventListener("click", async (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const id = card.dataset.checkin;
      const field = chip.dataset.field;
      card.querySelectorAll(`.chip[data-field="${field}"]`).forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      const done = card.querySelector('.chip[data-field="energy"][aria-pressed="true"]') && card.querySelector('.chip[data-field="stomach"][aria-pressed="true"]');
      const patch = { [field]: chip.dataset.val };
      if (done) patch.checked_in_at = new Date().toISOString();
      const { error } = await db.from("meals").update(patch).eq("id", id);
      if (error) return toast(error.message);
      if (done) { toast("Got it, thanks"); setTimeout(onDone, 500); }
    });
  });
}

async function openMeal(id) {
  const { data: m } = await db.from("meals").select("*").eq("id", id).single();
  if (!m) return;
  const n = m.nutrients;
  const body = openSheet(`
    <h2>${esc(m.name)}</h2>
    <p class="muted small">${when(m.eaten_at)}${m.servings != 1 ? ` · ×${m.servings}` : ""}</p>
    <div class="card totals">
      <div><b>${r0(n.kcal)}</b><span>calories</span></div>
      <div><b>${r0(n.protein)}g</b><span>protein</span></div>
      <div><b>${r0(n.carbs)}g</b><span>carbs</span></div>
      <div><b>${r0(n.fat)}g</b><span>fat</span></div>
    </div>
    <p class="small muted">Saturated fat ${r0(n.sat_fat)}g · fiber ${r0(n.fiber)}g · sodium ${r0(n.sodium)}mg</p>
    ${checkinCard(m)}
    <button class="btn danger block" id="del">Delete this entry</button>`);
  bindCheckins(body, () => { closeSheet(); go(tab); });
  $("#del", body).addEventListener("click", async () => {
    await db.from("meals").delete().eq("id", id);
    closeSheet();
    toast("Deleted");
    go(tab);
  });
}

// ---------------------------------------------------------------------------
// Logging: photo or text -> review -> save to foods + log meal
// ---------------------------------------------------------------------------
for (const id of ["camera", "gallery"]) {
  $(`#${id}`).addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const img = await loadImage(file);
      const full = toJpeg(img, 1024, 0.8);
      const thumb = squareThumb(img);
      const barcode = pendingBarcode;
      pendingBarcode = null;
      analyze({ image: full.split(",")[1], mediaType: "image/jpeg" }, { thumb, source: barcode ? "barcode" : "photo", preview: full, barcode });
    } catch {
      toast("Couldn't read that photo");
    }
  });
}

function openTextLog() {
  const body = openSheet(`
    <h2>What are you eating?</h2>
    <form id="tf">
      <label class="field"><span>Describe it the way you'd say it</span>
        <textarea class="input" id="tx" rows="3" placeholder="e.g. chicken burrito bowl with rice, beans and guac"></textarea></label>
      <button class="btn primary block">Look it up</button>
    </form>
    <p class="small muted" style="margin-top:10px">Prefer a photo? <button class="link" id="pick">Choose from gallery</button></p>`);
  $("#tx", body).focus();
  $("#pick", body).addEventListener("click", () => $("#gallery").click());
  $("#tf", body).addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#tx", body).value.trim();
    if (text) analyze({ text }, { source: "text" });
  });
}

// ---------------------------------------------------------------------------
// Barcode scanning (camera + Chrome's built-in barcode reader, Open Food Facts lookup)
// ---------------------------------------------------------------------------
let scanStream = null;
let scanTimer = null;
function stopScanner() {
  clearTimeout(scanTimer);
  scanTimer = null;
  scanStream?.getTracks().forEach((t) => t.stop());
  scanStream = null;
}

async function openScanner() {
  const supported = "BarcodeDetector" in window;
  const body = openSheet(`
    <h2>Scan a barcode</h2>
    ${supported ? `<div class="scan-box"><video id="cam" playsinline muted></video><div class="scan-line"></div></div>
      <p class="small muted" style="text-align:center">Hold the barcode inside the box.</p>` :
      `<p class="small muted">This browser can't read barcodes from the camera. Type the number under the barcode instead.</p>`}
    <form id="bf" style="display:flex;gap:8px;margin-top:8px">
      <input class="input" id="bc" inputmode="numeric" placeholder="Or type the barcode number" autocomplete="off">
      <button class="btn primary">Look up</button>
    </form>`);
  $("#bf", body).addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#bc", body).value.replace(/\D/g, "");
    if (code.length >= 6) handleBarcode(code);
  });
  if (!supported) return;

  try {
    const formats = (await BarcodeDetector.getSupportedFormats()).filter((f) => ["ean_13", "ean_8", "upc_a", "upc_e"].includes(f));
    const detector = new BarcodeDetector({ formats: formats.length ? formats : undefined });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
    const video = $("#cam", body);
    video.srcObject = scanStream;
    await video.play();
    const tick = async () => {
      if (!scanStream) return;
      try {
        const codes = await detector.detect(video);
        const hit = codes.find((c) => /^\d{6,14}$/.test(c.rawValue));
        if (hit) {
          navigator.vibrate?.(60);
          return handleBarcode(hit.rawValue);
        }
      } catch {}
      scanTimer = setTimeout(tick, 200);
    };
    tick();
  } catch (err) {
    stopScanner();
    const box = $(".scan-box", body);
    if (box) box.outerHTML = `<p class="small muted">Couldn't open the camera${err?.name === "NotAllowedError" ? " (permission was blocked)" : ""}. You can type the number instead.</p>`;
  }
}

async function handleBarcode(code) {
  stopScanner();
  // Already in My foods? Then it's one tap.
  const { data: known } = await db.from("foods").select("*").eq("barcode", code).limit(1);
  if (known?.length) return openFood(known[0]);

  openSheet(`<div class="spinner"></div><p class="muted" style="text-align:center">Looking up ${esc(code)}…</p>`);
  try {
    const result = await api("barcode", { code });
    if (result.error) {
      const body = openSheet(`
        <h2>${result.error === "no_nutrition" ? "No nutrition info for that one" : "Not in the database yet"}</h2>
        <p class="muted">Snap the Nutrition Facts label instead and I'll read the numbers off it.</p>
        <button class="btn primary block" id="lbl">Snap the label</button>
        <button class="btn ghost block" id="again" style="margin-top:8px">Scan again</button>`);
      $("#lbl", body).addEventListener("click", () => { pendingBarcode = code; $("#camera").click(); });
      $("#again", body).addEventListener("click", openScanner);
      return;
    }
    review(result, { source: "barcode", barcode: code, thumb: result.image ?? null });
  } catch (err) {
    const body = openSheet(`<h2>That didn't work</h2><p class="muted small">${esc(err.message)}</p>
      <button class="btn primary block" id="retry">Try again</button>`);
    $("#retry", body).addEventListener("click", () => handleBarcode(code));
  }
}
// When a barcode isn't found and you snap the label, remember the code so the next scan is instant.
let pendingBarcode = null;

async function analyze(payload, meta) {
  openSheet(`
    ${meta.preview ? `<img class="preview" src="${meta.preview}" alt="">` : ""}
    <div class="spinner"></div>
    <p class="muted" style="text-align:center">Looking at your food…</p>`);
  try {
    const result = await api("analyze", payload);
    if (result.error === "no_food") {
      openSheet(`<h2>No food found</h2><p class="muted">I couldn't spot any food there. Try another photo, or type it instead.</p>
        <button class="btn primary block" data-close>OK</button>`);
      return;
    }
    review(result, meta);
  } catch (err) {
    const body = openSheet(`<h2>That didn't work</h2><p class="muted small">${esc(err.message)}</p>
      <button class="btn primary block" id="retry">Try again</button>`);
    $("#retry", body).addEventListener("click", () => analyze(payload, meta));
  }
}

function review(result, meta) {
  const items = result.items.map((it) => ({ ...it }));
  let servings = 1;
  const body = openSheet(`
    ${meta.preview ? `<img class="preview" src="${meta.preview}" alt="">` : ""}
    <label class="field"><span>Name</span><input class="input" id="nm" value="${esc(result.name)}"></label>
    <h3>What's in it <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· edit grams if the portion looks off</span></h3>
    <div class="card" id="items"></div>
    ${result.note ? `<p class="small muted">${esc(result.note)}</p>` : ""}
    <div class="field"><span class="muted small">Servings</span>
      <div class="seg" id="sv">${[0.5, 1, 1.5, 2].map((v) => `<button data-v="${v}" aria-pressed="${v === 1}">${v === 0.5 ? "½" : v === 1.5 ? "1½" : v}</button>`).join("")}</div></div>
    <label class="field"><span>When</span><input class="input" id="at" type="datetime-local" value="${localInputValue()}"></label>
    <div class="card totals" id="tot"></div>
    <button class="btn primary block" id="save">Save & log it</button>
    <p class="small muted" style="text-align:center;margin-top:8px">It'll be saved to My foods for one-tap logging next time.</p>`);

  const draw = () => {
    $("#items", body).innerHTML = items.length
      ? items.map((it, i) => `
        <div class="item">
          <div><div class="nm">${esc(it.name)}${it.source === "estimate" ? '<span class="badge">estimate</span>' : it.source === "label" ? '<span class="badge">label</span>' : ""}</div>
            <div class="pt">${esc(it.portion)} · ${r0(it.nutrients.kcal)} cal</div></div>
          <label><input class="input" type="number" inputmode="numeric" min="1" data-i="${i}" value="${it.grams}"> <span class="small muted">g</span></label>
          <button class="x" data-rm="${i}" aria-label="Remove">×</button>
        </div>`).join("")
      : `<p class="muted small">No items left.</p>`;
    const t = scale(sumNutrients(items.map((i) => i.nutrients)), servings);
    $("#tot", body).innerHTML = `
      <div><b>${r0(t.kcal)}</b><span>calories</span></div>
      <div><b>${r0(t.protein)}g</b><span>protein</span></div>
      <div><b>${r0(t.carbs)}g</b><span>carbs</span></div>
      <div><b>${r0(t.fat)}g</b><span>fat</span></div>`;
  };
  draw();

  $("#items", body).addEventListener("change", (e) => {
    const i = e.target.dataset.i;
    if (i === undefined) return;
    const g = Math.max(1, Number(e.target.value) || 1);
    const it = items[i];
    it.grams = g;
    it.nutrients = Object.fromEntries(KEYS.map((k) => [k, (it.per_gram?.[k] ?? 0) * g]));
    draw();
  });
  $("#items", body).addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (!rm) return;
    items.splice(Number(rm.dataset.rm), 1);
    draw();
  });
  $("#sv", body).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    servings = Number(b.dataset.v);
    $("#sv", body).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  });

  $("#save", body).addEventListener("click", async () => {
    if (!items.length) return toast("Nothing to save");
    $("#save", body).disabled = true;
    const perServing = sumNutrients(items.map((i) => i.nutrients));
    const name = $("#nm", body).value.trim() || result.name;
    const { data: food, error } = await db.from("foods").insert({
      name,
      portion_label: items.map((i) => i.portion).join(", "),
      components: items.map(({ name, portion, grams, nutrients, per_gram, source }) => ({ name, portion, grams, nutrients, per_gram, source })),
      nutrients: perServing,
      tags: result.tags ?? [],
      thumb: meta.thumb ?? null,
      source: meta.source,
      barcode: meta.barcode ?? null,
    }).select().single();
    if (error) { $("#save", body).disabled = false; return toast(error.message); }
    await logFood(food, servings, new Date($("#at", body).value || Date.now()));
  });
}

async function logFood(food, servings, eatenAt) {
  const { error } = await db.from("meals").insert({
    food_id: food.id,
    name: food.name,
    servings,
    nutrients: scale(food.nutrients, servings),
    tags: food.tags ?? [],
    eaten_at: eatenAt.toISOString(),
  });
  if (error) return toast(error.message);
  await db.from("foods").update({ times_logged: (food.times_logged ?? 0) + 1, last_logged_at: new Date().toISOString() }).eq("id", food.id);
  closeSheet();
  const due = new Date(eatenAt.getTime() + 2 * 3600e3);
  toast(due > new Date() ? `Logged. I'll check in around ${timeFmt.format(due)}.` : "Logged");
  foodSeg = "today";
  go("food");
}

// ---------------------------------------------------------------------------
// My foods
// ---------------------------------------------------------------------------
async function renderFoods(prefix = "") {
  $("#sub").textContent = "Tap one to log it again";
  const { data: foods } = await db.from("foods").select("id,name,nutrients,thumb,times_logged,last_logged_at,tags,portion_label")
    .order("last_logged_at", { ascending: false, nullsFirst: false });
  const list = foods ?? [];
  app.innerHTML = prefix + (list.length
    ? `<label class="search" style="margin-top:12px"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm5-2 4 4"/></svg>
        <input id="q" type="search" placeholder="Search my foods" autocomplete="off"></label>
       <div class="card"><ul class="list" id="fl"></ul></div>`
    : `<p class="empty">Your foods list fills up as you log.<br>Snap or type your first meal under Today.</p>`);
  if (!list.length) return;

  const draw = (q = "") => {
    const ql = q.toLowerCase();
    const shown = list.filter((f) => f.name.toLowerCase().includes(ql));
    $("#fl").innerHTML = shown.map((f) => `
      <li><button class="row" data-food="${f.id}">
        <div class="thumb" ${f.thumb ? `style="background-image:url('${f.thumb}')"` : ""}>${f.thumb ? "" : "🍽"}</div>
        <div class="main"><div class="name">${esc(f.name)}</div><div class="meta">${macroLine(f.nutrients)}</div></div>
        <div class="end">${f.times_logged ? `×${f.times_logged}` : ""}</div>
      </button></li>`).join("") || `<p class="muted small">No matches.</p>`;
  };
  draw();
  $("#q").addEventListener("input", (e) => draw(e.target.value));
  $("#fl").addEventListener("click", (e) => {
    const b = e.target.closest("[data-food]");
    if (b) openFood(list.find((f) => f.id === b.dataset.food));
  });
}

function openFood(food) {
  let servings = 1;
  const body = openSheet(`
    <h2>${esc(food.name)}</h2>
    <p class="muted small">${esc(food.portion_label || "")}</p>
    <div class="field"><span class="muted small">Servings</span>
      <div class="seg" id="sv">${[0.5, 1, 1.5, 2].map((v) => `<button data-v="${v}" aria-pressed="${v === 1}">${v === 0.5 ? "½" : v === 1.5 ? "1½" : v}</button>`).join("")}</div></div>
    <label class="field"><span>When</span><input class="input" id="at" type="datetime-local" value="${localInputValue()}"></label>
    <div class="card totals" id="tot"></div>
    <button class="btn primary block" id="log">Log it</button>
    <button class="btn danger block" id="rm" style="margin-top:10px">Remove from My foods</button>`);
  const draw = () => {
    const t = scale(food.nutrients, servings);
    $("#tot", body).innerHTML = `
      <div><b>${r0(t.kcal)}</b><span>calories</span></div><div><b>${r0(t.protein)}g</b><span>protein</span></div>
      <div><b>${r0(t.carbs)}g</b><span>carbs</span></div><div><b>${r0(t.fat)}g</b><span>fat</span></div>`;
  };
  draw();
  $("#sv", body).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    servings = Number(b.dataset.v);
    $("#sv", body).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  });
  $("#log", body).addEventListener("click", () => logFood(food, servings, new Date($("#at", body).value || Date.now())));
  $("#rm", body).addEventListener("click", async () => {
    await db.from("foods").delete().eq("id", food.id);
    closeSheet();
    toast("Removed");
    renderFood();
  });
}

async function openObservation(id) {
  const { data: o } = await db.from("observations").select("*").eq("id", id).single();
  if (!o) return;
  if (!o.read_at) { await db.from("observations").update({ read_at: new Date().toISOString() }).eq("id", id); refreshDot(); }
  const b = o.body || {};
  const list = (v) => Array.isArray(v) ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p>${esc(v)}</p>`;
  let html = `<div class="detail"><p class="muted small">${o.kind === "weekly" ? "Weekly summary" : "Pattern spotted"} · ${dayFmt.format(new Date(o.created_at))}</p><h2>${esc(o.title)}</h2>`;
  if (o.kind === "weekly") {
    html += `
      <h3>What you're eating</h3>${list(b.eating)}
      <h3>What's pushing cholesterol up</h3>${list(b.cholesterol_up)}
      <h3>What to have less of</h3>${list(b.less_of)}
      ${b.feelings ? `<h3>How you felt</h3>${list(b.feelings)}` : ""}
      ${b.weight ? `<h3>Weight</h3>${list(b.weight)}` : ""}
      ${b.stats ? `<p class="small muted" style="margin-top:18px">${b.stats.meals} meals over ${b.stats.days} days · about ${b.stats.per_day?.kcal ?? "?"} cal and ${b.stats.per_day?.protein ?? "?"}g protein a day · saturated fat ≈ ${b.stats.sat_pct}% of calories</p>` : ""}`;
  } else {
    html += `
      <h3>The pattern</h3><p>${esc(b.pattern)}${b.stat ? ` <span class="muted">(${esc(b.stat)})</span>` : ""}</p>
      <h3>The evidence</h3><ul class="evidence">${(o.evidence || []).map((e) => `<li>${esc(e.when)}: ${esc(e.name)} — energy ${esc(e.energy ? feelLabel(ENERGY, e.energy) : "–")}, stomach ${esc(e.stomach ? feelLabel(STOMACH, e.stomach) : "–")}</li>`).join("")}</ul>
      <h3>Likely why</h3><p>${esc(b.why)}</p>
      <h3>What to watch</h3><p>${esc(b.watch)}</p>`;
  }
  html += `</div>`;
  openSheet(html);
}

async function refreshDot() {
  const [{ count }, { count: msgs }] = await Promise.all([
    db.from("observations").select("id", { count: "exact", head: true }).is("read_at", null),
    db.from("messages").select("id", { count: "exact", head: true }).eq("from_coach", true).is("read_at", null),
  ]);
  $('#tabs [data-tab="progress"] .dot').hidden = !count;
  $('#tabs [data-tab="coach"] .dot').hidden = !msgs;
}

// ---------------------------------------------------------------------------
// Settings: notifications, lab results, sign out
// ---------------------------------------------------------------------------
async function renderSettings() {
  $("#sub").textContent = "Settings";
  const { data: labs } = isCoach ? await db.from("labs").select("*").order("taken_on", { ascending: false }).limit(10) : { data: [] };
  const pushState = await pushStatus();

  app.innerHTML = `
    <p class="small muted" style="margin:6px 2px 0">${esc(user?.email ?? "")}</p>
    ${isCoach ? `<h3>Coach</h3>
    <div class="card coach-entry"><div class="main"><b>Coach mode</b><div class="small muted">Dashboard and exercise Library. Best on your laptop.</div></div>
      <button class="btn primary" id="coach-open">Open</button></div>` : ""}
    <h3>Notifications</h3>
    <div class="card">
      <p class="small" style="margin-top:0">${isCoach ? "Check-ins about 2 hours after you eat (not between 10pm and 8am), patterns when they show up, and your Sunday summary." : "Check-ins about 2 hours after you eat (not between 10pm and 8am)."}</p>
      ${pushState === "unsupported" ? `<p class="small muted">This browser can't receive notifications. Install the app to your home screen from Chrome first.</p>`
        : pushState === "denied" ? `<p class="small muted">Notifications are blocked. Allow them in your browser's site settings for this app.</p>`
        : pushState === "on" ? `<p class="small" style="color:var(--good)">On for this device.</p><button class="btn ghost block" id="test">Send a test</button>`
        : `<button class="btn primary block" id="push">Turn on notifications</button>`}
    </div>

    ${isCoach ? `<h3>Lab results</h3>
    <div class="card">
      <form id="lf">
        <label class="field"><span>Test date</span><input class="input" id="ld" type="date" required value="${ymd()}"></label>
        <div class="grid4">
          <label class="field"><span>LDL</span><input class="input" id="l-ldl" type="number" inputmode="numeric"></label>
          <label class="field"><span>HDL</span><input class="input" id="l-hdl" type="number" inputmode="numeric"></label>
          <label class="field"><span>Trig.</span><input class="input" id="l-tg" type="number" inputmode="numeric"></label>
          <label class="field"><span>Total</span><input class="input" id="l-tc" type="number" inputmode="numeric"></label>
        </div>
        <button class="btn primary block">Save results</button>
      </form>
      ${(labs ?? []).length ? `<ul class="list" style="margin-top:10px">${labs.map((l) => `
        <li class="row" style="cursor:default"><div class="main"><div class="name">LDL ${l.ldl ?? "–"} · HDL ${l.hdl ?? "–"}</div>
        <div class="meta">Triglycerides ${l.triglycerides ?? "–"} · total ${l.total_chol ?? "–"}</div></div>
        <div class="end">${dayFmt.format(new Date(l.taken_on + "T12:00"))}</div></li>`).join("")}</ul>` : ""}
    </div>` : ""}

    <button class="btn ghost block" id="out" style="margin-top:18px">Sign out</button>
  `;
  $("#coach-open")?.addEventListener("click", () => openCoachMode());
  $("#push")?.addEventListener("click", enablePush);
  $("#test")?.addEventListener("click", async () => {
    try { const r = await api("test_push"); toast(r.sent ? "Sent. It should pop up in a moment." : "No devices subscribed yet"); }
    catch (e) { toast(e.message); }
  });
  $("#lf")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (id) => ($(id).value === "" ? null : Number($(id).value));
    const row = { taken_on: $("#ld").value, ldl: v("#l-ldl"), hdl: v("#l-hdl"), triglycerides: v("#l-tg"), total_chol: v("#l-tc") };
    if ([row.ldl, row.hdl, row.triglycerides, row.total_chol].every((x) => x === null)) return toast("Enter at least one number");
    const { error } = await db.from("labs").insert(row);
    if (error) return toast(error.message);
    toast("Results saved");
    renderSettings();
  });
  $("#out").addEventListener("click", () => db.auth.signOut());
}

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------
function b64ToBytes(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}
async function pushStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}
async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifications not allowed"); return renderSettings(); }
    const { publicKey } = await api("vapid");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    const j = sub.toJSON();
    const { error } = await db.rpc("save_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error) throw error;
    toast("Notifications are on");
  } catch (e) {
    toast(e.message || "Couldn't turn on notifications");
  }
  renderSettings();
}

// ---------------------------------------------------------------------------
// Install prompt (Android Chrome)
// ---------------------------------------------------------------------------
let deferredInstall = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; showInstallBar(); });
function showInstallBar() {
  const slot = $("#install-slot");
  if (!slot || !deferredInstall || standalone()) return;
  try { if (localStorage.getItem("psh-install-x")) return; } catch {}
  slot.innerHTML = `<div class="install-bar"><span><b>Install BraticaFit</b>Logging and check-ins from your home screen</span>
    <button class="btn primary" id="inst">Install</button><button class="x" id="inst-x" aria-label="Not now">×</button></div>`;
  $("#inst").addEventListener("click", async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; slot.innerHTML = ""; });
  $("#inst-x").addEventListener("click", () => { try { localStorage.setItem("psh-install-x", "1"); } catch {} slot.innerHTML = ""; });
}

// ---------------------------------------------------------------------------
// Deep links from notifications: #checkin=<meal id>, #obs=<observation id>
// ---------------------------------------------------------------------------
async function handleHash() {
  const h = location.hash.slice(1);
  if (/^coach(=\w+)?$/.test(h) && user && isCoach) {
    history.replaceState(null, "", location.pathname + location.search);
    await go(tab); openCoachMode(h.split("=")[1]); return true;
  }
  if (!h || !user || !/^(checkin|obs)=/.test(h)) return false;
  history.replaceState(null, "", location.pathname + location.search);
  const [k, v] = h.split("=");
  if (k === "checkin" && v) { tab = "today"; markTab(); await renderHome(v); return true; }
  if (k === "obs" && v) { tab = "progress"; markTab(); await renderProgress(); openObservation(v); return true; }
  return false;
}
// Coach mode lives in coach.js and is only fetched for the coach's account.
async function openCoachMode(view) {
  if (!isCoach) return;
  try {
    const m = await import("./coach.js?v=5");
    await m.openCoach({ db, user, esc, toast, ymd, api, view, exit: () => go(tab) });
  } catch (e) { toast("Couldn't open coach mode"); console.error(e); }
}
function markTab() {
  for (const b of document.querySelectorAll("#tabs button")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", handleHash);
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type === "open" && e.data.url) { location.hash = new URL(e.data.url, location.href).hash; }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function enter(session) {
  user = session?.user ?? null;
  if (!user) return renderSignIn();
  document.body.classList.remove("signin");
  const { data: role, error } = await db.rpc("join_app");
  if (error || !role) {
    isCoach = false;
    $("#tabs").hidden = true;
    $("#settings").hidden = true;
    app.innerHTML = `<p class="empty">${esc(user.email ?? "This account")} doesn't have access yet. If you're a BraticaFit client, ask Andrew to add this email.</p><button class="btn ghost block" id="out">Sign out</button>`;
    $("#out").addEventListener("click", () => db.auth.signOut());
    return;
  }
  isCoach = role === "coach";
  claimThisDevice();
  $("#tabs").hidden = false;
  $("#settings").hidden = false;
  if (!(await handleHash())) await go(tab);
  refreshDot();
}

// If this device already gets notifications, point them at whoever is signed in now.
async function claimThisDevice() {
  try {
    if (!("serviceWorker" in navigator) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const j = sub.toJSON();
    await db.rpc("save_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  } catch {}
}

let lastUserId;
db.auth.onAuthStateChange((event, session) => {
  const id = session?.user?.id ?? null;
  if (id === lastUserId && event !== "SIGNED_OUT") return;
  lastUserId = id;
  setTimeout(() => enter(session), 0);
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && user && tab === "today" && $("#sheet").hidden) renderHome();
});
