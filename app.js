import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { openCall, callBack } from "./call.js?v=1";

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
// Switches the coach sets per client (Settings on their client page). The coach always gets everything.
let features = { food: true, weight: true, targets_edit: true, move_days: true };

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
// Phone Back button: close whatever is on top (video, panel, coach mode, workout, day, tab)
// instead of leaving the app. One spare history entry catches each Back press.
// ---------------------------------------------------------------------------
function armBack() { if (!history.state?.bfGuard) history.pushState({ bfGuard: true }, ""); }
function backOne() {
  if (viewerOpen) { closeViewer(); return true; }
  if (callBack(toast)) return true;
  if (!$("#sheet").hidden) { closeSheet(); return true; }
  const ev = new CustomEvent("bf-back", { cancelable: true });   // coach mode and its overlays
  window.dispatchEvent(ev);
  if (ev.defaultPrevented) return true;
  if (document.getElementById("iv")) return false;                // interval timer: has its own controls
  if (sessionBack) { stopRest(); go(sessionBack, true); return true; }
  if (tab === "food" && foodDay) { foodDay = null; renderFood(); return true; }
  if (tabTrail.length) { go(tabTrail.pop(), true); return true; }
  return false;
}
window.addEventListener("popstate", () => {
  if (!user) return;
  if (backOne()) armBack();
  else history.back();   // nothing left to close: leave the app as normal
});

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
  // Remove any video or audio so it stops playing (hiding the sheet alone leaves it running).
  $("#sheet-body").querySelectorAll("iframe, video, audio").forEach((el) => el.remove());
  $("#sheet").hidden = true;
  document.body.style.overflow = "";
}
$("#sheet").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });

// ---------------------------------------------------------------------------
// Sign in (email + password; "Forgot password?" emails a 6-digit code, then they make a new one)
// ---------------------------------------------------------------------------
// The welcome email links to ?setup=<token>: the Create password screen.
let setupToken = new URLSearchParams(location.search).get("setup");
// What to show right after signing in: "install" (add to home screen) or "newpw" (make a new password).
let afterSignIn = null;
function dropSetupFromUrl() {
  setupToken = null;
  const p = new URLSearchParams(location.search); p.delete("setup"); p.delete("email");
  history.replaceState(null, "", location.pathname + (p.toString() ? `?${p}` : "") + location.hash);
}

// Sign-in screens look the same for everyone (Clarity), with no tabs.
function authShell() {
  document.documentElement.dataset.theme = "clarity";  // not saved as their look
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = "#F9F9F8";
  const mk = document.querySelector(".wordmark"); if (mk) mk.src = "icons/wordmark-clarity.webp";
  $("#tabs").hidden = true;
  $("#settings").hidden = true;
  document.body.classList.add("signin");
}
const AUTH_LOGO = `<img class="auth-logo wide" src="icons/wordmark-clarity.webp" alt="BraticaFit" width="300" height="53">`;
const MIN_PW = 8;
// Password box with a Show/Hide button (easier than typing it twice).
const pwField = (id, autocomplete, placeholder = "") => `<div class="auth-pw">
    <input class="auth-input" id="${id}" type="password" autocomplete="${autocomplete}" placeholder="${placeholder}" required>
    <button type="button" class="auth-eye" data-eye="${id}">Show</button></div>`;
function wireEyes(root = app) {
  root.querySelectorAll("[data-eye]").forEach((b) => b.addEventListener("click", () => {
    const i = $("#" + b.dataset.eye); const show = i.type === "password";
    i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show";
  }));
}
// signInWithPassword / verifyOtp fire onAuthStateChange, which calls enter(). If the same account
// was already signed in on this browser it doesn't, so call enter() ourselves.
function enterAfter(prevId, session) {
  if (session?.user?.id === prevId) enter(session);
}

// Create password (from the welcome email link)
async function renderSetup() {
  authShell();
  const token = setupToken;
  app.innerHTML = `<div class="auth">${AUTH_LOGO}<p class="auth-sub">Loading…</p></div>`;
  let info;
  try { info = await api("setup_info", { token }); } catch { info = { status: "error" }; }
  const toSignIn = (email) => { dropSetupFromUrl(); renderSignIn(email); };
  if (info.status !== "ok") {
    const msg = {
      used: ["You already have a password", "Sign in with your email and password. Forgot it? Tap Forgot password on the next screen."],
      expired: ["This link expired", "No problem. On the next screen, enter your email and tap Forgot password to make one."],
    }[info.status] ?? ["This link doesn't work", "On the next screen, enter your email and tap Forgot password to make a password."];
    app.innerHTML = `<div class="auth">${AUTH_LOGO}<div class="auth-form">
        <p class="auth-head">${msg[0]}</p><p class="auth-sub">${msg[1]}</p>
        <button class="auth-btn" id="go-in">Go to sign in</button></div></div>`;
    $("#go-in").addEventListener("click", () => toSignIn(info.email));
    return;
  }
  app.innerHTML = `<div class="auth">${AUTH_LOGO}
    <form id="f-setup" class="auth-form">
      <p class="auth-head">Create your password</p>
      <p class="auth-sub">You'll use it with your email to sign in.</p>
      <label class="auth-label" for="su-email">Email</label>
      <input class="auth-input auth-locked" id="su-email" type="email" autocomplete="username" value="${esc(info.email)}" readonly>
      <label class="auth-label" for="su-pw" style="margin-top:14px">Password</label>
      ${pwField("su-pw", "new-password")}
      <p class="auth-fine" style="margin:8px 0 0">At least ${MIN_PW} characters.</p>
      <button class="auth-btn">Create password</button>
    </form></div>`;
  wireEyes();
  $("#su-pw").focus();
  $("#f-setup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = $("#su-pw").value;
    if (password.length < MIN_PW) return toast(`Use at least ${MIN_PW} characters`);
    const b = $("#f-setup .auth-btn"); b.disabled = true; b.textContent = "Saving…";
    try {
      await api("set_password", { token, password });
      dropSetupFromUrl();
      afterSignIn = "install";
      const prev = lastUserId;
      const { data, error } = await db.auth.signInWithPassword({ email: info.email, password });
      if (error) throw error;
      enterAfter(prev, data.session);
    } catch (err) {
      afterSignIn = null;
      b.disabled = false; b.textContent = "Create password";
      toast(err.message);
    }
  });
}

function renderSignIn(presetEmail) {
  authShell();
  const preset = presetEmail || new URLSearchParams(location.search).get("email") || "";
  app.innerHTML = `
    <div class="auth">
      ${AUTH_LOGO}
      <form id="f-pw" class="auth-form">
        <p class="auth-head">Sign in</p>
        ${iosInstallTip()}
        ${linkError ? `<p class="auth-msg">That sign-in link expired or was already used. Sign in below, or tap Forgot password.</p>`
          : `<p class="auth-sub">Use the email Andrew added you with.</p>`}
        <label class="auth-label" for="email">Email</label>
        <input class="auth-input" id="email" type="email" autocomplete="username" placeholder="you@email.com" required value="${esc(preset)}">
        <label class="auth-label" for="pw" style="margin-top:14px">Password</label>
        ${pwField("pw", "current-password")}
        <button class="auth-btn">Sign in</button>
        <p class="auth-fine" style="margin-top:14px;text-align:center"><button type="button" class="auth-link" id="forgot">Forgot password?</button></p>
      </form>
      <form id="sent" class="auth-form" hidden>
        <p class="auth-head">Check your email</p>
        <p class="auth-sub">Enter the 6-digit code sent to <span id="sent-email"></span>. Then you'll make a new password.</p>
        <label class="auth-label" for="code">Code</label>
        <input class="auth-input auth-code" id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="8" placeholder="123456" required>
        <button class="auth-btn">Continue</button>
        <p class="auth-fine" style="margin-top:14px">Didn't get it? Check spam, or <button type="button" class="auth-link" id="resend">send a new code</button>.
          <br><button type="button" class="auth-link" id="sent-back">Back to sign in</button></p>
      </form>
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
        <p>Andrew will get your request. Once he adds you, you'll get a welcome email to create your password.</p>
      </div>
    </div>`;
  wireEyes();
  const show = (id) => { for (const k of ["f-pw", "sent", "f-req", "req-done"]) $("#" + k).hidden = k !== id; };
  const email = () => $("#email").value.trim().toLowerCase();
  const busy = (form, on, label) => { const b = $(`#${form} .auth-btn`); b.disabled = on; if (label) b.textContent = label; };
  (preset ? $("#pw") : $("#email")).focus();

  $("#f-pw").addEventListener("submit", async (e) => {
    e.preventDefault();
    busy("f-pw", true, "Signing in…");
    const { error } = await db.auth.signInWithPassword({ email: email(), password: $("#pw").value });
    if (error) {
      busy("f-pw", false, "Sign in");
      return toast(/invalid/i.test(error.message) ? "Wrong email or password. Try again, or tap Forgot password." : error.message, 4000);
    }
    // onAuthStateChange takes it from here.
  });

  // Forgot password: email a 6-digit code (works inside the iPhone home-screen app), then make a new password.
  const send = async () => {
    try {
      const r = await api("send_link", { email: email() });
      if (r.allowed === false) {
        $("#req-email").textContent = email();
        show("f-req");
        $("#req-name").focus();
      } else {
        $("#sent-email").textContent = email();
        show("sent");
        $("#code").value = "";
        $("#code").focus();
      }
      return true;
    } catch (e) { toast(e.message); return false; }
  };
  $("#forgot").addEventListener("click", async (e) => {
    if (!$("#email").checkValidity() || !email()) { toast("Enter your email first"); return $("#email").focus(); }
    e.target.disabled = true;
    await send();
    e.target.disabled = false;
  });
  $("#resend").addEventListener("click", async () => { if (await send()) toast("New code sent"); });
  $("#sent-back").addEventListener("click", () => { show("f-pw"); $("#pw").focus(); });
  $("#sent").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = $("#code").value.replace(/\D/g, "");
    if (token.length < 6) return toast("Enter the 6-digit code");
    busy("sent", true, "Checking…");
    afterSignIn = "newpw";
    const { error } = await db.auth.verifyOtp({ email: email(), token, type: "email" });
    if (error) {
      afterSignIn = null;
      busy("sent", false, "Continue");
      return toast(/expired|invalid/i.test(error.message) ? "That code didn't work. Check it, or send a new one." : error.message);
    }
    // onAuthStateChange takes it from here.
  });
  // Pasting or auto-filling the whole code continues right away.
  $("#code").addEventListener("input", (e) => { if (e.target.value.replace(/\D/g, "").length === 6) $("#sent").requestSubmit(); });
  $("#req-back").addEventListener("click", () => { show("f-pw"); $("#email").focus(); });
  $("#f-req").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#req-name").value.trim();
    if (name.split(/\s+/).length < 2) return toast("Add your first and last name");
    busy("f-req", true, "Sending…");
    try {
      const r = await api("request_access", { email: email(), name, note: $("#req-note").value });
      if (r.allowed) { busy("f-req", false, "Request access"); return send(); }
      show("req-done");
    } catch (err) { toast(err.message); }
    busy("f-req", false, "Request access");
  });
}

// After "Forgot password?": signed in with the code, now make a new password.
function renderNewPassword(session) {
  authShell();
  const mail = session.user.email ?? "";
  app.innerHTML = `<div class="auth">${AUTH_LOGO}
    <form id="f-newpw" class="auth-form">
      <p class="auth-head">Make a new password</p>
      <p class="auth-sub">For <span>${esc(mail)}</span>. Use it with your email next time you sign in.</p>
      <input type="email" autocomplete="username" value="${esc(mail)}" hidden readonly>
      <label class="auth-label" for="np-pw">New password</label>
      ${pwField("np-pw", "new-password")}
      <p class="auth-fine" style="margin:8px 0 0">At least ${MIN_PW} characters.</p>
      <button class="auth-btn">Save password</button>
      <p class="auth-fine" style="margin-top:14px;text-align:center"><button type="button" class="auth-link" id="np-skip">Skip for now</button></p>
    </form></div>`;
  wireEyes();
  $("#np-pw").focus();
  const done = () => { afterSignIn = "install"; enter(session); };
  $("#np-skip").addEventListener("click", done);
  $("#f-newpw").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = $("#np-pw").value;
    if (password.length < MIN_PW) return toast(`Use at least ${MIN_PW} characters`);
    const b = $("#f-newpw .auth-btn"); b.disabled = true; b.textContent = "Saving…";
    const { error } = await db.auth.updateUser({ password });
    if (error && !/different from the old/i.test(error.message)) {
      b.disabled = false; b.textContent = "Save password";
      return toast(/weak|pwned|known/i.test(error.message) ? "That password is too easy to guess. Try another." : error.message);
    }
    toast("Password saved");
    done();
  });
}

// Right after making a password on a phone browser: how to put the app on the home screen.
// On iPhone the home-screen app has its own sign-in, separate from Safari, so they sign in there once.
const installStepNeeded = () => !standalone() && (isIOS() || (deferredInstall && /Android/i.test(navigator.userAgent)));
function renderInstallStep(session) {
  authShell();
  const mail = esc(session.user.email ?? "");
  const later = `<p class="auth-fine" style="margin-top:16px;text-align:center"><button type="button" class="auth-link" id="inst-later">Keep using it in the browser for now</button></p>`;
  if (isIOS()) {
    app.innerHTML = `<div class="auth">${AUTH_LOGO}<div class="auth-form">
      <p class="auth-head">You're all set. Last step:</p>
      <p class="auth-sub">Add BraticaFit to your home screen so it opens like an app.</p>
      <ol class="auth-steps">
        <li>Tap the Share button ${SHARE_I} at the bottom of the screen.
          <span class="auth-fine">Don't see it? Tap the compass or <b>Open in Safari</b> first.</span></li>
        <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
        <li>Open BraticaFit from your home screen and sign in with <b>${mail}</b> and your new password.</li>
      </ol>
      ${later}</div></div>`;
  } else {
    app.innerHTML = `<div class="auth">${AUTH_LOGO}<div class="auth-form">
      <p class="auth-head">You're all set. Last step:</p>
      <p class="auth-sub">Install BraticaFit so it opens like an app from your home screen. You'll stay signed in.</p>
      <button class="auth-btn" id="inst-go">Install the app</button>
      ${later}</div></div>`;
    $("#inst-go").addEventListener("click", async () => {
      if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; }
      enter(session);
    });
  }
  $("#inst-later").addEventListener("click", () => enter(session));
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
const VIEWS = { today: renderHome, train: renderTrain, food: renderFood, progress: renderProgress, coach: renderCoach, settings: renderSettings };
let tabTrail = [], sessionBack = null;  // for the phone's Back button
function go(next, fromBack = false) {
  if (next === "food" && !features.food) next = "today";
  if (!fromBack && next !== tab && user) { tabTrail.push(tab); if (tabTrail.length > 20) tabTrail.shift(); }
  sessionBack = null;
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
const longDayFmt = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });
const wdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const callFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

const FEEL = [["easy", "Easy"], ["solid", "Solid"], ["tough", "Tough"], ["rough", "Rough"]];

// Video ids: plain 11-char ids are YouTube; "vm:<number>" is a Vimeo video (Precision Nutrition demos).
const isVm = (id) => String(id || "").startsWith("vm:");
function vmId(s) {
  const m = String(s || "").match(/vimeo\.com\/(?:video\/)?(\d{6,})/);
  return m ? "vm:" + m[1] : null;
}
function ytId(s) {
  if (!s) return null;
  if (isVm(s)) return String(s);
  const vm = vmId(s); if (vm) return vm;
  const m = String(s).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(String(s).trim()) ? String(s).trim() : null;
}
const ytThumb = (id) => (isVm(id) ? `https://vumbnail.com/${id.slice(3)}.jpg` : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
const embedSrc = (id, start = 0, autoplay = false) => (isVm(id)
  ? `https://player.vimeo.com/video/${id.slice(3)}?dnt=1&playsinline=1&title=0&byline=0&portrait=0${autoplay ? "&autoplay=1" : ""}${start ? `#t=${start}s` : ""}`
  : `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1${autoplay ? "&autoplay=1" : ""}${start ? `&start=${start}` : ""}`);
// "Watch on your TV": open the video on YouTube, whose cast button reaches Chromecast,
// smart TVs with YouTube, and AirPlay TVs.
const TV_I = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="vertical-align:-4px;margin-right:6px"><rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const tvButton = (id) => (!id || isVm(id) ? "" : `<button class="btn ghost block" data-tv="${esc(id)}" style="margin-top:10px">${TV_I}Watch on your TV</button>
  <p class="small muted" style="margin:6px 2px 0">Opens YouTube. Tap the cast icon on the video and pick your TV. Works best with the YouTube app.</p>`);
function openOnTv(id) {
  // A plain youtube.com link: opens the YouTube app when it's installed, otherwise YouTube in the browser.
  window.open(`https://www.youtube.com/watch?v=${id}`, "_blank", "noopener");
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-tv]"); if (b) openOnTv(b.dataset.tv); });

const player = (id, start = 0) => `<div class="player"><iframe src="${embedSrc(id, start)}"
  title="Workout video" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;

// ---------------------------------------------------------------------------
// Full-screen video viewer for exercise demos and videos from the coach.
// Closes with ✕, a swipe down, Escape, or the phone's back gesture, and always stops the video.
// ---------------------------------------------------------------------------
let pnInfo = null, pnMap = null;
function loadPnInfo() {
  if (!pnInfo) {
    pnInfo = fetch("data/pn.json").then((r) => r.json()).then((j) => {
      const m = new Map();
      for (const e of j.items || []) for (const v of ["men", "women"]) if (e[v]) m.set("vm:" + e[v], e);
      return (pnMap = m);
    }).catch(() => (pnMap = new Map()));
  }
  return pnInfo;
}
async function pnLookup(id) {
  if (!String(id).startsWith("vm:")) return null;
  return (await loadPnInfo()).get(id) || null;
}
// Precision Nutrition demos come in a men's and a women's version; show the one that matches the client.
let demoVer = "women";
function demoFor(id) {
  const e = id && pnMap?.get(id);
  return e && e[demoVer] ? "vm:" + e[demoVer] : id;
}
let viewerOpen = false;
function openViewer(id, { title = "", start = 0 } = {}) {
  let v = $("#viewer");
  if (!v) {
    v = document.createElement("div");
    v.id = "viewer";
    v.setAttribute("role", "dialog");
    v.setAttribute("aria-modal", "true");
    document.body.appendChild(v);
    v.addEventListener("click", (e) => { if (e.target.closest("[data-vclose]")) closeViewer(); });
    // Swipe down anywhere outside the video itself to close.
    let y0 = null, dy = 0;
    v.addEventListener("touchstart", (e) => { if (e.target.closest(".viewer-info") && v.querySelector(".viewer-info").scrollTop > 0) return; y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
    v.addEventListener("touchmove", (e) => {
      if (y0 == null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      v.style.transform = `translateY(${dy}px)`; v.style.opacity = String(Math.max(0.4, 1 - dy / 500));
    }, { passive: true });
    v.addEventListener("touchend", () => {
      if (y0 == null) return;
      y0 = null;
      if (dy > 110) closeViewer();
      else { v.style.transform = ""; v.style.opacity = ""; }
    });
  }
  v.innerHTML = `
    <div class="viewer-top"><span class="viewer-grip"></span><b>${esc(title)}</b><button class="viewer-x" data-vclose aria-label="Close"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="viewer-video"><div class="player"><iframe src="${embedSrc(id, start, true)}" title="${esc(title)}"
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div></div>
    <div class="viewer-info"></div>`;
  v.style.transform = ""; v.style.opacity = "";
  v.hidden = false;
  viewerOpen = true;
  document.body.style.overflow = "hidden";
  pnLookup(id).then((e) => {
    if (!e || !viewerOpen) return;
    const steps = String(e.cues || "").split(/\s*\d+\.\s+/).map((x) => x.trim()).filter(Boolean);
    const info = $("#viewer .viewer-info");
    if (info && steps.length) info.innerHTML = `<h3>How to do it</h3><ol class="viewer-cues">${steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`;
  });
}
function closeViewer(fromBack = false) {
  const v = $("#viewer");
  if (!v || !viewerOpen) return;
  viewerOpen = false;
  v.querySelectorAll("iframe").forEach((f) => f.remove());
  v.hidden = true;
  v.innerHTML = "";
  if ($("#sheet").hidden) document.body.style.overflow = "";
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && viewerOpen) closeViewer(); });

const ICO = {
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  video: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg>`,
  train: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`,
  back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
  send: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  chevL: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
  chevR: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`,
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
// Today (home): today's workout and the daily recap
// ---------------------------------------------------------------------------
async function renderHome() {
  $("#sub").textContent = dayFmt.format(new Date());
  const [{ data: ws }, { data: recaps }] = await Promise.all([
    db.from("workouts").select("*, workout_exercises(count)").eq("scheduled_on", ymd()).order("created_at"),
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
    <h3>Daily recap</h3>
    <button class="recap-btn" id="recap">
      <span class="recap-ico ${recapDone ? "done" : ""}">${recapDone ? ICO.check : ICO.mic}</span>
      <span><b>${recapDone ? "Today's recap is in" : "Tell me how today went"}</b>
      <span class="small muted">${recapDone ? "Tap to add more" : "Talk for about a minute"}</span></span>
    </button>`;

  app.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
    const start = b.classList.contains("start");
    if (start) primeAudio();
    openSession(b.dataset.open, { autoStart: start });
  }));
  $("#plan")?.addEventListener("click", () => openPlanner());
  $("#recap").addEventListener("click", openRecap);
  showInstallBar();
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
let trainMon = null, trainDay = null;  // the week and day being looked at in Train
async function renderTrain() {
  if (!trainMon) { trainMon = weekStart(); trainDay = ymd(); }
  const mon = trainMon;
  const sun = addDays(mon, 6);
  const thisMon = weekStart();
  const weeksAway = Math.round((mon - thisMon) / (7 * 864e5));
  $("#sub").innerHTML = `Week of<span class="sub-2">${longDayFmt.format(mon)}</span>`;
  const [{ data: week }, { data: past }] = await Promise.all([
    db.from("workouts").select("*, workout_exercises(count)").gte("scheduled_on", ymd(mon)).lte("scheduled_on", ymd(sun)).order("scheduled_on").order("created_at"),
    db.from("workouts").select("*").not("completed_at", "is", null).lt("scheduled_on", ymd(thisMon)).order("scheduled_on", { ascending: false }).limit(8),
  ]);
  if (tab !== "train") return;
  const ws = week ?? [];
  const today = ymd();
  if (trainDay < ymd(mon) || trainDay > ymd(sun)) trainDay = ymd(mon);
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(mon, i);
    const key = ymd(d);
    const items = ws.filter((w) => w.scheduled_on === key);
    const done = items.length && items.every((w) => w.completed_at);
    const mark = done ? `<span class="wk-mark on">${ICO.check}</span>` : items.length ? `<span class="wk-dot"></span>` : `<span class="wk-mark"></span>`;
    return `<button type="button" class="wk-day ${key === trainDay ? "sel" : ""} ${key === today ? "is-today" : ""}" data-day="${key}" aria-pressed="${key === trainDay}" aria-label="${dayFmt.format(d)}${items.length ? `, ${items.length} workout${items.length === 1 ? "" : "s"}` : ""}"><span class="wk-dow">${wdayFmt.format(d).slice(0, 1)}</span><b>${d.getDate()}</b>${mark}</button>`;
  }).join("");

  const planRow = (w) => {
    const nEx = w.workout_exercises?.[0]?.count ?? 0;
    const when = w.scheduled_on === today ? "today" : wdayFmt.format(fromYmd(w.scheduled_on));
    const end = w.completed_at ? `<span class="ok">${ICO.check}</span>` : `<span class="go">${w.scheduled_on === today ? "Start" : "Open"}</span>`;
    return `<li><button class="row" data-open="${w.id}">
      <span class="ico-box">${w.kind === "video" ? ICO.video : ICO.train}</span>
      <div class="main"><div class="name">${esc(w.title)}</div><div class="meta">${workoutMeta(w, nEx)} · ${w.completed_at ? `done ${when}` : when}${w.time_of_day ? ` · ${w.time_of_day}` : ""}</div></div>
      <div class="end">${end}</div></button></li>`;
  };
  const dayItems = ws.filter((w) => w.scheduled_on === trainDay);
  const weekLabel = weeksAway === 0 ? "This week" : weeksAway === 1 ? "Next week" : weeksAway === -1 ? "Last week"
    : `${shortFmt.format(mon)} – ${shortFmt.format(sun)}`;

  app.innerHTML = `
    <div class="wk-nav">
      <button type="button" class="wk-arrow" id="wk-prev" aria-label="Previous week">${ICO.chevL}</button>
      <h3>${weekLabel}</h3>
      ${weeksAway !== 0 || trainDay !== today ? `<button type="button" class="wk-today" id="wk-today">Today</button>` : ""}
      <button type="button" class="wk-arrow" id="wk-next" aria-label="Next week">${ICO.chevR}</button>
    </div>
    <div class="wk" id="wk">${strip}</div>
    <h3>${trainDay === today ? "Today" : dayFmt.format(fromYmd(trainDay))}</h3>
    ${dayItems.length ? `<div class="card" style="padding-top:4px;padding-bottom:4px"><ul class="list">${dayItems.map(planRow).join("")}</ul></div>`
      : `<p class="empty">Nothing planned for this day.</p>`}
    <button class="btn ghost block" id="plan" style="margin-top:10px">${ICO.plus}Plan a workout</button>
    ${(past ?? []).length ? `<h3>Past workouts</h3><div class="card" style="padding-top:4px;padding-bottom:4px"><ul class="list">${past.map((w) => `
      <li><button class="row" data-open="${w.id}"><div class="main"><div class="name">${esc(w.title)}</div>
      <div class="meta">${dayFmt.format(fromYmd(w.scheduled_on))}${w.duration_min ? ` · ${w.duration_min} min` : ""}</div></div>
      <div class="end">${w.feel ? feelLabel(FEEL, w.feel) : ""}</div></button></li>`).join("")}</ul></div>` : ""}`;
  app.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openSession(b.dataset.open)));
  app.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => { trainDay = b.dataset.day; renderTrain(); }));
  const shift = (n) => { trainMon = addDays(trainMon, 7 * n); trainDay = ymd(trainMon); renderTrain(); };
  $("#wk-prev").addEventListener("click", () => shift(-1));
  $("#wk-next").addEventListener("click", () => shift(1));
  $("#wk-today")?.addEventListener("click", () => { trainMon = weekStart(); trainDay = ymd(); renderTrain(); });
  // Swipe the day strip left or right to change weeks.
  let x0 = null;
  const strip$ = $("#wk");
  strip$.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  strip$.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) shift(dx < 0 ? 1 : -1);
  });
  $("#plan").addEventListener("click", () => openPlanner(trainDay));
}

// Plan a workout (until the Coach app exists, you plan your own)
function openPlanner(day = ymd()) {
  let kind = "video";
  const body = openSheet(`
    <h2>Plan a workout</h2>
    <label class="field"><span>Day</span><input class="input" id="pd" type="date" value="${day}"></label>
    <label class="field"><span>Name</span><input class="input" id="pt" placeholder="Lower body strength" required></label>
    <div class="field"><span class="muted small">Type</span>
      <div class="seg seg-wide" id="pk"><button data-v="video" aria-pressed="true">Video</button><button data-v="written" aria-pressed="false">Written</button></div></div>
    <div id="pv">
      <label class="field"><span>YouTube or Vimeo link</span><input class="input" id="pu" inputmode="url" placeholder="https://youtu.be/…"></label>
    </div>
    <div id="pw" hidden>
      <label class="field"><span>Exercises, one per line</span><textarea class="input" id="px" rows="6"
        placeholder="Goblet squat, 3x10, 50, rest 90&#10;A1 Bench press, 3x8, 135&#10;A2 Chest-supported row, 3x10, 40, rest 120&#10;Side plank, 3x30 sec&#10;Intervals 40/20 x8: Jumping jacks, Mountain climbers"></textarea></label>
      <p class="small muted" style="margin-top:-4px">Name, sets x reps, weight. Optional: rest 60 (seconds) and a YouTube link for a demo. Superset: start the lines with A1, A2 (B1, B2…). Intervals: "Intervals 40/20 x8:" then the moves (seconds on / off × rounds).</p>
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
      if (!row.video_id) return toast("That doesn't look like a YouTube or Vimeo link");
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
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((raw) => {
    // "Intervals 40/20 x8: Jumping jacks, Mountain climbers" -> an interval block
    const iv = raw.match(/^([^:]*?)\s*(\d+)\s*\/\s*(\d+)\s*[x×]\s*(\d+)\s*:?\s*(.*)$/i);
    if (iv && /interval|tabata|circuit|hiit|finisher/i.test(iv[1] || "interval")) {
      const moves = iv[5].split(",").map((m) => m.trim()).filter(Boolean);
      const work = Math.min(600, Number(iv[2])), restS = Math.min(600, Number(iv[3])), rounds = Math.min(50, Number(iv[4]));
      return {
        name: (iv[1] || "Intervals").trim() || "Intervals",
        scheme: `${rounds} rounds · ${work}s on / ${restS}s off`,
        interval: { work, rest: restS, rounds, moves: moves.length ? moves : ["Work"] },
        sets: [{ reps: "", weight: "", done: false }],
      };
    }
    // "A1 Bench press, ..." -> superset A
    const ss = raw.match(/^([A-Za-z])\d\s*[.):-]?\s+(.+)$/);
    const line = ss ? ss[2] : raw;
    const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
    let demo = null, restSec = null;
    const rest = parts.filter((p) => {
      const id = ytId(p); if (id && /youtu|vimeo/.test(p)) { demo = id; return false; }
      const r = p.match(/^(?:rest\s*)?(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|m|min|mins|minutes)?(?:\s*rest)?$/i);
      if (r && /rest/i.test(p)) { restSec = Math.round(Number(r[1]) * (/^m/i.test(r[2] || "") ? 60 : 1)); return false; }
      return true;
    });
    const [name, scheme = "", weight = ""] = rest;
    const m = scheme.match(/^(\d+)\s*[x×]\s*(.+)$/i);
    const nSets = m ? Math.min(Number(m[1]), 10) : 0;
    const reps = m ? m[2].trim() : "";
    const wt = weight.replace(/\s*(lb|lbs|kg)$/i, "");
    return {
      name: name || line, scheme: m ? `${m[1]} × ${reps}` : scheme || null, demo_video_id: demo,
      rest_sec: restSec != null ? Math.min(900, restSec) : null, superset: ss ? ss[1].toUpperCase() : null,
      sets: Array.from({ length: nSets }, () => ({ reps, weight: wt, done: false })),
    };
  });
}

// ---------------------------------------------------------------------------
// Workout session: video player, or written exercises with sets to check off
// ---------------------------------------------------------------------------
async function openSession(id, opts = {}) {
  const back = tab === "today" ? "today" : "train";
  sessionBack = back;
  const [{ data: w }, { data: exs }] = await Promise.all([
    db.from("workouts").select("*").eq("id", id).single(),
    db.from("workout_exercises").select("*").eq("workout_id", id).order("position"),
  ]);
  if (!w) return toast("Couldn't find that workout");
  window.scrollTo(0, 0);
  const list = exs ?? [];
  const last = await lastTimes(list, w);
  $("#sub").textContent = w.scheduled_on === ymd() ? "Today" : dayFmt.format(fromYmd(w.scheduled_on));

  // Superset labels: A1, A2… for exercises sharing a letter.
  const ssLabel = {};
  for (const x of list) if (x.superset) {
    const n = list.filter((y) => y.superset === x.superset && y.position <= x.position).length;
    ssLabel[x.id] = `${x.superset}${n}`;
  }
  const restOf = (x) => (x.rest_sec ?? REST_DEFAULT);
  const exInner = (x, i) => {
    if (x.interval) {
      const v = x.interval, done = !!x.sets?.[0]?.done;
      const { total, circuit } = ivPhases(v);
      const rr = circuit && v.rounds > 1 && (v.round_rest ?? v.rest) !== v.rest ? ` · ${fmtRest(v.round_rest)} between rounds` : "";
      return `
      <div class="ex-head"><div class="main"><div class="name">${esc(x.name)}</div>
        <div class="small muted">${v.rounds} round${v.rounds === 1 ? "" : "s"}${circuit ? ` of ${v.moves.length}` : ""} · ${v.work}s on / ${v.rest}s off${rr} · ${fmtClock(total)} total</div></div></div>
      <div class="iv-moves">${v.moves.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
      ${done ? `<div class="done-line" style="margin-top:12px">${ICO.check}<span>Done</span></div>` : ""}
      <button class="btn ${done ? "ghost" : "primary"} block" data-iv="${i}" style="margin-top:12px">${ICO.play}${done ? "Do it again" : "Start intervals"}</button>`;
    }
    const prev = last[x.name.toLowerCase()];
    const sub = [x.scheme, !x.superset || isLastInSuperset(list, x) ? `rest ${fmtRest(restOf(x))}` : "no rest, go to next"].filter(Boolean).join(" · ");
    return `
      <div class="ex-head">
        ${x.demo_video_id ? `<button class="ex-demo" data-demo="${demoFor(x.demo_video_id)}" data-name="${esc(x.name)}" style="background-image:url('${ytThumb(demoFor(x.demo_video_id))}')" aria-label="Watch the ${esc(x.name)} demo"><span class="play sm">${ICO.play}</span></button>` : ""}
        <div class="main"><div class="name">${ssLabel[x.id] ? `<span class="ss-tag">${ssLabel[x.id]}</span>` : ""}${esc(x.name)}</div><div class="small muted">${esc(sub)}</div></div>
      </div>
      ${prev ? `<div class="last-time">Last time · ${shortFmt.format(fromYmd(prev.day))}: <b>${esc(prev.summary)}</b></div>` : ""}
      ${x.sets?.length ? `<div class="set-grid set-head"><span>Set</span><span>Reps</span><span>Weight</span><span></span></div>
        ${x.sets.map((s, j) => {
          const p = prev?.sets?.[j];
          return `<div class="set-grid" data-set="${j}">
          <span class="set-n">${j + 1}</span>
          <input class="input set-in" data-f="reps" value="${esc(s.reps)}" placeholder="${esc(p?.reps ?? "")}" aria-label="Set ${j + 1} reps">
          <input class="input set-in" data-f="weight" value="${esc(s.weight)}" placeholder="${esc(p?.weight ?? "")}" inputmode="decimal" aria-label="Set ${j + 1} weight">
          <button class="set-done" data-done aria-pressed="${!!s.done}" aria-label="Set ${j + 1} done">${ICO.check}</button></div>`;
        }).join("")}` : ""}`;
  };
  const exBlocks = () => {
    let html = "", i = 0;
    while (i < list.length) {
      const x = list[i];
      if (x.superset) {
        const group = [];
        while (i < list.length && list[i].superset === x.superset) { group.push(i); i++; }
        html += `<div class="card ex ss"><div class="ss-head">Superset ${x.superset} · go straight through, then rest</div>
          ${group.map((k) => `<div class="ss-item" data-ex="${k}">${exInner(list[k], k)}</div>`).join("")}</div>`;
      } else {
        html += `<div class="card ex" data-ex="${i}">${exInner(x, i)}</div>`;
        i++;
      }
    }
    return html;
  };

  app.innerHTML = `
    <div class="sess-head">
      <button class="icon-btn" id="back" aria-label="Back">${ICO.back}</button>
      <div><div class="w-title">${esc(w.title)}</div><div class="small muted">${workoutMeta(w, list.length)}</div></div>
    </div>
    ${w.note ? `<h3>Coach note</h3><div class="card note">${esc(w.note)}</div>` : ""}
    ${w.kind === "video" && w.video_id ? `<div style="margin-top:14px">${player(w.video_id)}${tvButton(w.video_id)}</div>` : ""}
    ${list.length ? `<h3>Exercises</h3>${exBlocks()}` : ""}
    ${w.completed_at
      ? `<div class="done-line" style="margin-top:16px">${ICO.check}<span>Done${w.feel ? ` · felt ${feelLabel(FEEL, w.feel).toLowerCase()}` : ""}</span></div>
         <button class="btn ghost block" id="undo" style="margin-top:10px">Mark not done</button>`
      : `<button class="btn primary block" id="finish" style="margin-top:16px">${w.kind === "video" ? "Mark done" : "Finish workout"}</button>`}
    ${!w.completed_at && (isCoach || features.move_days) ? `<div class="move-row"><label class="field"><span>Move to another day</span>
      <input class="input" id="mv-day" type="date" value="${w.scheduled_on}"></label><button class="btn ghost" id="mv-go">Move</button></div>` : ""}
    ${isCoach || !w.assigned ? `<button class="btn danger block" id="del-w" style="margin-top:10px">Delete workout</button>` : ""}`;

  $("#back").addEventListener("click", () => { stopRest(); go(back, true); });
  app.querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", () => openViewer(b.dataset.demo, { title: b.dataset.name || "Demo" })));

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
      const ivb = e.target.closest("[data-iv]");
      if (ivb) {
        stopRest();
        return runIntervals(list[i], () => {
          list[i].sets = [{ reps: "", weight: "", done: true }];
          save(i);
          setTimeout(() => openSession(w.id), 500);
        });
      }
      const b = e.target.closest("[data-done]");
      if (!b) return;
      const j = Number(b.closest("[data-set]").dataset.set);
      list[i].sets[j].done = !list[i].sets[j].done;
      b.setAttribute("aria-pressed", String(list[i].sets[j].done));
      // Typed nothing? Keep last time's numbers (shown as hints) for this set.
      const row = b.closest("[data-set]");
      for (const inp of row.querySelectorAll(".set-in")) if (!inp.value && inp.placeholder) {
        inp.value = inp.placeholder; list[i].sets[j][inp.dataset.f] = inp.value;
      }
      save(i);
      // Rest starts after a set; in a superset, only after the last exercise of the round.
      const x = list[i];
      if (list[i].sets[j].done && (!x.superset || isLastInSuperset(list, x))) startRest(x.rest_sec ?? REST_DEFAULT);
    });
  });

  $("#finish")?.addEventListener("click", () => {
    const body = openSheet(`<h2>How did it feel?</h2><div class="chips" id="feel">${FEEL.map(([k, l]) => `<button class="chip" data-v="${k}">${l}</button>`).join("")}</div>`);
    $("#feel", body).addEventListener("click", async (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      const { error } = await db.from("workouts").update({ completed_at: new Date().toISOString(), feel: b.dataset.v }).eq("id", w.id);
      if (error) return toast(error.message);
      stopRest();
      closeSheet();
      toast("Nice work");
      go(back);
    });
  });
  $("#undo")?.addEventListener("click", async () => {
    await db.from("workouts").update({ completed_at: null, feel: null }).eq("id", w.id);
    openSession(w.id);
  });
  $("#mv-go")?.addEventListener("click", async () => {
    const day = $("#mv-day").value;
    if (!day || day === w.scheduled_on) return toast("Pick a different day");
    const { error } = await db.from("workouts").update({ scheduled_on: day }).eq("id", w.id);
    if (error) return toast(error.message);
    stopRest();
    toast(`Moved to ${dayFmt.format(fromYmd(day))}`);
    go(back);
  });
  $("#del-w")?.addEventListener("click", async () => {
    if (!confirmDelete(w.title)) return;
    await db.from("workouts").delete().eq("id", w.id);
    toast("Deleted");
    go(back);
  });
  // A workout that is one interval block: Start goes straight into the timer.
  if (opts.autoStart && !w.completed_at && list.length === 1 && list[0].interval && !list[0].sets?.[0]?.done) {
    app.querySelector('[data-iv="0"]')?.click();
  }
}

// ---------------------------------------------------------------------------
// Last time's numbers, supersets and the rest timer
// ---------------------------------------------------------------------------
const REST_DEFAULT = 90;
const fmtRest = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : `${sec}s`);
const isLastInSuperset = (list, x) => !list.some((y) => y.superset === x.superset && y.position > x.position);

// The most recent earlier session of each exercise (by name) that has numbers in it.
async function lastTimes(list, w) {
  const names = [...new Set(list.map((x) => x.name))];
  if (!names.length) return {};
  const { data } = await db.from("workout_exercises")
    .select("name,sets,workouts!inner(scheduled_on)")
    .in("name", names).neq("workout_id", w.id).lte("workouts.scheduled_on", w.scheduled_on)
    .order("created_at", { ascending: false }).limit(200);
  const out = {};
  const rows = (data ?? []).slice().sort((a, b) => (b.workouts.scheduled_on > a.workouts.scheduled_on ? 1 : -1));
  for (const r of rows) {
    const key = r.name.toLowerCase();
    if (out[key]) continue;
    const sets = (r.sets ?? []).filter((s) => s.done || s.weight || s.reps);
    const done = sets.filter((s) => s.done);
    const use = done.length ? done : [];
    if (!use.length) continue;
    out[key] = {
      day: r.workouts.scheduled_on,
      sets: use.map((s) => ({ reps: s.reps ?? "", weight: s.weight ?? "" })),
      summary: use.map((s) => (s.weight ? `${s.weight} × ${s.reps}` : `${s.reps}`)).join(", "),
    };
  }
  return out;
}

// Rest timer: a bar above the tabs. Counts from an end time, so it stays right if the screen sleeps.
let rest = { end: 0, total: 0, tick: null, audio: null };
function startRest(sec) {
  if (!sec) return;
  try { rest.audio ??= new (window.AudioContext || window.webkitAudioContext)(); rest.audio.resume(); } catch {}
  rest.total = sec;
  rest.end = Date.now() + sec * 1000;
  let bar = $("#restbar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "restbar";
    bar.innerHTML = `<div class="rb-fill"></div><span class="rb-label">Rest</span><b class="rb-time"></b>
      <button data-rb="-15" aria-label="15 seconds less">−15</button><button data-rb="15" aria-label="15 seconds more">+15</button><button data-rb="skip">Skip</button>`;
    document.body.appendChild(bar);
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-rb]");
      if (!b) return;
      if (b.dataset.rb === "skip") return stopRest();
      rest.end += Number(b.dataset.rb) * 1000;
      rest.total = Math.max(rest.total, Math.ceil((rest.end - Date.now()) / 1000));
      drawRest();
    });
  }
  bar.classList.remove("go");
  bar.hidden = false;
  clearInterval(rest.tick);
  rest.tick = setInterval(drawRest, 250);
  drawRest();
}
function drawRest() {
  const bar = $("#restbar");
  if (!bar) return;
  const left = Math.max(0, Math.ceil((rest.end - Date.now()) / 1000));
  $(".rb-time", bar).textContent = left ? fmtRest(left) : "Go";
  $(".rb-fill", bar).style.width = `${rest.total ? (left / rest.total) * 100 : 0}%`;
  if (!left) {
    clearInterval(rest.tick);
    bar.classList.add("go");
    $(".rb-label", bar).textContent = "Rest's up";
    restAlert();
    setTimeout(() => { if (bar.classList.contains("go")) stopRest(); }, 4000);
  } else $(".rb-label", bar).textContent = "Rest";
}
function restAlert() {
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
  try {
    const ctx = rest.audio;
    if (!ctx) return;
    [0, 0.25].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.22);
    });
  } catch {}
}
function stopRest() {
  clearInterval(rest.tick);
  const bar = $("#restbar");
  if (bar) { bar.hidden = true; bar.classList.remove("go"); }
}

// ---------------------------------------------------------------------------
// Interval timer: full screen, get-ready countdown, then work / rest through every round
// ---------------------------------------------------------------------------
const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, "0")}`;

// The timeline of an interval block. Circuit blocks (the builder's) go through every move once
// per round, with a longer rest between rounds; older blocks count each work interval as a round.
function ivPhases(v) {
  const circuit = v.circuit === true;
  const moves = v.moves?.length ? v.moves : ["Work"];
  const phases = [{ kind: "prep", sec: Math.max(3, Number(v.prep) || 10), move: moves[0], round: 1, ex: 1 }];
  if (circuit) {
    const rr = v.round_rest ?? v.rest;
    for (let r = 1; r <= v.rounds; r++) {
      moves.forEach((m, e) => {
        phases.push({ kind: "work", sec: v.work, move: m, round: r, ex: e + 1 });
        const lastMove = e === moves.length - 1;
        if (!lastMove && v.rest > 0) phases.push({ kind: "rest", sec: v.rest, move: moves[e + 1], round: r, ex: e + 2 });
        if (lastMove && r < v.rounds && rr > 0) phases.push({ kind: "break", sec: rr, move: moves[0], round: r + 1, ex: 1 });
      });
    }
  } else {
    for (let r = 1; r <= v.rounds; r++) {
      phases.push({ kind: "work", sec: v.work, move: moves[(r - 1) % moves.length], round: r });
      if (r < v.rounds && v.rest > 0) phases.push({ kind: "rest", sec: v.rest, move: moves[r % moves.length], round: r + 1 });
    }
  }
  const total = phases.slice(1).reduce((n, p) => n + p.sec, 0);
  return { phases, total, circuit, moves };
}
// Browsers only allow sound after a tap, so get the audio going in the tap itself.
function primeAudio() {
  try { rest.audio ??= new (window.AudioContext || window.webkitAudioContext)(); rest.audio.resume(); } catch {}
}

async function runIntervals(x, onDone) {
  const v = x.interval;
  const { phases, circuit, moves } = ivPhases(v);
  try { rest.audio ??= new (window.AudioContext || window.webkitAudioContext)(); rest.audio.resume(); } catch {}
  let lock = null;
  try { lock = await navigator.wakeLock?.request("screen"); } catch {}

  const el = document.createElement("div");
  el.id = "iv";
  const PAUSE_I = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>`;
  const PLAY_I = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>`;
  el.innerHTML = `
    <button class="iv-x" data-ivc="end" aria-label="End intervals">✕</button>
    <div class="iv-phase"></div>
    <div class="iv-ring">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="iv-track" cx="50" cy="50" r="44"/><circle class="iv-arc" cx="50" cy="50" r="44" pathLength="100"/></svg>
      <div class="iv-time" role="timer"></div>
    </div>
    <div class="iv-move"></div>
    <div class="iv-boxes"><div><b class="iv-b1"></b><span class="iv-l1"></span></div><div><b class="iv-b2"></b><span class="iv-l2"></span></div></div>
    <div class="iv-ctl">
      <button data-ivc="back" aria-label="Back"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M11.5 6v12L3 12zM21 6v12l-8.5-6z" fill="currentColor"/></svg></button>
      <button data-ivc="pause" class="iv-main" aria-label="Pause">${PAUSE_I}<span>Pause</span></button>
      <button data-ivc="skip" aria-label="Skip"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12.5 6v12L21 12zM3 6v12l8.5-6z" fill="currentColor"/></svg></button>
    </div>`;
  document.body.appendChild(el);
  document.body.style.overflow = "hidden";

  let idx = 0, end = Date.now() + phases[0].sec * 1000, paused = null, lastBeep = null, tick = null;
  const beep = (freq = 880, len = 0.12) => {
    try {
      const ctx = rest.audio; if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + len);
      o.start(); o.stop(ctx.currentTime + len + 0.02);
    } catch {}
  };
  const finish = (completed) => {
    clearInterval(tick);
    try { lock?.release(); } catch {}
    if (completed) {
      el.className = "done";
      el.innerHTML = `<div class="iv-phase">Done</div><div class="iv-time">${v.rounds}</div><div class="iv-move">round${v.rounds === 1 ? "" : "s"} finished</div>
        <div class="iv-ctl"><button data-ivc="close" class="solid">Back to workout</button></div>`;
      beep(988, 0.5);
      try { navigator.vibrate?.([300, 120, 300]); } catch {}
      onDone();
    } else close();
  };
  const close = () => { el.remove(); document.body.style.overflow = ""; };
  const go = (i) => {
    idx = i;
    if (idx >= phases.length) return finish(true);
    end = Date.now() + phases[idx].sec * 1000;
    lastBeep = null;
    beep(phases[idx].kind === "work" ? 1175 : 660, 0.35);
    try { navigator.vibrate?.(phases[idx].kind === "work" ? 250 : 120); } catch {}
    draw();
  };
  let shown = "";
  const draw = () => {
    const p = phases[idx];
    const left = paused ?? Math.max(0, Math.ceil((end - Date.now()) / 1000));
    el.className = (p.kind === "break" ? "rest" : p.kind) + (paused != null ? " paused" : "");
    $(".iv-phase", el).textContent = paused != null ? "Paused" : { work: "Work", rest: "Rest", break: "Round break", prep: "Get ready" }[p.kind];
    $(".iv-time", el).textContent = left >= 60 ? fmtClock(left) : String(left);
    $(".iv-time", el).classList.toggle("long", left >= 60);
    const done = paused != null ? 1 - paused / p.sec : 1 - Math.max(0, end - Date.now()) / (p.sec * 1000);
    $(".iv-arc", el).style.strokeDashoffset = String(100 - Math.min(100, done * 100));
    $(".iv-move", el).textContent = p.kind === "work" ? p.move : `Next: ${p.move}`;
    $(".iv-b1", el).textContent = `${p.round}/${v.rounds}`;
    $(".iv-l1", el).textContent = "Round";
    if (circuit) { $(".iv-b2", el).textContent = `${p.ex}/${moves.length}`; $(".iv-l2", el).textContent = "Exercise"; }
    else {
      const rest = phases.slice(idx + 1).reduce((n, q) => n + q.sec, 0) + left;
      $(".iv-b2", el).textContent = fmtClock(rest); $(".iv-l2", el).textContent = "Left";
    }
    const state = paused != null ? "play" : "pause";
    if (shown !== state) {
      shown = state;
      const pb = $('[data-ivc="pause"]', el);
      pb.innerHTML = state === "play" ? `${PLAY_I}<span>Resume</span>` : `${PAUSE_I}<span>Pause</span>`;
      pb.setAttribute("aria-label", state === "play" ? "Resume" : "Pause");
    }
    if (paused == null) {
      if (left <= 3 && left > 0 && lastBeep !== left) { lastBeep = left; beep(880, 0.1); }
      if (left === 0) go(idx + 1);
    }
  };
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ivc]");
    if (!b) return;
    const c = b.dataset.ivc;
    if (c === "close") return close();
    if (c === "end") return finish(false);
    if (c === "skip") { paused = null; return go(idx + 1); }
    if (c === "back") {
      // Restart this part, or go to the one before if it just started.
      const into = phases[idx].sec - (paused ?? Math.max(0, Math.ceil((end - Date.now()) / 1000)));
      paused = null;
      return go(into > 2 || idx === 0 ? idx : idx - 1);
    }
    if (c === "pause") {
      if (paused == null) paused = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      else { end = Date.now() + paused * 1000; paused = null; }
      draw();
    }
  });
  tick = setInterval(draw, 200);
  draw();
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
let foodDay = null; // "YYYY-MM-DD" shown on the Food tab; null = today

const MEALS = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snacks"]];
const mealLabel = (k) => MEALS.find((m) => m[0] === k)?.[1] ?? "";
// Entries saved before meals existed fall back to the time they were eaten.
function mealOf(m) {
  if (m.meal) return m.meal;
  const h = new Date(m.eaten_at).getHours();
  return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 21 ? "dinner" : "snack";
}
const parseDay = (s) => { const [y, mo, d] = s.split("-").map(Number); return new Date(y, mo - 1, d); };

// Where the next log goes: a day picked on the Food tab, and a meal when logged from a meal's +.
let logTo = { day: null, meal: null };
function defaultWhen() {
  if (logTo.day && logTo.day !== ymd()) { const d = parseDay(logTo.day); d.setHours(12, 0, 0, 0); return localInputValue(d); }
  return localInputValue();
}
// Meal picker for the log sheets: nothing is pre-picked unless they came from a meal's +.
const mealPickerHtml = () => `<div class="field"><span class="muted small">Meal</span>
  <div class="seg seg-wide meal-pick" id="mp">${MEALS.map(([k, l]) => `<button type="button" data-meal="${k}" aria-pressed="${k === logTo.meal}">${l}</button>`).join("")}</div></div>`;
function bindMealPicker(body) {
  const box = $("#mp", body);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-meal]");
    if (!b) return;
    box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    box.classList.remove("need");
  });
  return () => {
    const v = box.querySelector('[aria-pressed="true"]')?.dataset.meal ?? null;
    if (!v) { box.classList.add("need"); box.scrollIntoView({ behavior: "smooth", block: "center" }); toast("Pick a meal"); }
    return v;
  };
}
const foodSegHtml = () => `<div class="seg seg-wide" id="fseg" style="margin:6px 0 4px">
  <button data-v="today" aria-pressed="${foodSeg === "today"}">Today</button><button data-v="mine" aria-pressed="${foodSeg === "mine"}">My foods</button></div>`;
function bindFoodSeg() {
  $("#fseg")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === foodSeg) return;
    foodSeg = b.dataset.v;
    logTo = { day: foodDay, meal: null };
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
    ${features.targets_edit ? `<button class="auth-link t-edit" id="edit-targets">Edit targets</button>` : ""}
  </div>`;
}

async function renderFood() {
  if (foodSeg === "mine") { await renderFoods(foodSegHtml()); bindFoodSeg(); return; }
  const todayStr = ymd();
  if (foodDay && foodDay >= todayStr) foodDay = null;
  const dayStr = foodDay ?? todayStr;
  const isToday = dayStr === todayStr;
  const day = parseDay(dayStr);
  const wkStart = weekStart(day); wkStart.setHours(0, 0, 0, 0);
  const wkEnd = addDays(wkStart, 7);
  $("#sub").textContent = isToday ? dayFmt.format(new Date()) : dayFmt.format(day);

  const [{ data: week }, { data: goal }] = await Promise.all([
    db.from("meals").select("id,name,servings,nutrients,eaten_at,energy,stomach,food_id,meal")
      .gte("eaten_at", wkStart.toISOString()).lt("eaten_at", wkEnd.toISOString()).order("eaten_at", { ascending: true }),
    db.from("nutrition_targets").select("kcal,protein_g,carbs_g,fat_g").maybeSingle(),
  ]);
  const all = week ?? [];
  const logged = new Set(all.map((m) => ymd(new Date(m.eaten_at))));
  const meals = all.filter((m) => ymd(new Date(m.eaten_at)) === dayStr);
  const t = sumNutrients(meals.map((m) => m.nutrients));
  const kcal = r0(t.kcal);
  const share = (g, per) => (kcal ? Math.round((g * per * 100) / kcal) : 0);
  const bar = (name, g, per) => `<div class="mbar"><div class="mbar-top"><span>${name}</span><b>${r0(g)}g${kcal ? ` <i>· ${share(g, per)}% of calories</i>` : ""}</b></div>
    <div class="mbar-track"><div style="width:${Math.min(100, share(g, per))}%"></div></div></div>`;

  const days = Array.from({ length: 7 }, (_, i) => addDays(wkStart, i));
  const strip = `<div class="fwk">
      <button class="fwk-nav" data-wk="-7" aria-label="Previous week">‹</button>
      ${days.map((d) => {
        const k = ymd(d), future = k > todayStr;
        return `<button class="fwk-day${k === todayStr ? " is-today" : ""}" data-day="${k}" ${k === dayStr ? 'aria-current="date"' : ""} ${future ? "disabled" : ""}>
          <span>${"MTWTFSS"[(d.getDay() + 6) % 7]}</span><b>${d.getDate()}</b><i class="${logged.has(k) ? "dot" : ""}"></i></button>`;
      }).join("")}
      <button class="fwk-nav" data-wk="7" aria-label="Next week" ${ymd(wkEnd) > todayStr ? "disabled" : ""}>›</button>
    </div>
    ${isToday ? "" : `<button class="today-pill" id="back-today">Back to today</button>`}`;

  const sections = MEALS.map(([k, l]) => {
    const list = meals.filter((m) => mealOf(m) === k);
    const kc = r0(sumNutrients(list.map((m) => m.nutrients)).kcal);
    return `<section class="meal-sec">
      <div class="meal-head"><h3>${l}</h3><span class="${list.length ? "" : "muted"}">${list.length ? `${kc.toLocaleString()} cal` : "Nothing yet"}</span>
        <button class="meal-add" data-add="${k}" aria-label="Log to ${l}">+</button></div>
      ${list.length ? `<div class="card" style="padding-top:2px;padding-bottom:2px"><ul class="list">${list.map((m) => `
        <li><button class="row" data-meal="${m.id}">
          <div class="main"><div class="name">${esc(m.name)}${m.servings != 1 ? ` <span class="badge">×${m.servings}</span>` : ""}</div>
          <div class="meta">${timeFmt.format(new Date(m.eaten_at))} · ${macroLine(m.nutrients)}</div></div>
          <div class="end">${feelBadge(m)}</div>
        </button></li>`).join("")}</ul></div>` : ""}
    </section>`;
  }).join("");

  app.innerHTML = `
    ${foodSegHtml()}
    ${strip}
    <div class="log-actions" style="margin-top:12px">
      <button class="btn primary wide" id="snap">${ICO.camera}Snap food</button>
      <button class="btn" id="scan">${ICO.scan}Scan barcode</button>
      <button class="btn" id="type">${ICO.search}Search</button>
    </div>
    <h3>${isToday ? "Today, roughly" : `${dayFmt.format(day)}, roughly`}</h3>
    ${goal ? targetCard(goal, t) : `<div class="card">
      <div class="kcal"><b>${kcal.toLocaleString()}</b><span>calories ${isToday ? "so far" : "that day"}</span></div>
      ${bar("Protein", t.protein, 4)}${bar("Carbs", t.carbs, 4)}${bar("Fat", t.fat, 9)}
      ${features.targets_edit ? `<button class="btn block" id="set-targets" style="margin-top:14px">Set daily targets</button>` : ""}
    </div>`}
    ${sections}`;
  bindFoodSeg();
  const here = () => ({ day: foodDay, meal: null });
  $("#set-targets")?.addEventListener("click", openTargets);
  $("#edit-targets")?.addEventListener("click", openTargets);
  $("#snap").addEventListener("click", () => { logTo = here(); $("#camera").click(); });
  $("#type").addEventListener("click", () => { logTo = here(); openSearch(); });
  $("#scan").addEventListener("click", () => { logTo = here(); openScanner(); });
  $("#back-today")?.addEventListener("click", () => { foodDay = null; renderFood(); });
  app.querySelector(".fwk").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.day) foodDay = b.dataset.day === todayStr ? null : b.dataset.day;
    if (b.dataset.wk) { const k = ymd(addDays(day, Number(b.dataset.wk))); foodDay = k >= todayStr ? null : k; }
    renderFood();
  });
  app.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => openMealAdd(b.dataset.add)));
  app.querySelectorAll("[data-meal]").forEach((b) => b.addEventListener("click", () => openMeal(b.dataset.meal)));
}

// The + on a meal: pick how to log, with that meal already chosen.
function openMealAdd(meal) {
  const body = openSheet(`
    <h2>Log to ${mealLabel(meal)}</h2>
    ${foodDay ? `<p class="small muted" style="margin-top:-4px">${dayFmt.format(parseDay(foodDay))}</p>` : ""}
    <div class="add-grid">
      <button class="btn" data-how="snap">${ICO.camera}Snap</button>
      <button class="btn" data-how="scan">${ICO.scan}Scan</button>
      <button class="btn" data-how="type">${ICO.search}Search</button>
      <button class="btn" data-how="mine">My foods</button>
    </div>`);
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-how]");
    if (!b) return;
    logTo = { day: foodDay, meal };
    const how = b.dataset.how;
    if (how === "snap") { closeSheet(); $("#camera").click(); }
    if (how === "scan") openScanner();
    if (how === "type") openSearch();
    if (how === "mine") { closeSheet(); foodSeg = "mine"; renderFood(); }
  });
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
// Quick picks for the carbs ↔ fat slider (fat as % of calories; clamped to what's allowed).
const SPLITS = [["More carbs", 22], ["Balanced", 30], ["More fat", 40], ["Low carb", 55]];
// Fat can't go under 0.3 g per lb; carbs can't go under 50 g.
function fatRange(kcal, protein_g, weight_lb) {
  const min = Math.ceil(((weight_lb * 0.3 * 9) / kcal) * 100);
  const max = Math.floor(((kcal - protein_g * 4 - 50 * 4) / kcal) * 100);
  return [Math.min(min, max), Math.max(min, max)];
}

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
    <label class="field"><span>Protein per lb of body weight</span><select class="input" id="t-pro">${PROTEIN_PER_LB.map((v) => `<option value="${v}" ${v === f.protein_per_lb ? "selected" : ""}>${v} g</option>`).join("")}</select></label>
    <div class="field" id="t-split-wrap"><span>Carbs ↔ Fat</span>
      <input type="range" class="split" id="t-split" min="15" max="60" step="1" value="${f.fat_pct}">
      <div class="split-ends"><span id="t-carb-g"></span><span id="t-fat-g"></span></div>
      <div class="chips" id="t-presets">${SPLITS.map(([l, v]) => `<button type="button" class="chip" data-split="${v}">${l}</button>`).join("")}</div>
      <p class="small muted" style="margin:8px 0 0">Calories and protein stay the same. More carbs usually helps hard training; more fat keeps some people fuller.</p>
    </div>
    <div class="card t-result" id="t-out"></div>
    <button class="btn primary block" id="t-save">Save targets</button>`);

  const read = () => {
    f.age = Number($("#t-age", body).value);
    f.weight_lb = Number($("#t-w", body).value);
    f.height_in = Number($("#t-ft", body).value) * 12 + Number($("#t-in", body).value || 0);
    f.activity = $("#t-act", body).value;
    f.protein_per_lb = Number($("#t-pro", body).value);
    f.fat_pct = Number($("#t-split", body).value);
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
    const base = calcTargets(f);
    const [lo, hi] = fatRange(base.kcal, base.protein_g, f.weight_lb);
    const sl = $("#t-split", body);
    sl.min = lo; sl.max = hi;
    if (f.fat_pct < lo || f.fat_pct > hi) { f.fat_pct = Math.min(hi, Math.max(lo, f.fat_pct)); sl.value = f.fat_pct; }
    const c = calcTargets(f);
    $("#t-split-wrap", body).hidden = custom;
    $("#t-carb-g", body).textContent = `${c.carbs_g}g carbs`;
    $("#t-fat-g", body).textContent = `${c.fat_g}g fat`;
    body.querySelectorAll("[data-split]").forEach((b) => {
      const v = Math.min(hi, Math.max(lo, Number(b.dataset.split)));
      b.setAttribute("aria-pressed", String(v === f.fat_pct));
    });
    sl.style.setProperty("--p", `${((f.fat_pct - lo) / Math.max(1, hi - lo)) * 100}%`);
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
    if (b.dataset.split) {
      const sl = $("#t-split", body);
      sl.value = Math.min(Number(sl.max), Math.max(Number(sl.min), Number(b.dataset.split)));
      return draw();
    }
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
      <div class="stat"><b>${meals.length}</b><span>Meals logged</span></div>
    </div>

    ${features.weight ? `<h3>Weight</h3>
    <div class="card">
      ${ws.length ? `<div class="wt-top"><b>${ws[ws.length - 1].weight_lb} lb</b><span class="small muted">${dayFmt.format(new Date(ws[ws.length - 1].measured_at))}</span></div>${spark}` : `<p class="small muted" style="margin-top:0">Optional. Log it whenever you like and the trend shows here.</p>`}
      <form id="wf" class="wt-form"><input class="input" id="wt" type="number" inputmode="decimal" step="0.1" placeholder="lb" aria-label="Weight in pounds" required><button class="btn">Log</button></form>
    </div>` : ""}

    ${isCoach ? `<h3>Summaries & patterns</h3>
    ${meals.length ? `<button class="btn ghost block" id="gen" style="margin-bottom:10px">Write my summary now</button>` : ""}
    ${(obs ?? []).length ? obs.map((o) => `
      <button class="card obs row ${o.read_at ? "" : "unread"}" data-obs="${o.id}" style="display:block">
        <div class="when">${o.kind === "weekly" ? "Weekly summary" : "Pattern"} · ${dayFmt.format(new Date(o.created_at))}</div>
        <div class="title">${esc(o.title)}</div>
        <div class="small muted">${esc(o.short)}</div>
      </button>`).join("")
    : `<p class="empty">Your first weekly summary arrives Sunday morning. </p>`}` : ""}`;

  $("#wf")?.addEventListener("submit", async (e) => {
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
// Coach: next call and messages (text + voice notes, videos the coach sends)
// ---------------------------------------------------------------------------
const REC_MAX = 180;
function recMime() {
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/aac"]) if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  return "";
}
const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
async function startRecorder(onTick) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = recMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const t0 = Date.now();
  let done;
  const finished = new Promise((r) => (done = r));
  rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); done(); };
  rec.start(250);
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    onTick?.(s);
  }, 250);
  const ctl = {
    async stop() {
      clearInterval(timer);
      if (rec.state !== "inactive") rec.stop();
      await finished;
      const type = (rec.mimeType || mime || "audio/webm").split(";")[0];
      return { blob: new Blob(chunks, { type }), sec: Math.max(1, Math.round((Date.now() - t0) / 1000)), type, ext: type.includes("mp4") || type.includes("aac") ? "m4a" : "webm" };
    },
    cancel() { clearInterval(timer); if (rec.state !== "inactive") rec.stop(); },
  };
  return ctl;
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function msgBubble(m, urls) {
  const mine = !m.from_coach;
  const audio = m.audio_path ? `<audio controls preload="metadata" src="${esc(urls[m.audio_path] || "")}"></audio>` : "";
  const tx = m.audio_path ? (m.transcript ? `<p class="tx">${esc(m.transcript)}</p>`
    : m.transcript_status === "pending" ? `<p class="tx muted">Transcribing…</p>` : "") : "";
  const vid = m.video_id ? `<button class="msg-video" data-demo="${esc(m.video_id)}" data-start="${m.video_start || 0}" data-title="${esc(m.video_title || "Video")}" style="background-image:url('${esc(m.video_thumb || ytThumb(m.video_id))}')" aria-label="Play ${esc(m.video_title || "video")}">
      <span class="play sm">${ICO.play}</span></button><b class="msg-vt">${esc(m.video_title || "Video")}${m.video_start ? ` <span class="muted small">· starts at ${mmss(m.video_start)}</span>` : ""}</b>` : "";
  const body = m.body ? `<div class="msg-text">${esc(m.body)}</div>` : "";
  return `<div class="bubble ${mine ? "me" : "them"}${m.audio_path ? " voice" : ""}" data-mid="${m.id}"><div>${body}${audio}${tx}${vid}</div>
    <span>${mine ? "" : "Coach · "}${when(m.created_at)}</span></div>`;
}

// ---------- video calls ----------
// Join from 15 minutes before the start until an hour after the booked end (same as the server).
function callWindow(c) {
  const t = new Date(c.starts_at).getTime();
  return { open: t - 15 * 60e3, close: t + ((c.minutes || 30) + 60) * 60e3 };
}
async function joinCall(call, btn) {
  if (!call) return;
  if (btn) btn.disabled = true;
  try {
    const pass = await api("call_join", { call_id: call.id });
    if (pass.need_consent) { if (btn) btn.disabled = false; return askCallConsent(call); }
    clearInterval(msgPoll);
    await openCall(pass, { esc, toast, onEnd: () => { if (tab === "coach") renderCoach(); } });
  } catch (e) { toast(e.message || "Couldn't join the call"); }
  if (btn) btn.disabled = false;
}
function askCallConsent(call) {
  const body = openSheet(`
    <h2>Before your first call</h2>
    <p>Calls with Andrew are transcribed so you both get written call notes afterward. Your notes show up on this tab. No audio or video is saved.</p>
    <button class="btn primary block" id="cc-ok">OK, join the call</button>
    <button class="btn block" data-close style="margin-top:8px">Not now</button>`);
  $("#cc-ok", body).addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    const { error } = await db.rpc("give_call_consent");
    if (error) { e.currentTarget.disabled = false; return toast(error.message); }
    closeSheet();
    joinCall(call);
  });
}
function showNotes(c) {
  const n = c?.notes;
  if (!n) return;
  const mine = (n.actions ?? []).filter((a) => a.who !== "Andrew"), his = (n.actions ?? []).filter((a) => a.who === "Andrew");
  openSheet(`
    <h2>Call notes</h2>
    <p class="muted small">${esc(c.title)} · ${dayFmt.format(new Date(c.starts_at))}</p>
    ${n.summary ? `<p>${esc(n.summary)}</p>` : ""}
    ${n.points?.length ? `<h3>What we covered</h3><ul class="notes-list">${n.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    ${mine.length ? `<h3>Your next steps</h3><ul class="notes-list">${mine.map((a) => `<li>${esc(a.text)}</li>`).join("")}</ul>` : ""}
    ${his.length ? `<h3>Andrew's next steps</h3><ul class="notes-list">${his.map((a) => `<li>${esc(a.text)}</li>`).join("")}</ul>` : ""}
    <button class="btn block" data-close style="margin-top:12px">Close</button>`);
}

let msgPoll = null, recNow = null;
async function renderCoach() {
  $("#sub").textContent = "Your coach";
  const [{ data: calls }, { data: msgs }, { data: past }] = await Promise.all([
    db.from("calls").select("*").gte("starts_at", new Date(Date.now() - 5 * 3600e3).toISOString()).order("starts_at").limit(5),
    db.from("messages").select("*").order("created_at").limit(300),
    db.from("calls").select("id, starts_at, title, notes, notes_status, joined_at").lt("starts_at", new Date().toISOString())
      .in("notes_status", ["done", "waiting"]).not("joined_at", "is", null).order("starts_at", { ascending: false }).limit(4),
  ]);
  if (tab !== "coach") return;
  const call = (calls ?? []).find((c) => callWindow(c).close > Date.now());
  const list = msgs ?? [];
  const live = call && callWindow(call).open <= Date.now();
  const notes = (past ?? []).filter((c) => c.notes_status === "done" || (c.notes_status === "waiting" && callWindow(c).close > Date.now() - 2 * 3600e3));
  const paths = list.filter((m) => m.audio_path).map((m) => m.audio_path);
  const urls = {};
  if (paths.length) {
    const { data } = await db.storage.from("voice").createSignedUrls(paths, 3600);
    for (const u of data ?? []) if (u.signedUrl) urls[u.path] = u.signedUrl;
  }
  const draft = $("#msg")?.value ?? "";

  app.innerHTML = `
    <div class="card call">
      <img src="icons/${document.documentElement.dataset.theme === "clarity" ? "logo-clarity" : "logo"}.webp" alt="" width="54" height="54">
      <div class="main">
        <div class="call-title">${call ? `Next call · ${callFmt.format(new Date(call.starts_at))}` : "No call booked"}</div>
        <div class="small muted">${call ? `${esc(call.title)} · ${call.minutes} min` : "Your next check-in call shows up here."}</div>
      </div>
    </div>
    ${live ? `<button class="btn primary block" id="join-call" style="margin-top:8px">${ICO.video}Join call</button>` : ""}
    ${notes.length ? `<div class="call-notes">${notes.map((c) => `<button class="row-btn" data-notes="${c.id}" ${c.notes_status !== "done" ? "disabled" : ""}>
        <span><b>Call notes</b><span class="muted small">${dayFmt.format(new Date(c.starts_at))}${c.notes_status !== "done" ? " · Writing…" : ""}</span></span>${c.notes_status === "done" ? ICO.chevR : ""}</button>`).join("")}</div>` : ""}
    <h3>Messages</h3>
    <div class="bubbles" id="bubbles">
      ${list.length ? list.map((m) => msgBubble(m, urls)).join("")
        : `<p class="empty">Send your coach a message or a voice note. Tell them how a workout felt, or ask anything.</p>`}
    </div>
    <form class="composer" id="cmp">
      <input class="input" id="msg" placeholder="Message your coach" aria-label="Message your coach" autocomplete="off" value="${esc(draft)}">
      <button class="send" id="cmp-btn" aria-label="Send"></button>
    </form>`;
  document.body.classList.add("has-composer");
  const btn = $("#cmp-btn");
  const setBtn = () => {
    const mic = canRecord() && !$("#msg").value.trim();
    btn.innerHTML = mic ? ICO.mic : ICO.send;
    btn.setAttribute("aria-label", mic ? "Record a voice message" : "Send");
    btn.dataset.mode = mic ? "mic" : "send";
  };
  setBtn();
  $("#msg").addEventListener("input", setBtn);
  app.querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", () => openViewer(b.dataset.demo, { title: b.dataset.title || "Video", start: Number(b.dataset.start) || 0 })));
  $("#join-call")?.addEventListener("click", (e) => joinCall(call, e.currentTarget));
  app.querySelectorAll("[data-notes]").forEach((b) => b.addEventListener("click", () => showNotes((past ?? []).find((c) => c.id === b.dataset.notes))));

  const after = (id) => api("message_sent", { message_id: id }).catch(() => {}).then(() => { if (tab === "coach" && !recNow) renderCoach(); });
  $("#cmp").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (btn.dataset.mode === "mic") return recordVoice();
    const body = $("#msg").value.trim();
    if (!body) return;
    $("#msg").value = "";
    const { data: row, error } = await db.from("messages").insert({ body }).select("id").single();
    if (error) { $("#msg").value = body; return toast(error.message); }
    await renderCoach();
    window.scrollTo(0, document.body.scrollHeight);
    after(row.id);
  });

  async function recordVoice() {
    const cmp = $("#cmp");
    try {
      recNow = await startRecorder((s) => { const t = $("#rec-t"); if (t) t.textContent = mmss(s); if (s >= REC_MAX) sendVoice(); });
    } catch {
      recNow = null;
      return toast("Allow the microphone to send voice messages");
    }
    cmp.innerHTML = `<button type="button" class="rec-x" id="rec-x" aria-label="Cancel recording">✕</button>
      <div class="rec-live"><i></i><span id="rec-t">0:00</span><em>Recording…</em></div>
      <button type="button" class="send" id="rec-send" aria-label="Send voice message">${ICO.send}</button>`;
    $("#rec-x").addEventListener("click", () => { recNow?.cancel(); recNow = null; renderCoach(); });
    $("#rec-send").addEventListener("click", sendVoice);
  }
  async function sendVoice() {
    if (!recNow) return;
    const r = recNow; recNow = null;
    const cmp = $("#cmp");
    if (cmp) cmp.innerHTML = `<div class="rec-live"><span>Sending…</span></div>`;
    const clip = await r.stop();
    if (clip.blob.size < 800) { toast("That was too short"); return renderCoach(); }
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${clip.ext}`;
    const up = await db.storage.from("voice").upload(path, clip.blob, { contentType: clip.type, upsert: false });
    if (up.error) { toast("Couldn't send the voice message"); console.error(up.error); return renderCoach(); }
    const { data: row, error } = await db.from("messages").insert({ audio_path: path, audio_sec: clip.sec, transcript_status: "pending" }).select("id").single();
    if (error) { toast(error.message); return renderCoach(); }
    await renderCoach();
    window.scrollTo(0, document.body.scrollHeight);
    after(row.id);
  }

  const unread = list.filter((m) => m.from_coach && !m.read_at).map((m) => m.id);
  if (unread.length) await db.from("messages").update({ read_at: new Date().toISOString() }).in("id", unread);
  refreshDot();

  // Pick up new messages while this tab is open.
  clearInterval(msgPoll);
  const lastId = list.at(-1)?.id ?? null;
  const pending = list.some((m) => m.transcript_status === "pending");
  msgPoll = setInterval(async () => {
    if (tab !== "coach") return clearInterval(msgPoll);
    if (document.hidden || recNow || $("#msg")?.value.trim()) return;
    const { data } = await db.from("messages").select("id, transcript_status").order("created_at", { ascending: false }).limit(1);
    const top = data?.[0];
    if ((top?.id ?? null) !== lastId || (pending && top?.transcript_status !== "pending")) renderCoach();
  }, 12000);
}

const feelLabel = (list, v) => list.find(([k]) => k === v)?.[1] ?? "";
function feelBadge(m) {
  const bits = [m.energy && feelLabel(ENERGY, m.energy), m.stomach && feelLabel(STOMACH, m.stomach)].filter(Boolean);
  return bits.length ? bits.join(" · ") : "";
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
    <div class="field"><span class="muted small">Meal</span>
      <div class="seg seg-wide meal-pick" id="mv">${MEALS.map(([k, l]) => `<button type="button" data-meal="${k}" aria-pressed="${k === mealOf(m)}">${l}</button>`).join("")}</div></div>
    <button class="btn danger block" id="del">Delete this entry</button>`);
  $("#mv", body).addEventListener("click", async (e) => {
    const b = e.target.closest("[data-meal]");
    if (!b || b.getAttribute("aria-pressed") === "true") return;
    const { error } = await db.from("meals").update({ meal: b.dataset.meal }).eq("id", id);
    if (error) return toast(error.message);
    $("#mv", body).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    toast(`Moved to ${mealLabel(b.dataset.meal)}`);
    if (tab === "food") renderFood();
  });
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
// Search: My foods instantly, then the USDA database; "Describe it" for mixed meals
// ---------------------------------------------------------------------------
function openSearch() {
  const body = openSheet(`
    <h2>Search foods</h2>
    <label class="search s-big">${ICO.search}<input id="sq" type="search" placeholder="Greek yogurt, banana, Chobani…" autocomplete="off" enterkeyhint="search"></label>
    <div id="sr"></div>
    <button class="btn block" id="describe" style="margin-top:14px">${ICO.type}Describe it instead</button>
    <p class="small muted" style="text-align:center;margin-top:8px">Best for mixed or homemade meals, like "burrito bowl with rice and beans".</p>`);
  const input = $("#sq", body);
  let mine = [], hits = null, state = "idle", timer = null, seq = 0, provider = null;

  const kcalLine = (h) => {
    if (h.perServingOnly) return `${r0(h.per100.kcal)} cal · ${esc(h.servings[0]?.label ?? "1 serving")}`;
    const s = h.servings[0];
    return s ? `${r0((h.per100.kcal * s.grams) / 100)} cal · ${esc(s.label)}` : `${r0(h.per100.kcal)} cal · 100 g`;
  };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const my = (q ? mine.filter((f) => f.name.toLowerCase().includes(q)) : mine).slice(0, q ? 6 : 8);
    let html = "";
    if (my.length) html += `<h3>${q ? "My foods" : "Recent"}</h3><div class="card s-list"><ul class="list">${my.map((f) => `
      <li><button class="row" data-mine="${f.id}">
        <div class="thumb" ${f.thumb ? `style="background-image:url('${f.thumb}')"` : ""}>${f.thumb ? "" : "🍽"}</div>
        <div class="main"><div class="name">${esc(f.name)}</div><div class="meta">${macroLine(f.nutrients)}</div></div>
      </button></li>`).join("")}</ul></div>`;
    if (q.length >= 2) {
      html += `<h3>Food database</h3>`;
      if (state === "loading") html += `<p class="small muted">Searching…</p>`;
      else if (state === "busy") html += `<p class="small muted">The food database is busy right now. Try again in a bit, or describe it instead.</p>`;
      else if (state === "error") html += `<p class="small muted">Couldn't search right now. Describe it instead, or try again.</p>`;
      else if (hits?.length) html += `<div class="card s-list"><ul class="list">${hits.map((h, i) => `
        <li><button class="row" data-hit="${i}">
          <div class="main"><div class="name">${esc(h.name)}</div>
          <div class="meta">${h.brand ? `<b>${esc(h.brand)}</b> · ` : ""}${kcalLine(h)}</div></div>
          <div class="end">›</div>
        </button></li>`).join("")}</ul></div>
        ${provider === "fatsecret" ? `<p class="fs-attr"><a href="https://www.fatsecret.com" target="_blank" rel="noopener">Powered by fatsecret</a></p>` : ""}`;
      else if (state === "done") html += `<p class="small muted">No matches. Try fewer words, or describe it instead.</p>`;
    } else if (!my.length) html += `<p class="small muted" style="margin-top:12px">Start typing to search.</p>`;
    $("#sr", body).innerHTML = html;
  };

  db.from("foods").select("*").order("last_logged_at", { ascending: false, nullsFirst: false }).limit(300)
    .then(({ data }) => { mine = data ?? []; draw(); });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { state = "idle"; hits = null; return draw(); }
    state = "loading";
    draw();
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const r = await api("food_search", { q });
        if (my !== seq) return;
        hits = r.results ?? [];
        provider = r.provider ?? null;
        state = r.busy ? "busy" : "done";
      } catch { if (my === seq) state = "error"; }
      if (my === seq) draw();
    }, 450);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  $("#sr", body).addEventListener("click", (e) => {
    const m = e.target.closest("[data-mine]");
    if (m) return openFood(mine.find((f) => f.id === m.dataset.mine));
    const h = e.target.closest("[data-hit]");
    if (h) return openDbFood(hits[Number(h.dataset.hit)]);
  });
  $("#describe", body).addEventListener("click", () => {
    const text = input.value.trim();
    if (text.length > 2) analyze({ text }, { source: "text" });
    else openTextLog();
  });
  setTimeout(() => input.focus(), 50);
}

// A database result: pick the serving and how many, then which meal.
function openDbFood(hit) {
  // Foods without a gram weight are counted in servings only.
  const opts = hit.perServingOnly ? hit.servings : [...hit.servings, { label: "100 g", grams: 100 }, { label: "Grams", grams: 1, custom: true }];
  let sel = 0;
  const body = openSheet(`
    <h2>${esc(hit.name)}</h2>
    ${hit.brand ? `<p class="muted small" style="margin-top:-4px">${esc(hit.brand)}</p>` : ""}
    <div class="grid2">
      <label class="field"><span>Serving</span><select class="input" id="ds">${opts.map((o, i) => `<option value="${i}">${esc(o.label)}</option>`).join("")}</select></label>
      <label class="field"><span id="dq-l">How many</span><input class="input" id="dq" type="number" inputmode="decimal" min="0.25" step="0.25" value="1"></label>
    </div>
    ${mealPickerHtml()}
    <label class="field"><span>When</span><input class="input" id="at" type="datetime-local" value="${defaultWhen()}"></label>
    <div class="card totals" id="tot"></div>
    <button class="btn primary block" id="log">Log it</button>
    <p class="small muted" style="text-align:center;margin-top:8px">${hit.id?.startsWith("fs:") ? `Nutrition data from <a href="https://www.fatsecret.com" target="_blank" rel="noopener">fatsecret</a>` : "From the USDA food database"}. It'll be saved to My foods too.</p>`);
  const qty = () => Math.max(0, Number($("#dq", body).value) || 0);
  const grams = () => (opts[sel].custom ? qty() : opts[sel].grams * qty());
  const draw = () => {
    const t = Object.fromEntries(KEYS.map((k) => [k, ((hit.per100[k] ?? 0) * grams()) / 100]));
    $("#tot", body).innerHTML = `
      <div><b>${r0(t.kcal)}</b><span>calories</span></div><div><b>${r0(t.protein)}g</b><span>protein</span></div>
      <div><b>${r0(t.carbs)}g</b><span>carbs</span></div><div><b>${r0(t.fat)}g</b><span>fat</span></div>`;
  };
  $("#ds", body).addEventListener("change", (e) => {
    sel = Number(e.target.value);
    const custom = !!opts[sel].custom;
    $("#dq-l", body).textContent = custom ? "Grams" : "How many";
    $("#dq", body).value = custom ? 100 : 1;
    $("#dq", body).step = custom ? 1 : 0.25;
    draw();
  });
  $("#dq", body).addEventListener("input", draw);
  draw();
  const pickedMeal = bindMealPicker(body);
  $("#log", body).addEventListener("click", async () => {
    if (!(grams() > 0)) return toast("Enter an amount");
    const meal = pickedMeal();
    if (!meal) return;
    $("#log", body).disabled = true;
    const custom = !!opts[sel].custom;
    const g = custom ? qty() : opts[sel].grams;
    const servings = custom ? 1 : qty();
    const label = custom ? `${r0(g)} g` : opts[sel].label;
    const perGram = Object.fromEntries(KEYS.map((k) => [k, (hit.per100[k] ?? 0) / 100]));  // per serving-unit when perServingOnly
    const per = Object.fromEntries(KEYS.map((k) => [k, perGram[k] * g]));
    const name = hit.brand ? `${hit.name} (${hit.brand})` : hit.name;
    // Same food and serving as before? Reuse it so My foods doesn't fill with copies.
    let { data: food } = await db.from("foods").select("*").eq("ext_id", hit.id).eq("portion_label", label).limit(1).maybeSingle();
    if (!food) {
      const ins = await db.from("foods").insert({
        name, portion_label: label, ext_id: hit.id, source: "search",
        components: [{ name, portion: label, grams: hit.perServingOnly ? null : g, nutrients: per, per_gram: hit.perServingOnly ? null : perGram, source: hit.id?.startsWith("fs:") ? "fatsecret" : "usda" }],
        nutrients: per, tags: [],
      }).select().single();
      if (ins.error) { $("#log", body).disabled = false; return toast(ins.error.message); }
      food = ins.data;
    }
    await logFood(food, servings, new Date($("#at", body).value || Date.now()), meal);
  });
}

// ---------------------------------------------------------------------------
// Barcode scanning (camera + Chrome's built-in barcode reader, or the ZXing reader on iPhone; Open Food Facts lookup)
// ---------------------------------------------------------------------------
let scanStream = null;
let scanTimer = null;
function stopScanner() {
  clearTimeout(scanTimer);
  scanTimer = null;
  scanStream?.getTracks().forEach((t) => t.stop());
  scanStream = null;
}

// iPhone Safari has no built-in barcode reader, so load ZXing (WebAssembly) there, only when scanning.
const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
async function barcodeReader() {
  if ("BarcodeDetector" in window) {
    const formats = (await BarcodeDetector.getSupportedFormats()).filter((f) => BARCODE_FORMATS.includes(f));
    if (formats.length) return new BarcodeDetector({ formats });
  }
  const m = await import("https://cdn.jsdelivr.net/npm/barcode-detector@3.2.4/dist/es/ponyfill.js");
  return new m.BarcodeDetector({ formats: BARCODE_FORMATS });
}

async function openScanner() {
  const supported = !!navigator.mediaDevices?.getUserMedia;
  const body = openSheet(`
    <h2>Scan a barcode</h2>
    ${supported ? `<div class="scan-box"><video id="cam" playsinline muted autoplay></video><div class="scan-line"></div></div>
      <p class="small muted" style="text-align:center">Hold the barcode inside the box.</p>` :
      `<p class="small muted">This browser can't open the camera. Type the number under the barcode instead.</p>`}
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
    // Start the camera and load the reader at the same time; keep hold of the camera so it always gets stopped.
    const cam = navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false })
      .then((st) => (scanStream = st));
    const detector = await barcodeReader().catch(async (e) => { await cam.catch(() => {}); throw e; });
    await cam;
    if (!$("#cam", body)) return stopScanner();  // sheet was closed while the camera was starting
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
    if (box) box.outerHTML = `<p class="small muted">${err?.name === "NotAllowedError" ? "Camera permission was blocked" : err?.name === "NotFoundError" ? "Couldn't find a camera" : "Couldn't start the scanner"}. You can type the number instead.</p>`;
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
      <div class="seg seg-serv" id="sv">${servingButtons()}</div></div>
    ${mealPickerHtml()}
    <label class="field"><span>When</span><input class="input" id="at" type="datetime-local" value="${defaultWhen()}"></label>
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

  const pickedMeal = bindMealPicker(body);
  $("#save", body).addEventListener("click", async () => {
    if (!items.length) return toast("Nothing to save");
    const meal = pickedMeal();
    if (!meal) return;
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
    await logFood(food, servings, new Date($("#at", body).value || Date.now()), meal);
  });
}

async function logFood(food, servings, eatenAt, meal) {
  const { error } = await db.from("meals").insert({
    meal,
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
  toast(`Logged to ${mealLabel(meal)}`);
  foodSeg = "today";
  foodDay = ymd(eatenAt) === ymd() ? null : ymd(eatenAt);
  logTo = { day: null, meal: null };
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

// Serving choices for saved foods and photo logs: ½ up to 5.
const SERVINGS = [0.5, 1, 1.5, 2, 3, 4, 5];
const servingButtons = () => SERVINGS.map((v) => `<button type="button" data-v="${v}" aria-pressed="${v === 1}" aria-label="${v} serving${v === 1 ? "" : "s"}">${v === 0.5 ? "½" : v === 1.5 ? "1½" : v}</button>`).join("");

function openFood(food) {
  let servings = 1;
  const body = openSheet(`
    <h2>${esc(food.name)}</h2>
    <p class="muted small">${esc(food.portion_label || "")}</p>
    <div class="field"><span class="muted small">Servings</span>
      <div class="seg seg-serv" id="sv">${servingButtons()}</div></div>
    ${mealPickerHtml()}
    <label class="field"><span>When</span><input class="input" id="at" type="datetime-local" value="${defaultWhen()}"></label>
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
  const pickedMeal = bindMealPicker(body);
  $("#log", body).addEventListener("click", () => {
    const meal = pickedMeal();
    if (meal) logFood(food, servings, new Date($("#at", body).value || Date.now()), meal);
  });
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
      <p class="small" style="margin-top:0">${isCoach ? "Messages from clients, patterns when they show up, and your Sunday summary." : "Messages from your coach."}</p>
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
// iPhone has no install button: show how to add it to the home screen (only in Safari, not once installed).
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const SHARE_I = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function iosInstallTip() {
  if (!isIOS() || standalone()) return "";
  return `<div class="ios-tip"><b>Add BraticaFit to your home screen first</b>
    <span>In Safari, tap Share ${SHARE_I} then <b>Add to Home Screen</b>. Open it from your home screen and sign in there.</span></div>`;
}

// Install prompt (Android Chrome)
// ---------------------------------------------------------------------------
let deferredInstall = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; showInstallBar(); });
function showInstallBar() {
  const slot = $("#install-slot");
  if (!slot || standalone()) return;
  try { if (localStorage.getItem("psh-install-x")) return; } catch {}
  if (!deferredInstall && isIOS()) {
    slot.innerHTML = `<div class="install-bar"><span><b>Install BraticaFit</b>Tap Share ${SHARE_I} then Add to Home Screen</span>
      <button class="x" id="inst-x" aria-label="Not now">×</button></div>`;
    $("#inst-x").addEventListener("click", () => { try { localStorage.setItem("psh-install-x", "1"); } catch {} slot.innerHTML = ""; });
    return;
  }
  if (!deferredInstall) return;
  slot.innerHTML = `<div class="install-bar"><span><b>Install BraticaFit</b>Your workouts and coach on your home screen</span>
    <button class="btn primary" id="inst">Install</button><button class="x" id="inst-x" aria-label="Not now">×</button></div>`;
  $("#inst").addEventListener("click", async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; slot.innerHTML = ""; });
  $("#inst-x").addEventListener("click", () => { try { localStorage.setItem("psh-install-x", "1"); } catch {} slot.innerHTML = ""; });
}

// ---------------------------------------------------------------------------
// Deep links from notifications: #checkin=<meal id>, #obs=<observation id>
// ---------------------------------------------------------------------------
async function handleHash() {
  const h = location.hash.slice(1);
  if (/^coach(=[\w.-]+)?$/.test(h) && user && isCoach) {
    history.replaceState(null, "", location.pathname + location.search);
    await go(tab); openCoachMode(h.split("=")[1]); return true;
  }
  if (h === "msg" && user) { history.replaceState(null, "", location.pathname + location.search); await go("coach"); return true; }
  if (!h || !user || !/^(checkin|obs)=/.test(h)) return false;
  history.replaceState(null, "", location.pathname + location.search);
  const [k, v] = h.split("=");
  if (k === "checkin" && v) { await go(features.food ? "food" : "today"); if (features.food) openMeal(v); return true; }
  if (k === "obs" && v) { tab = "progress"; markTab(); await renderProgress(); openObservation(v); return true; }
  return false;
}
// Coach mode lives in coach.js and is only fetched for the coach's account.
async function openCoachMode(view) {
  if (!isCoach) return;
  try {
    const m = await import("./coach.js?v=16");
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
  if (setupToken) return renderSetup();
  if (!user) return renderSignIn();
  if (afterSignIn === "newpw") { afterSignIn = null; return renderNewPassword(session); }
  if (afterSignIn === "install") { afterSignIn = null; if (installStepNeeded()) return renderInstallStep(session); }
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
  features = { food: true, weight: true, targets_edit: true, move_days: true };
  if (!isCoach) {
    const { data: s } = await db.rpc("my_settings");
    Object.assign(features, s ?? {});
  }
  $('#tabs button[data-tab="food"]').hidden = !features.food;
  applyTheme(isCoach ? "gym" : features.theme || "clarity");  // Clarity unless a client is set to Gym
  // Which version of Precision Nutrition demos to show: men's if their targets say male, otherwise women's.
  const [{ data: nt }] = await Promise.all([db.from("nutrition_targets").select("sex").maybeSingle(), loadPnInfo()]);
  demoVer = nt?.sex === "male" ? "men" : "women";
  claimThisDevice();
  $("#tabs").hidden = false;
  $("#settings").hidden = false;
  if (!(await handleHash())) await go(tab);
  armBack();
  refreshDot();
}

// The look the coach picked for this client: "gym" (default, dark) or "clarity" (the braticafit.com look).
function applyTheme(theme) {
  const t = theme === "gym" ? "gym" : "clarity";
  if (t === "clarity") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === "clarity" ? "#F9F9F8" : "#0d0d0d";
  const mark = document.querySelector(".wordmark");
  if (mark) mark.src = t === "clarity" ? "icons/wordmark-clarity.webp" : "icons/wordmark.webp";
  try { localStorage.setItem("bf-theme", t); } catch {}
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
