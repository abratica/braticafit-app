// Coach Calls: book video calls with clients, join them in the app, and read or fix the
// call notes written from each call's transcript.
import { openCall } from "./call.js?v=1";

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const pad = (n) => String(n).padStart(2, "0");
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
// Same window as the server: from 15 minutes before until an hour after the booked end.
const win = (c) => { const t = new Date(c.starts_at).getTime(); return { open: t - 15 * 60e3, close: t + (c.minutes + 60) * 60e3 }; };
const LENGTHS = [15, 20, 30, 45, 60, 90];

export function createCalls(ctx) {
  const { db, esc, toast, SVG, IC, st, api, render } = ctx;
  const cs = (st.calls ??= { list: [], at: 0 });

  async function load(force = false) {
    if (!force && Date.now() - cs.at < 20e3) return cs.list;
    const from = new Date(Date.now() - 120 * 864e5).toISOString(), to = new Date(Date.now() + 120 * 864e5).toISOString();
    const { data, error } = await db.rpc("coach_calls", { p_from: from, p_to: to });
    if (error) { toast(error.message); return cs.list; }
    cs.list = data ?? []; cs.at = Date.now();
    return cs.list;
  }
  const split = (list) => {
    const now = Date.now();
    return { upcoming: list.filter((c) => win(c).close > now && !c.notes_at), past: list.filter((c) => win(c).close <= now || c.notes_at).reverse() };
  };

  const when = (c) => `${dayFmt.format(new Date(c.starts_at))} · ${timeFmt.format(new Date(c.starts_at))}`;
  function notesState(c) {
    if (c.notes_status === "done") return `<button class="btn ghost sm" data-call-notes="${c.id}">Notes</button>`;
    if (c.notes_status === "waiting" && c.joined_at) return `<span class="c-vm">Writing notes…</span>`;
    if (c.notes_status === "failed") return `<span class="c-vm">Notes didn't work</span>${c.has_transcript ? `<button class="btn ghost sm" data-call-notes="${c.id}">Transcript</button>` : ""}`;
    return `<span class="c-vm">${c.joined_at ? "No notes" : "Nobody joined"}</span>`;
  }
  function row(c, { who = true } = {}) {
    const live = win(c).open <= Date.now() && win(c).close > Date.now();
    const upcoming = win(c).close > Date.now() && !c.notes_at;
    return `<li class="c-call ${live ? "live" : ""}">
      <div class="c-call-when"><b>${esc(when(c))}</b><span>${c.minutes} min</span></div>
      <div class="c-call-what">${who ? `<b>${esc(c.name)}</b>` : ""}<span>${esc(c.title)}</span>
        ${upcoming && !c.consent ? `<em>Will be asked to OK the transcript when joining</em>` : ""}</div>
      <div class="c-call-act">${upcoming
        ? `${live ? `<button class="btn primary sm" data-call-join="${c.id}">${SVG(IC.calls, 16)}Join</button>` : ""}
           ${c.joined_at ? "" : `<button class="btn ghost sm" data-call-edit="${c.id}">Edit</button>`}`
        : notesState(c)}</div></li>`;
  }

  async function view() {
    const { upcoming, past } = split(await load(true));
    return `
      <header class="c-head"><div><p class="c-eyebrow">Video calls</p><h1>Calls</h1></div>
        <div class="c-head-act"><button class="btn primary" data-call-book>${SVG('<path d="M12 5v14M5 12h14"/>', 18)}Book a call</button></div></header>
      <section class="c-card"><h3>Upcoming</h3>
        ${upcoming.length ? `<ul class="c-calls">${upcoming.map((c) => row(c)).join("")}</ul>` : `<p class="c-empty-line">No calls booked.</p>`}</section>
      <section class="c-card"><h3>Past calls</h3>
        ${past.length ? `<ul class="c-calls">${past.slice(0, 40).map((c) => row(c)).join("")}</ul>` : `<p class="c-empty-line">No calls yet.</p>`}</section>`;
  }

  async function todayCard() {
    const list = await load();
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const today = list.filter((c) => win(c).close > Date.now() && new Date(c.starts_at) <= end);
    return `<section class="c-card"><div class="c-card-head"><h3>Today's calls</h3><button class="c-link" data-nav="calls">All calls</button></div>
      ${today.length ? `<ul class="c-calls compact">${today.map((c) => row(c)).join("")}</ul>` : `<p class="c-empty-line">No calls scheduled.</p>`}</section>`;
  }

  async function clientSection(userId) {
    const list = (await load()).filter((c) => c.user_id === userId);
    const { upcoming, past } = split(list);
    return `<section class="c-card"><div class="c-card-head"><h3>Calls</h3><button class="c-link" data-call-book="${userId}">Book a call</button></div>
      ${list.length ? `<ul class="c-calls">${[...upcoming, ...past.slice(0, 10)].map((c) => row(c, { who: false })).join("")}</ul>` : `<p class="c-empty-line">No calls yet.</p>`}</section>`;
  }

  // ---------- book / edit ----------
  function openBook(call, clientId) {
    const people = st.members.filter((m) => m.user_id);
    const start = call ? new Date(call.starts_at) : (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();
    const pick = call?.user_id ?? clientId ?? "";
    const box = document.createElement("div");
    box.className = "c-modal";
    box.innerHTML = `<div class="c-modal-bg" data-x></div>
      <div class="c-modal-box narrow" role="dialog" aria-modal="true">
        <button class="c-icon c-close" data-x aria-label="Close">${SVG(IC.x, 20)}</button>
        <div class="c-modal-info"><h2>${call ? "Edit call" : "Book a call"}</h2>
          <div class="c-form2">
            <label class="wide"><span>Client</span><select id="cb-who">
              ${people.length ? "" : `<option value="">No clients yet</option>`}
              ${people.map((m) => `<option value="${m.user_id}" ${m.user_id === pick ? "selected" : ""}>${esc(m.name || m.email)}</option>`).join("")}
</select></label>
            <label><span>Day</span><input type="date" id="cb-day" value="${localDay(start)}"></label>
            <label><span>Time</span><input type="time" id="cb-time" step="300" value="${localTime(start)}"></label>
            <label><span>Length</span><select id="cb-len">${LENGTHS.map((n) => `<option value="${n}" ${n === (call?.minutes ?? 30) ? "selected" : ""}>${n} min</option>`).join("")}</select></label>
            <label><span>Title</span><input id="cb-title" maxlength="60" value="${esc(call?.title ?? "Check-in call")}"></label>
          </div>
          <div class="c-mail-actions" style="margin-top:16px">
            <button class="btn primary" id="cb-save">${call ? "Save" : "Book call"}</button>
            ${call ? `<button class="btn ghost" id="cb-del">Cancel this call</button>` : ""}
          </div>
          <p class="c-vm">They can join from the Coach tab 15 minutes before the start. Both of you get a reminder 15 minutes before.</p>
        </div>
      </div>`;
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s);
    box.addEventListener("click", async (e) => {
      if (e.target.closest("[data-x]")) return box.remove();
      const b = e.target.closest("button");
      if (b?.id === "cb-save") {
        const who = $("#cb-who").value, day = $("#cb-day").value, time = $("#cb-time").value;
        if (!who || !day || !time) return toast("Pick a client, day and time");
        const at = new Date(`${day}T${time}`);
        if (isNaN(at)) return toast("That time doesn't look right");
        if (!call && at.getTime() < Date.now() - 5 * 60e3) return toast("That time has already passed");
        b.disabled = true;
        const { data: id, error } = await db.rpc("coach_save_call", { p_id: call?.id ?? null, p_client: who, p_starts: at.toISOString(),
          p_minutes: Number($("#cb-len").value), p_title: $("#cb-title").value });
        if (error) { b.disabled = false; return toast(error.message); }
        api("call_booked", { call_id: id, moved: !!call }).catch(() => {});
        box.remove();
        toast(call ? "Call updated" : `Booked for ${dayFmt.format(at)}, ${timeFmt.format(at)}`);
        cs.at = 0;
        return render();
      }
      if (b?.id === "cb-del") {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to cancel it"; return; }
        const { error } = await db.rpc("coach_delete_call", { p_id: call.id });
        if (error) return toast(error.message);
        box.remove(); toast("Call canceled"); cs.at = 0;
        return render();
      }
    });
  }

  // ---------- notes ----------
  async function openNotes(id) {
    const { data: c, error } = await db.rpc("coach_call", { p_id: id });
    if (error || !c) return toast(error?.message || "Couldn't load the call");
    const n = c.notes ?? { summary: "", points: [], actions: [] };
    const box = document.createElement("div");
    box.className = "c-modal";
    const show = () => `
      ${n.summary ? `<p>${esc(n.summary)}</p>` : ""}
      ${n.points?.length ? `<h3>What we covered</h3><ul class="c-notes">${n.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
      ${n.actions?.length ? `<h3>Next steps</h3><ul class="c-notes">${n.actions.map((a) => `<li><b>${a.who === "Andrew" ? "You" : esc(c.name)}:</b> ${esc(a.text)}</li>`).join("")}</ul>` : ""}
      <div class="c-mail-actions" style="margin-top:14px">${c.notes ? `<button class="btn ghost" id="cn-edit">Edit notes</button>` : ""}</div>`;
    const edit = () => `
      <label class="bld-f"><span>Summary</span><textarea id="cn-sum" rows="3">${esc(n.summary || "")}</textarea></label>
      <label class="bld-f"><span>What we covered (one per line)</span><textarea id="cn-pts" rows="5">${esc((n.points ?? []).join("\n"))}</textarea></label>
      <label class="bld-f"><span>Their next steps (one per line)</span><textarea id="cn-them" rows="3">${esc((n.actions ?? []).filter((a) => a.who !== "Andrew").map((a) => a.text).join("\n"))}</textarea></label>
      <label class="bld-f"><span>Your next steps (one per line)</span><textarea id="cn-me" rows="3">${esc((n.actions ?? []).filter((a) => a.who === "Andrew").map((a) => a.text).join("\n"))}</textarea></label>
      <div class="c-mail-actions" style="margin-top:12px"><button class="btn primary" id="cn-save">Save notes</button><button class="btn ghost" id="cn-cancel">Cancel</button></div>
      <p class="c-vm">${esc(c.name)} sees these notes on their Coach tab.</p>`;
    box.innerHTML = `<div class="c-modal-bg" data-x></div>
      <div class="c-modal-box narrow" role="dialog" aria-modal="true">
        <button class="c-icon c-close" data-x aria-label="Close">${SVG(IC.x, 20)}</button>
        <div class="c-modal-info">
          <p class="c-eyebrow">${esc(c.name)} · ${esc(when(c))}</p><h2>${esc(c.title)}</h2>
          <div id="cn-body">${show()}</div>
          ${c.transcript ? `<details class="c-transcript"><summary>Transcript</summary><div>${esc(c.transcript).replace(/\n/g, "<br>")}</div></details>` : ""}
        </div>
      </div>`;
    document.body.appendChild(box);
    const body = box.querySelector("#cn-body");
    const lines = (sel) => box.querySelector(sel).value.split("\n").map((s) => s.trim()).filter(Boolean);
    box.addEventListener("click", async (e) => {
      if (e.target.closest("[data-x]")) return box.remove();
      const b = e.target.closest("button");
      if (b?.id === "cn-edit") body.innerHTML = edit();
      if (b?.id === "cn-cancel") body.innerHTML = show();
      if (b?.id === "cn-save") {
        const next = { summary: box.querySelector("#cn-sum").value.trim(), points: lines("#cn-pts"),
          actions: [...lines("#cn-them").map((text) => ({ who: "client", text })), ...lines("#cn-me").map((text) => ({ who: "Andrew", text }))] };
        b.disabled = true;
        const { error: err } = await db.rpc("coach_save_notes", { p_id: c.id, p_notes: next });
        if (err) { b.disabled = false; return toast(err.message); }
        Object.assign(n, next); c.notes = n;
        body.innerHTML = show(); toast("Notes saved"); cs.at = 0;
      }
    });
  }

  // ---------- join ----------
  async function join(id, btn) {
    if (btn) btn.disabled = true;
    try {
      const pass = await api("call_join", { call_id: id });
      await openCall(pass, { esc, toast, onEnd: () => {
        api("call_done", { call_id: id }).catch(() => {});
        toast("Call notes will show up here a few minutes after the call");
        cs.at = 0; render();
      } });
    } catch (e) { toast(e.message || "Couldn't join the call"); }
    if (btn) btn.disabled = false;
  }

  async function onClick(t) {
    if (t.dataset.callBook !== undefined) { openBook(null, t.dataset.callBook || null); return true; }
    if (t.dataset.callEdit) { openBook(cs.list.find((c) => c.id === t.dataset.callEdit)); return true; }
    if (t.dataset.callJoin) { join(t.dataset.callJoin, t); return true; }
    if (t.dataset.callNotes) { openNotes(t.dataset.callNotes); return true; }
    return false;
  }

  return { view, todayCard, clientSection, onClick, load };
}
