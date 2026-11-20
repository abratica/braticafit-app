// Coach Inbox: one thread per client. Voice notes with transcripts, suggested videos
// (coach-only) that attach in one tap, and text / voice / video replies.

const REC_MAX = 180;
const recMime = () => ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/aac"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const stamp = (iso) => {
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString() ? timeFmt.format(d) : `${dayFmt.format(d)}, ${timeFmt.format(d)}`;
};
const shortStamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? timeFmt.format(d) : dayFmt.format(d);
};

export function createInbox(ctx) {
  const { db, esc, toast, SVG, IC, st, root, api, thumbOf, openPlayer, loadPN } = ctx;
  const ib = (st.inbox ??= { threads: [], open: null, msgs: [], urls: {}, attach: null, clip: null, rec: null, sig: "", draft: "" });

  // ---------- data ----------
  async function loadThreads() {
    const { data, error } = await db.rpc("coach_inbox");
    if (error) { toast(error.message); return; }
    ib.threads = data ?? [];
    st.unread = ib.threads.reduce((n, t) => n + Number(t.unread || 0), 0);
  }
  async function loadThread() {
    if (!ib.open) { ib.msgs = []; return; }
    const { data, error } = await db.rpc("coach_thread", { p_client: ib.open });
    if (error) { toast(error.message); ib.msgs = []; return; }
    ib.msgs = data ?? [];
    const need = ib.msgs.filter((m) => m.audio_path && !ib.urls[m.audio_path]).map((m) => m.audio_path);
    if (need.length) {
      const { data: signed } = await db.storage.from("voice").createSignedUrls(need, 3600);
      for (const u of signed ?? []) if (u.signedUrl) ib.urls[u.path] = u.signedUrl;
    }
    const t = ib.threads.find((x) => x.user_id === ib.open);
    if (t && t.unread) { st.unread = Math.max(0, (st.unread || 0) - t.unread); t.unread = 0; }
  }
  const sigOf = () => JSON.stringify([ib.threads.map((t) => [t.user_id, t.last_at, t.unread]), ib.msgs.map((m) => [m.id, m.transcript_status, (m.suggestions || []).length, !!m.read_at])]);

  // ---------- view ----------
  async function view() {
    await loadThreads();
    if (!ib.open && window.innerWidth > 800) ib.open = ib.threads.find((t) => t.last_at)?.user_id ?? null;
    if (ib.open && !ib.threads.some((t) => t.user_id === ib.open)) ib.open = null;
    await loadThread();
    ib.sig = sigOf();
    startPoll();
    return `
      <header class="c-head"><div><p class="c-eyebrow">Messages</p><h1>Inbox</h1></div></header>
      <div class="ib ${ib.open ? "has-open" : ""}">
        <aside class="ib-list" id="ib-list">${listHtml()}</aside>
        <section class="ib-thread" id="ib-thread">${threadHtml()}</section>
      </div>`;
  }

  function listHtml() {
    if (!ib.threads.length) return `<p class="c-empty-line">No clients yet. Once clients join, their messages land here.</p>`;
    return ib.threads.map((t) => `
      <button class="ib-row ${t.user_id === ib.open ? "on" : ""} ${t.unread ? "new" : ""}" data-ib-open="${t.user_id}">
        <span class="ib-av">${esc((t.name || "?").trim()[0] || "?").toUpperCase()}</span>
        <span class="ib-mid"><b>${esc(t.name)}</b><span>${t.last_at ? `${t.last_from_coach ? "You: " : ""}${t.last_voice ? "🎤 " : ""}${esc((t.last_text || "").slice(0, 70))}` : "No messages yet"}</span></span>
        <span class="ib-end"><time>${shortStamp(t.last_at)}</time>${t.unread ? `<i class="c-badge hot">${t.unread}</i>` : ""}</span>
      </button>`).join("");
  }

  function bubble(m) {
    const coach = m.from_coach;
    const audio = m.audio_path ? `<audio controls preload="metadata" src="${esc(ib.urls[m.audio_path] || "")}"></audio>` : "";
    const tx = m.audio_path ? (m.transcript ? `<p class="ib-tx">${esc(m.transcript)}</p>`
      : m.transcript_status === "pending" ? `<p class="ib-tx muted">Transcribing…</p>` : m.transcript_status === "failed" ? `<p class="ib-tx muted">No transcript</p>` : "") : "";
    const vid = m.video_id ? `<button class="ib-vid" data-ib-watch="${esc(m.video_id)}"><span class="ib-vth" style="background-image:url('${esc(m.video_thumb || thumbOf(m.video_id))}')">${SVG(IC.play, 14)}</span><b>${esc(m.video_title || "Video")}${m.video_start ? ` <em>from ${mmss(m.video_start)}</em>` : ""}</b></button>` : "";
    const sugg = !coach && (m.suggestions || []).length ? `
      <div class="ib-sugg"><p class="ib-sugg-h">${SVG(IC.star, 14)} Suggested videos <span>only you see these</span></p>
        ${m.suggestions.map((s, i) => `<div class="ib-s">
          <button class="ib-s-th" data-ib-watch="${esc(s.video_id)}" style="background-image:url('${esc(s.thumb || thumbOf(s.video_id))}')" aria-label="Watch ${esc(s.name)}">${SVG(IC.play, 14)}</button>
          <div class="ib-s-txt"><b>${esc(s.name)}</b><span>${esc(s.why || "")}</span><em>${s.kind === "education" ? "Education · " : ""}${s.source === "library" ? "Your Library" : "Precision Nutrition"}${s.start_sec ? ` · from ${mmss(s.start_sec)}` : ""}</em></div>
          <button class="btn ghost ib-s-go" data-ib-attach="${m.id}:${i}">Attach</button></div>`).join("")}
      </div>` : "";
    return `<div class="ib-b ${coach ? "me" : "them"}">
      <div class="ib-bb">${m.body ? `<p class="ib-text">${esc(m.body)}</p>` : ""}${audio}${tx}${vid}</div>
      <span class="ib-meta">${stamp(m.created_at)}${coach ? (m.read_at ? " · Seen" : "") : ""}</span>${sugg}</div>`;
  }

  function threadHtml() {
    const t = ib.threads.find((x) => x.user_id === ib.open);
    if (!t) return `<div class="ib-none"><p>Pick a client to see your messages.</p></div>`;
    return `
      <div class="ib-head"><button class="c-icon ib-back" data-ib-back aria-label="Back to all messages">${SVG(IC.back ?? '<path d="M15 5l-7 7 7 7"/>', 18)}</button>
        <b>${esc(t.name)}</b><button class="c-link" data-open-client="${t.user_id}">Client page</button></div>
      <div class="ib-msgs" id="ib-msgs">${ib.msgs.length ? ib.msgs.map(bubble).join("") : `<p class="c-empty-line">No messages with ${esc(t.name)} yet. Say hi.</p>`}</div>
      <div class="ib-cmp" id="ib-cmp">${composerHtml()}</div>`;
  }

  function composerHtml() {
    const a = ib.attach;
    const chips = [
      a ? `<div class="ib-chip"><span class="ib-vth" style="background-image:url('${esc(a.thumb || thumbOf(a.video_id))}')"></span><b>${esc(a.name)}${a.start_sec ? ` <em>from ${mmss(a.start_sec)}</em>` : ""}</b>
          ${a.alt_id ? `<span class="c-mode ib-ver"><button data-ib-ver="men" aria-pressed="${a.ver !== "women"}">Men's</button><button data-ib-ver="women" aria-pressed="${a.ver === "women"}">Women's</button></span>` : ""}
          <button class="c-icon" data-ib-unattach aria-label="Remove video">${SVG(IC.x, 15)}</button></div>` : "",
      ib.clip ? `<div class="ib-chip"><audio controls src="${ib.clip.url}"></audio><span>${mmss(ib.clip.sec)}</span><button class="c-icon" data-ib-unclip aria-label="Delete voice note">${SVG(IC.x, 15)}</button></div>` : "",
    ].join("");
    if (ib.rec) return `${chips}<div class="ib-row2"><div class="ib-rec"><i></i><span id="ib-rec-t">${mmss(ib.rec.sec || 0)}</span> Recording…</div>
      <button class="btn ghost" data-ib-rec-cancel>Cancel</button><button class="btn primary" data-ib-rec-stop>Done</button></div>`;
    return `${chips}
      <textarea id="ib-text" rows="2" placeholder="Write a reply">${esc(ib.draft)}</textarea>
      <div class="ib-row2">
        <button class="btn ghost" data-ib-pick>${SVG(IC.library, 16)}Video</button>
        ${navigator.mediaDevices?.getUserMedia && window.MediaRecorder ? `<button class="btn ghost" data-ib-rec ${ib.clip ? "disabled" : ""}>${SVG(IC.mic ?? '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>', 16)}Voice</button>` : ""}
        <span class="grow"></span>
        <button class="btn primary" data-ib-send>Send</button>
      </div>`;
  }

  // ---------- in-place updates ----------
  function paint({ list = true, thread = true, keepScroll = false } = {}) {
    const L = root.querySelector("#ib-list"), T = root.querySelector("#ib-thread");
    if (!T) return;
    if (list && L) L.innerHTML = listHtml();
    const box = root.querySelector(".ib");
    box?.classList.toggle("has-open", !!ib.open);
    if (thread) {
      const prev = root.querySelector("#ib-msgs");
      const atBottom = prev ? prev.scrollHeight - prev.scrollTop - prev.clientHeight < 80 : true;
      const top = prev?.scrollTop;
      T.innerHTML = threadHtml();
      const now = root.querySelector("#ib-msgs");
      if (now) now.scrollTop = keepScroll && !atBottom ? top : now.scrollHeight;
    }
    badge();
  }
  const paintComposer = () => {
    const c = root.querySelector("#ib-cmp");
    if (c) c.innerHTML = composerHtml();
    root.querySelector("#ib-text")?.focus();
  };
  function badge() {
    const b = root.querySelector('[data-nav="inbox"]');
    if (!b) return;
    let i = b.querySelector(".c-badge");
    if (!st.unread) { i?.remove(); return; }
    if (!i) { i = document.createElement("i"); i.className = "c-badge hot"; b.appendChild(i); }
    i.textContent = st.unread;
  }

  let poll = null;
  function startPoll() {
    clearInterval(poll);
    poll = setInterval(async () => {
      if (!root.isConnected) return clearInterval(poll);
      if (document.hidden) return;
      if (st.view !== "inbox") {
        const { data } = await db.rpc("coach_unread");
        st.unread = data || 0; badge();
        return;
      }
      if (ib.rec) return;
      await loadThreads(); await loadThread();
      const sig = sigOf();
      if (sig !== ib.sig) { ib.sig = sig; ib.draft = root.querySelector("#ib-text")?.value ?? ib.draft; paint({ keepScroll: true }); }
    }, 10000);
  }

  // ---------- recording ----------
  async function startRec() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return toast("Allow the microphone to record a voice note"); }
    const mime = recMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const t0 = Date.now();
    ib.rec = { rec, stream, chunks, t0, sec: 0, mime };
    rec.start(250);
    ib.rec.timer = setInterval(() => {
      if (!ib.rec) return;
      ib.rec.sec = Math.floor((Date.now() - t0) / 1000);
      const el = root.querySelector("#ib-rec-t");
      if (el) el.textContent = mmss(ib.rec.sec);
      if (ib.rec.sec >= REC_MAX) stopRec(true);
    }, 250);
    ib.draft = root.querySelector("#ib-text")?.value ?? ib.draft;
    paintComposer();
  }
  async function stopRec(keep) {
    const r = ib.rec;
    if (!r) return;
    ib.rec = null;
    clearInterval(r.timer);
    const stopped = new Promise((res) => (r.rec.onstop = res));
    if (r.rec.state !== "inactive") r.rec.stop();
    await stopped;
    r.stream.getTracks().forEach((t) => t.stop());
    if (keep) {
      const type = (r.rec.mimeType || r.mime || "audio/webm").split(";")[0];
      const blob = new Blob(r.chunks, { type });
      if (blob.size < 800) toast("That was too short");
      else ib.clip = { blob, type, sec: Math.max(1, Math.round((Date.now() - r.t0) / 1000)), url: URL.createObjectURL(blob), ext: /mp4|aac/.test(type) ? "m4a" : "webm" };
    }
    paintComposer();
  }

  // ---------- send ----------
  async function send(btn) {
    const text = root.querySelector("#ib-text")?.value.trim() ?? "";
    const a = ib.attach, clip = ib.clip, client = ib.open;
    if (!text && !a && !clip) return toast("Write something, record a voice note, or attach a video");
    btn.disabled = true;
    let path = null;
    if (clip) {
      path = `${client}/${Date.now()}-coach.${clip.ext}`;
      const up = await db.storage.from("voice").upload(path, clip.blob, { contentType: clip.type, upsert: false });
      if (up.error) { btn.disabled = false; return toast("Couldn't upload the voice note"); }
    }
    const vid = a ? (a.ver === "women" && a.alt_id ? a.alt_id : a.video_id) : null;
    const { data: id, error } = await db.rpc("coach_send", {
      p_client: client, p_body: text || null, p_audio_path: path, p_audio_sec: clip?.sec ?? null,
      p_video_id: vid, p_video_title: a ? a.name : null, p_video_thumb: a ? (st.thumbs[vid] || a.thumb || null) : null, p_video_start: a?.start_sec || null,
    });
    if (error) { btn.disabled = false; return toast(error.message); }
    if (clip) URL.revokeObjectURL(clip.url);
    ib.attach = null; ib.clip = null; ib.draft = "";
    await loadThreads(); await loadThread();
    ib.sig = sigOf();
    paint();
    api("message_sent", { message_id: id }).then(async () => {
      if (st.view !== "inbox" || ib.open !== client) return;
      await loadThread(); ib.sig = sigOf(); paint({ list: false, keepScroll: true });
    }).catch(() => {});
  }

  // ---------- video picker ----------
  async function openPicker() {
    await loadPN();
    const m = root.querySelector("#c-modal");
    const draw = (q = "") => {
      const ql = q.trim().toLowerCase();
      const match = (s) => !ql || ql.split(/\s+/).every((w) => s.toLowerCase().includes(w));
      const lib = [], seen = new Set();
      for (const d of st.demos) if (!seen.has(d.video_id) && match(`${d.exercise_name} ${d.title || ""}`)) { seen.add(d.video_id); lib.push({ video_id: d.video_id, name: d.exercise_name, sub: `${d.kind === "education" ? "Education · " : ""}${d.title || ""}`, thumb: d.thumb, start_sec: d.start_sec || null }); }
      const pn = [];
      if (ql) for (const v of st.pn?.items ?? []) {
        if (v.version !== "men" && st.pn.byName.has(v.name.toLowerCase() + "|men")) continue;
        if (match(v.name) && !seen.has(v.id)) {
          const alt = st.pn.byName.get(v.name.toLowerCase() + "|women");
          pn.push({ video_id: v.id, alt_id: alt && alt.id !== v.id ? alt.id : null, name: v.name, sub: `Precision Nutrition · ${v.pattern || ""}` });
        }
      }
      const row = (x) => `<button class="ib-pick" data-ib-take='${esc(JSON.stringify(x))}'><span class="ib-vth" style="background-image:url('${esc(x.thumb || thumbOf(x.video_id))}')"></span><span><b>${esc(x.name)}</b><em>${esc(x.sub)}</em></span></button>`;
      return `${lib.length ? `<p class="ib-pick-h">Your Library</p>${lib.slice(0, 40).map(row).join("")}` : ""}
        ${pn.length ? `<p class="ib-pick-h">Precision Nutrition</p>${pn.slice(0, 40).map(row).join("")}` : ""}
        ${!lib.length && !pn.length ? `<p class="c-empty-line">${ql ? "Nothing matches." : "Your Library is empty. Search to find Precision Nutrition videos."}</p>` : ""}`;
    };
    m.innerHTML = `<div class="c-modal-bg" data-close></div>
      <div class="c-modal-box narrow" role="dialog" aria-modal="true" aria-label="Attach a video">
        <button class="c-icon c-close" data-close aria-label="Close">${SVG(IC.x, 20)}</button>
        <h2 class="ib-pick-title">Attach a video</h2>
        <label class="c-search">${SVG(IC.search, 17)}<span class="sr">Search</span><input id="ib-pq" placeholder="Search your Library and Precision Nutrition" autocomplete="off"></label>
        <div class="ib-pick-list" id="ib-pl">${draw()}</div>
      </div>`;
    m.hidden = false;
    const q = m.querySelector("#ib-pq");
    q.focus();
    q.addEventListener("input", () => { m.querySelector("#ib-pl").innerHTML = draw(q.value); });
  }

  // ---------- events (delegated from coach.js) ----------
  async function onClick(t) {
    if (t.dataset.ibOpen) {
      ib.draft = ""; ib.attach = null;
      ib.open = t.dataset.ibOpen;
      await loadThread(); ib.sig = sigOf();
      paint(); return true;
    }
    if (t.hasAttribute("data-ib-back")) { ib.open = null; paint({ thread: true }); return true; }
    if (t.dataset.ibWatch) { await loadPN(); openPlayer(t.dataset.ibWatch); return true; }
    if (t.dataset.ibAttach) {
      const [mid, i] = t.dataset.ibAttach.split(":");
      const s = ib.msgs.find((m) => m.id === mid)?.suggestions?.[Number(i)];
      if (s) { ib.draft = root.querySelector("#ib-text")?.value ?? ib.draft; ib.attach = { ...s, ver: "men" }; paintComposer(); toast(`Attached ${s.name}`); }
      return true;
    }
    if (t.dataset.ibTake) {
      const x = JSON.parse(t.dataset.ibTake);
      ib.draft = root.querySelector("#ib-text")?.value ?? ib.draft;
      ib.attach = { ...x, ver: "men" };
      const m = root.querySelector("#c-modal"); m.hidden = true; m.innerHTML = "";
      paintComposer(); return true;
    }
    if (t.dataset.ibVer) { ib.draft = root.querySelector("#ib-text")?.value ?? ib.draft; ib.attach.ver = t.dataset.ibVer; paintComposer(); return true; }
    if (t.hasAttribute("data-ib-unattach")) { ib.draft = root.querySelector("#ib-text")?.value ?? ib.draft; ib.attach = null; paintComposer(); return true; }
    if (t.hasAttribute("data-ib-unclip")) { ib.draft = root.querySelector("#ib-text")?.value ?? ib.draft; URL.revokeObjectURL(ib.clip.url); ib.clip = null; paintComposer(); return true; }
    if (t.hasAttribute("data-ib-pick")) { ib.draft = root.querySelector("#ib-text")?.value ?? ib.draft; await openPicker(); return true; }
    if (t.hasAttribute("data-ib-rec")) { await startRec(); return true; }
    if (t.hasAttribute("data-ib-rec-stop")) { await stopRec(true); return true; }
    if (t.hasAttribute("data-ib-rec-cancel")) { await stopRec(false); return true; }
    if (t.hasAttribute("data-ib-send")) { await send(t); return true; }
    return false;
  }

  async function unreadNow() {
    const { data } = await db.rpc("coach_unread");
    st.unread = data || 0;
    startPoll();
  }

  return { view, onClick, unreadNow, stop: () => { clearInterval(poll); if (ib.rec) stopRec(false); } };
}
