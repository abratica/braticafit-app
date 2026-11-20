// BraticaFit coach mode: client pages, the workout builder and programs.
// Loaded by coach.js (coach only). Client data is read and written through coach_* database
// functions, which check that the person is the coach's client.

// ---------------------------------------------------------------------------
// Small date helpers (local dates as "YYYY-MM-DD")
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymdOf(d); };
const mondayOf = (s) => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymdOf(d); };
const todayStr = () => ymdOf(new Date());
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const shortFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const wdFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const TOD = [["", "Any time"], ["morning", "Morning"], ["midday", "Midday"], ["evening", "Evening"]];
const FEEL = { easy: "Easy", solid: "Solid", tough: "Tough", rough: "Rough" };
const REST_OPTS = [["", "Default (90s)"], ["0", "No rest"], ["30", "30s"], ["45", "45s"], ["60", "60s"], ["75", "75s"], ["90", "90s"], ["120", "2:00"], ["150", "2:30"], ["180", "3:00"], ["240", "4:00"]];
const uid = () => Math.random().toString(36).slice(2, 9);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Same formula as the client app's calculator (Mifflin-St Jeor × activity, 500 kcal per lb/week).
const ACTIVITY = [["sedentary", 1.2, "Mostly sitting"], ["light", 1.375, "Lightly active"], ["moderate", 1.55, "Moderately active"], ["very", 1.725, "Very active"], ["extra", 1.9, "Extremely active"]];
function calcTargets(i) {
  const kg = i.weight_lb * 0.453592, cm = i.height_in * 2.54;
  const bmr = 10 * kg + 6.25 * cm - 5 * i.age + (i.sex === "male" ? 5 : -161);
  const tdee = bmr * (ACTIVITY.find((a) => a[0] === i.activity)?.[1] ?? 1.2);
  const sign = i.goal === "lose" ? -1 : i.goal === "gain" ? 1 : 0;
  const floor = i.sex === "male" ? 1500 : 1200;
  const kcal = Math.round(Math.max(tdee + sign * i.pace_lb_wk * 500, floor) / 10) * 10;
  const protein_g = Math.round(i.weight_lb * i.protein_per_lb);
  const fat_g = Math.max(Math.round((kcal * i.fat_pct) / 100 / 9), Math.round(i.weight_lb * 0.3));
  const carbs_g = Math.max(0, Math.round((kcal - protein_g * 4 - fat_g * 9) / 4));
  return { tdee: Math.round(tdee), kcal, protein_g, carbs_g, fat_g };
}

// ---------------------------------------------------------------------------
// Workout <-> builder blocks
// ---------------------------------------------------------------------------
// Rows (workout_exercises / program exercises) -> editable blocks. A superset is a run of blocks linked to the next.
function toBlocks(rows) {
  return (rows ?? []).map((x, i, all) => {
    if (x.interval) {
      return { k: uid(), type: "iv", name: x.name || "Intervals", work: x.interval.work ?? 40, rest: x.interval.rest ?? 20,
        rounds: x.interval.rounds ?? 8, moves: (x.interval.moves ?? []).join(", ") };
    }
    const sets = x.sets ?? [];
    const repsFromScheme = (x.scheme || "").split("×")[1]?.trim() ?? "";
    return { k: uid(), type: "ex", name: x.name, demo: x.demo_video_id || "", sets: sets.length || 3,
      reps: sets[0]?.reps ?? repsFromScheme, weight: sets[0]?.weight ?? "", rest: x.rest_sec == null ? "" : String(x.rest_sec),
      link: !!x.superset && all[i + 1]?.superset === x.superset };
  });
}
// Blocks -> rows. Linked runs get letters A, B, C… in order.
function toRows(blocks) {
  const out = [];
  let letter = 64, inRun = false;
  blocks.forEach((b, i) => {
    if (b.type === "iv") {
      inRun = false;
      const moves = b.moves.split(",").map((m) => m.trim()).filter(Boolean);
      out.push({ name: b.name || "Intervals", scheme: `${b.rounds} rounds · ${b.work}s on / ${b.rest}s off`,
        interval: { work: Number(b.work) || 40, rest: Number(b.rest) || 0, rounds: Number(b.rounds) || 1, moves: moves.length ? moves : ["Work"] },
        sets: [{ reps: "", weight: "" }] });
      return;
    }
    const prevLinked = i > 0 && blocks[i - 1].type === "ex" && blocks[i - 1].link;
    const inSuperset = b.link || prevLinked;
    if (inSuperset && !prevLinked) letter++;
    inRun = inSuperset;
    const n = Math.max(1, Math.min(10, Number(b.sets) || 1));
    out.push({ name: b.name.trim() || "Exercise", scheme: b.reps ? `${n} × ${b.reps}` : `${n} sets`, demo_video_id: b.demo || null,
      rest_sec: b.rest === "" ? null : Number(b.rest), superset: inSuperset ? String.fromCharCode(letter) : null, interval: null,
      sets: Array.from({ length: n }, () => ({ reps: b.reps || "", weight: b.weight || "" })) });
  });
  return out;
}
const blockLabels = (blocks) => {
  const rows = toRows(blocks);
  const count = {};
  return rows.map((r) => (r.superset ? `${r.superset}${(count[r.superset] = (count[r.superset] || 0) + 1)}` : ""));
};

export function createTrain(ctx) {
  const { db, esc, toast, SVG, IC, st } = ctx;
  const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

  // =========================================================================
  // Workout builder (full screen): exercise library | workout | outline
  // =========================================================================
  // opts: { initial, heading, date (ymd) | dayIndex + weeks, onSave(payload), onDelete?, onDuplicate? }
  function openBuilder(opts) {
    const w = opts.initial ?? {};
    const b = {
      title: w.title ?? "", kind: w.kind ?? "written", video_id: w.video_id ?? "", duration_min: w.duration_min ?? "",
      note: w.note ?? "", tod: w.time_of_day ?? "", date: opts.date ?? w.scheduled_on ?? todayStr(),
      day: opts.dayIndex ?? w.day_index ?? 0, blocks: toBlocks(w.exercises), q: "", vq: "", drag: null,
    };
    const el = document.createElement("div");
    el.className = "c-bld";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    document.body.appendChild(el);
    document.body.style.overflow = "hidden";
    const close = () => { el.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape" && !el.querySelector(":focus-visible.bb-name")) close(); };
    document.addEventListener("keydown", onKey);

    const whenField = () => opts.weeks
      ? `<label class="bld-f"><span>Day</span><select data-b="day">${Array.from({ length: opts.weeks * 7 }, (_, i) =>
          `<option value="${i}" ${i === Number(b.day) ? "selected" : ""}>Week ${Math.floor(i / 7) + 1} · Day ${(i % 7) + 1} (${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i % 7]})</option>`).join("")}</select></label>`
      : `<label class="bld-f"><span>Date</span><input type="date" data-b="date" value="${esc(b.date)}"></label>`;

    const libList = () => {
      const q = b.q.trim().toLowerCase();
      const names = new Map();
      for (const d of st.demos) {
        const k = d.exercise_name.toLowerCase();
        if (!names.has(k)) names.set(k, { name: d.exercise_name, demo: d.video_id });
      }
      const hits = [...names.values()].filter((x) => !q || x.name.toLowerCase().includes(q));
      return `
        ${q ? `<button class="bld-li new" draggable="true" data-add="${esc(b.q.trim())}" data-demo="">${SVG(IC.plus ?? '<path d="M12 5v14M5 12h14"/>', 16)}<span>Add “${esc(b.q.trim())}”</span></button>` : ""}
        ${hits.map((x) => `<button class="bld-li" draggable="true" data-add="${esc(x.name)}" data-demo="${esc(x.demo)}">
          <span class="bld-th" style="background-image:url('${ytThumb(x.demo)}')"></span><span>${esc(x.name)}</span></button>`).join("")}
        ${!hits.length && !q ? `<p class="c-vm">Save demos in the Library and they show up here with their video. Or type any exercise name above.</p>` : ""}`;
    };

    const blockHtml = (x, i, labels) => {
      if (x.type === "iv") return `
        <div class="bb iv" draggable="true" data-i="${i}">
          <span class="bb-grip" title="Drag to reorder">⋮⋮</span>
          <div class="bb-main">
            <div class="bb-r1"><span class="bb-tag iv">Intervals</span><input class="bb-name" data-f="name" value="${esc(x.name)}" aria-label="Block name">
              <span class="bb-move"><button data-up="${i}" aria-label="Move up">↑</button><button data-down="${i}" aria-label="Move down">↓</button></span>
              <button class="bb-x" data-rm="${i}" aria-label="Remove">${SVG(IC.x, 16)}</button></div>
            <div class="bb-r2">
              <label><span>Work (s)</span><input data-f="work" type="number" inputmode="numeric" value="${esc(x.work)}"></label>
              <label><span>Rest (s)</span><input data-f="rest" type="number" inputmode="numeric" value="${esc(x.rest)}"></label>
              <label><span>Rounds</span><input data-f="rounds" type="number" inputmode="numeric" value="${esc(x.rounds)}"></label>
              <label class="wide"><span>Moves, comma separated</span><input data-f="moves" value="${esc(x.moves)}" placeholder="Jumping jacks, Mountain climbers"></label>
            </div>
          </div>
        </div>`;
      const demos = st.demos.filter((d) => d.exercise_name.toLowerCase() === x.name.trim().toLowerCase());
      const otherDemos = st.demos.filter((d) => !demos.includes(d));
      const nextIsEx = b.blocks[i + 1]?.type === "ex";
      return `
        <div class="bb ${x.link ? "linked" : ""}" draggable="true" data-i="${i}">
          <span class="bb-grip" title="Drag to reorder">⋮⋮</span>
          ${x.demo ? `<span class="bb-demo" style="background-image:url('${ytThumb(x.demo)}')"></span>` : ""}
          <div class="bb-main">
            <div class="bb-r1">${labels[i] ? `<span class="bb-tag">${labels[i]}</span>` : ""}
              <input class="bb-name" data-f="name" value="${esc(x.name)}" aria-label="Exercise name">
              <span class="bb-move"><button data-up="${i}" aria-label="Move up">↑</button><button data-down="${i}" aria-label="Move down">↓</button></span>
              <button class="bb-x" data-rm="${i}" aria-label="Remove ${esc(x.name)}">${SVG(IC.x, 16)}</button></div>
            <div class="bb-r2">
              <label><span>Sets</span><input data-f="sets" type="number" inputmode="numeric" min="1" max="10" value="${esc(x.sets)}"></label>
              <label><span>Reps</span><input data-f="reps" value="${esc(x.reps)}" placeholder="10"></label>
              <label><span>Weight</span><input data-f="weight" value="${esc(x.weight)}" placeholder="lb"></label>
              <label><span>Rest</span><select data-f="rest">${REST_OPTS.map(([v, l]) => `<option value="${v}" ${String(x.rest) === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
              <label class="wide"><span>Demo video</span><select data-f="demo"><option value="">None</option>
                ${demos.concat(otherDemos).map((d) => `<option value="${esc(d.video_id)}" ${d.video_id === x.demo ? "selected" : ""}>${esc(d.exercise_name)}${d.title ? ` · ${esc(d.title.slice(0, 40))}` : ""}</option>`).join("")}</select></label>
            </div>
          </div>
        </div>
        ${nextIsEx ? `<button class="bb-link" data-link="${i}" aria-pressed="${x.link}">${x.link ? "⛓ Superset with next · tap to split" : "+ Superset with next"}</button>` : ""}`;
    };

    const videoPanel = () => {
      const q = b.vq.trim().toLowerCase();
      const pool = [];
      for (const d of st.demos) pool.push({ id: d.video_id, title: d.title || d.exercise_name, seconds: d.seconds, channel: d.channel });
      // Library videos, minus the obvious clickbait (emoji, hype words, story titles).
      for (const ch of Object.values(st.data)) for (const v of ch.items) if (v.score >= 0) pool.push({ id: v.id, title: v.title, seconds: v.seconds, channel: ch.channel });
      const seen = new Set();
      const hits = pool.filter((v) => !seen.has(v.id) && seen.add(v.id) && (!q || q.split(/\s+/).every((t) => v.title.toLowerCase().includes(t)))).slice(0, 24);
      return `
        <div class="bld-video">
          ${b.video_id ? `<div class="bld-picked"><span class="bld-big" style="background-image:url('${ytThumb(b.video_id)}')"></span>
            <div><b>Selected video</b><span class="c-vm">youtu.be/${esc(b.video_id)}</span><button class="c-link" data-b-clear>Change</button></div></div>` : ""}
          <label class="bld-f"><span>Paste a YouTube link</span><input data-b="link" placeholder="https://youtu.be/…" value=""></label>
          <label class="bld-f"><span>Or search your Library${Object.keys(st.data).length ? "" : " (open a channel in the Library first to search it)"}</span>
            <input data-b="vq" value="${esc(b.vq)}" placeholder="yoga flow, mobility, dance cardio…"></label>
          <div class="bld-vgrid">${hits.map((v) => `<button class="bld-v ${v.id === b.video_id ? "on" : ""}" data-pickv="${v.id}" data-sec="${v.seconds || 0}">
            <span class="bld-big" style="background-image:url('${ytThumb(v.id)}')"></span><span class="c-vt">${esc(v.title)}</span>
            <span class="c-vm">${esc(v.channel || "")}${v.seconds ? ` · ${Math.round(v.seconds / 60)} min` : ""}</span></button>`).join("")}</div>
        </div>`;
    };

    const draw = () => {
      const labels = blockLabels(b.blocks);
      const nSets = b.blocks.filter((x) => x.type === "ex").reduce((n, x) => n + (Number(x.sets) || 0), 0);
      el.innerHTML = `
        <header class="bld-top">
          <div class="bld-title"><p class="c-eyebrow">${esc(opts.heading || "Workout")}</p>
            <input class="bld-name" data-b="title" value="${esc(b.title)}" placeholder="Workout name, e.g. Lower body strength"></div>
          <div class="bld-meta">${whenField()}
            <label class="bld-f"><span>Time of day</span><select data-b="tod">${TOD.map(([v, l]) => `<option value="${v}" ${b.tod === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <div class="bld-f"><span>Type</span><div class="c-mode bld-kind"><button data-kind="written" aria-pressed="${b.kind === "written"}">Written</button><button data-kind="video" aria-pressed="${b.kind === "video"}">Video</button></div></div>
          </div>
          <div class="bld-act">
            ${opts.onDelete ? `<button class="btn ghost" data-b-del>${SVG(IC.trash, 16)}Delete</button>` : ""}
            ${opts.onDuplicate ? `<button class="btn ghost" data-b-dup>Duplicate</button>` : ""}
            <button class="btn ghost" data-b-cancel>Cancel</button>
            <button class="btn primary" data-b-save>Save</button>
          </div>
        </header>
        <div class="bld-body ${b.kind}">
          ${b.kind === "written" ? `
          <aside class="bld-lib">
            <h3>Exercises</h3>
            <label class="c-search">${SVG(IC.search, 16)}<input data-b="q" value="${esc(b.q)}" placeholder="Search or type a new one" autocomplete="off"></label>
            <div class="bld-libl">${libList()}</div>
            <button class="btn ghost block" data-add-iv>+ Interval block</button>
            <p class="c-vm">Drag into the workout, or tap to add at the end.</p>
          </aside>
          <section class="bld-canvas" data-drop>
            ${b.blocks.length ? b.blocks.map((x, i) => blockHtml(x, i, labels)).join("") : `<div class="bld-empty">Drag exercises here, or tap one in the exercise list.</div>`}
          </section>` : `<section class="bld-canvas">${videoPanel()}</section>`}
          <aside class="bld-side">
            ${b.kind === "written" ? `<h3>Outline</h3>
              <ol class="bld-outline">${b.blocks.map((x, i) => `<li>${labels[i] ? `<b>${labels[i]}</b> ` : ""}${esc(x.name || "Exercise")}
                <span>${x.type === "iv" ? `${x.rounds} × ${x.work}/${x.rest}s` : `${x.sets} × ${esc(x.reps || "?")}${x.weight ? ` @ ${esc(x.weight)}` : ""}`}</span></li>`).join("") || "<li class='muted'>Nothing yet</li>"}</ol>
              <p class="c-vm">${b.blocks.length} block${b.blocks.length === 1 ? "" : "s"} · ${nSets} working sets</p>` : ""}
            <label class="bld-f"><span>Coach note (shows at the top)</span><textarea data-b="note" rows="4" placeholder="Slow 3-second lowers today">${esc(b.note)}</textarea></label>
            <label class="bld-f"><span>Minutes (optional)</span><input data-b="duration_min" type="number" inputmode="numeric" value="${esc(b.duration_min)}"></label>
          </aside>
        </div>`;
    };

    const addBlock = (name, demo, at = b.blocks.length) => {
      if (!demo) demo = st.demos.find((d) => d.exercise_name.toLowerCase() === name.toLowerCase())?.video_id || "";
      b.blocks.splice(at, 0, { k: uid(), type: "ex", name, demo, sets: 3, reps: "10", weight: "", rest: "", link: false });
      b.q = "";
      draw();
    };
    const move = (from, to) => {
      if (to < 0 || to >= b.blocks.length || from === to) return;
      const [x] = b.blocks.splice(from, 1);
      b.blocks.splice(to, 0, x);
      draw();
    };

    el.addEventListener("click", async (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.add !== undefined) return addBlock(t.dataset.add, t.dataset.demo);
      if (t.hasAttribute("data-add-iv")) { b.blocks.push({ k: uid(), type: "iv", name: "Intervals", work: 40, rest: 20, rounds: 8, moves: "" }); return draw(); }
      if (t.dataset.rm) { b.blocks.splice(Number(t.dataset.rm), 1); return draw(); }
      if (t.dataset.up) return move(Number(t.dataset.up), Number(t.dataset.up) - 1);
      if (t.dataset.down) return move(Number(t.dataset.down), Number(t.dataset.down) + 1);
      if (t.dataset.link) { const x = b.blocks[Number(t.dataset.link)]; x.link = !x.link; return draw(); }
      if (t.dataset.kind) { b.kind = t.dataset.kind; return draw(); }
      if (t.dataset.pickv) {
        b.video_id = t.dataset.pickv;
        const sec = Number(t.dataset.sec);
        if (sec && !b.duration_min) b.duration_min = Math.max(1, Math.round(sec / 60));
        if (!b.title) b.title = t.querySelector(".c-vt")?.textContent.slice(0, 60) ?? "";
        return draw();
      }
      if (t.hasAttribute("data-b-clear")) { b.video_id = ""; return draw(); }
      if (t.hasAttribute("data-b-cancel")) return close();
      if (t.hasAttribute("data-b-del")) {
        if (t.dataset.sure !== "1") { t.dataset.sure = "1"; t.textContent = "Tap again to delete"; return; }
        await opts.onDelete();
        return close();
      }
      if (t.hasAttribute("data-b-dup")) { await opts.onDuplicate(payload()); return close(); }
      if (t.hasAttribute("data-b-save")) {
        const p = payload();
        if (!p.title) return toast("Give the workout a name");
        if (p.kind === "video" && !p.video_id) return toast("Pick a video");
        if (p.kind === "written" && !p.exercises.length) return toast("Add at least one exercise");
        t.disabled = true;
        try { await opts.onSave(p); close(); }
        catch (err) { t.disabled = false; toast(err.message || "Couldn't save"); }
      }
    });
    el.addEventListener("input", (e) => {
      const f = e.target.dataset.f, k = e.target.dataset.b;
      if (f) {
        const i = Number(e.target.closest("[data-i]").dataset.i);
        b.blocks[i][f] = e.target.value;
        if (f === "name" || f === "sets" || f === "reps" || f === "weight") {
          // Keep the outline in step without redrawing the field being typed in.
          const labels = blockLabels(b.blocks);
          const ol = el.querySelector(".bld-outline");
          if (ol) ol.innerHTML = b.blocks.map((x, j) => `<li>${labels[j] ? `<b>${labels[j]}</b> ` : ""}${esc(x.name || "Exercise")}
            <span>${x.type === "iv" ? `${x.rounds} × ${x.work}/${x.rest}s` : `${x.sets} × ${esc(x.reps || "?")}${x.weight ? ` @ ${esc(x.weight)}` : ""}`}</span></li>`).join("");
        }
        return;
      }
      if (k === "q") {
        b.q = e.target.value;
        el.querySelector(".bld-libl").innerHTML = libList();
        return;
      }
      if (k === "vq") {
        b.vq = e.target.value;
        const pos = e.target.selectionStart;
        draw();
        const inp = el.querySelector('[data-b="vq"]');
        inp.focus(); inp.setSelectionRange(pos, pos);
        return;
      }
      if (k === "link") {
        const m = e.target.value.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);
        if (m) { b.video_id = m[1]; draw(); }
        return;
      }
      if (k) b[k === "tod" ? "tod" : k] = e.target.value;
    });
    el.addEventListener("change", (e) => {
      const f = e.target.dataset.f, k = e.target.dataset.b;
      if (f === "demo" || f === "rest") {
        const i = Number(e.target.closest("[data-i]").dataset.i);
        b.blocks[i][f] = e.target.value;
        if (f === "demo") draw();
      }
      if (k === "date") b.date = e.target.value;
      if (k === "day") b.day = Number(e.target.value);
      if (k === "tod") b.tod = e.target.value;
      if (f === "name") draw();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.dataset.b === "q" && b.q.trim()) { e.preventDefault(); addBlock(b.q.trim(), ""); el.querySelector('[data-b="q"]')?.focus(); }
    });

    // Drag and drop: library items into the workout, and blocks to reorder.
    el.addEventListener("dragstart", (e) => {
      const lib = e.target.closest("[data-add]");
      const blk = e.target.closest(".bb");
      if (lib) b.drag = { add: lib.dataset.add, demo: lib.dataset.demo };
      else if (blk) { b.drag = { from: Number(blk.dataset.i) }; blk.classList.add("dragging"); }
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "bf");
    });
    el.addEventListener("dragend", () => { b.drag = null; el.querySelectorAll(".dragging,.drop-before,.drop-after").forEach((x) => x.classList.remove("dragging", "drop-before", "drop-after")); });
    const dropIndex = (e) => {
      const blk = e.target.closest(".bb");
      if (!blk) return b.blocks.length;
      const r = blk.getBoundingClientRect();
      const i = Number(blk.dataset.i);
      return e.clientY < r.top + r.height / 2 ? i : i + 1;
    };
    el.addEventListener("dragover", (e) => {
      if (!b.drag || !e.target.closest("[data-drop]")) return;
      e.preventDefault();
      el.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      const blk = e.target.closest(".bb");
      if (blk) { const r = blk.getBoundingClientRect(); blk.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after"); }
    });
    el.addEventListener("drop", (e) => {
      if (!b.drag || !e.target.closest("[data-drop]")) return;
      e.preventDefault();
      const at = dropIndex(e);
      if (b.drag.add !== undefined) addBlock(b.drag.add, b.drag.demo, at);
      else { const from = b.drag.from; move(from, at > from ? at - 1 : at); }
      b.drag = null;
    });

    const payload = () => ({
      title: b.title.trim(), kind: b.kind, video_id: b.kind === "video" ? b.video_id : null,
      duration_min: b.duration_min === "" ? null : Number(b.duration_min) || null, note: b.note.trim() || null,
      time_of_day: b.tod || null, exercises: b.kind === "written" ? toRows(b.blocks) : [],
      scheduled_on: b.date, day_index: Number(b.day),
    });
    draw();
    setTimeout(() => el.querySelector(b.title ? '[data-b="q"]' : '[data-b="title"]')?.focus(), 30);
  }

  // =========================================================================
  // Client page: Overview · Training · Nutrition · Settings
  // =========================================================================
  const settingsOf = (m) => ({ food: true, weight: true, targets_edit: true, move_days: true, ...(m?.settings ?? {}) });

  async function loadClient() {
    const c = st.client;
    const from = [c.week, addDays(todayStr(), -14)].sort()[0];
    const { data, error } = await db.rpc("coach_client_detail", { p_client: c.user_id, p_from: from, p_to: addDays(c.week, 13) });
    if (error) { toast(error.message); c.detail = null; return; }
    c.detail = data;
  }

  function wStatus(w) {
    if (w.completed_at) return "done";
    if (w.scheduled_on < todayStr()) return "missed";
    if (w.scheduled_on === todayStr()) return "today";
    return "planned";
  }
  const loggedAny = (w) => w.completed_at || (w.exercises ?? []).some((x) => (x.sets ?? []).some((s) => s.done));

  async function clientView() {
    const c = st.client;
    await loadClient();
    const d = c.detail;
    if (!d) return `<p class="c-empty-line">Couldn't load this client.</p>`;
    const m = d.member;
    const name = c.is_me ? "You" : m?.name || m?.email || "Client";
    const tabs = [["overview", "Overview"], ["training", "Training"], ["nutrition", "Nutrition"], ...(c.is_me ? [] : [["settings", "Settings"]])];
    const head = `
      <button class="c-link c-back" data-nav="${c.from || "clients"}">‹ ${c.from === "dashboard" ? "Dashboard" : "Clients"}</button>
      <header class="c-head"><div><p class="c-eyebrow">${c.is_me ? "Your training" : `${esc(m?.email || "")}${m?.last_seen_at ? ` · active ${esc(ctx.ago(m.last_seen_at))}` : ""}`}</p><h1>${esc(name)}</h1></div>
        <div class="c-head-act"><button class="btn ghost" data-t-assign>Assign program</button><button class="btn primary" data-t-add="${todayStr()}">${SVG('<path d="M12 5v14M5 12h14"/>', 18)}Add workout</button></div></header>
      <div class="c-tabs">${tabs.map(([k, l]) => `<button data-t-tab="${k}" aria-current="${c.tab === k ? "page" : "false"}">${l}</button>`).join("")}</div>`;
    const body = { overview: overviewTab, training: trainingTab, nutrition: nutritionTab, settings: settingsTab }[c.tab]?.(d) ?? "";
    return head + body;
  }

  function overviewTab(d) {
    const s = settingsOf(d.member);
    const today = todayStr(), mon = mondayOf(today), sun = addDays(mon, 6);
    const week = d.workouts.filter((w) => w.scheduled_on >= mon && w.scheduled_on <= sun);
    const done = week.filter((w) => w.completed_at).length;
    const last7 = d.food_days.filter((f) => f.day > addDays(today, -7));
    const avg = (k) => (last7.length ? Math.round(last7.reduce((n, f) => n + Number(f[k] || 0), 0) / last7.length) : null);
    const t = d.targets;
    const ws = d.weights;
    const lastW = ws[ws.length - 1];
    const firstW = ws.find((x) => new Date(x.at) >= new Date(Date.now() - 30 * 864e5)) ?? ws[0];
    const events = [];
    for (const w of d.workouts) {
      if (w.scheduled_on > today || w.scheduled_on < addDays(today, -14)) continue;
      if (w.completed_at) events.push({ at: w.completed_at, html: `<b>Finished ${esc(w.title)}</b>${w.feel ? ` · felt ${FEEL[w.feel].toLowerCase()}` : ""}`, kind: "done" });
      else if (w.scheduled_on < today) events.push({ at: w.scheduled_on + "T23:00", html: `Missed <b>${esc(w.title)}</b>`, kind: "missed" });
    }
    for (const f of d.food_days.filter((f) => f.day >= addDays(today, -14))) {
      events.push({ at: f.day + "T22:00", html: `Logged food · <b>${Number(f.kcal).toLocaleString()} cal</b>, ${f.protein}g protein · ${f.items.length} item${f.items.length === 1 ? "" : "s"}`, kind: "food" });
    }
    if (s.weight) for (const x of ws.filter((x) => new Date(x.at) >= new Date(Date.now() - 14 * 864e5))) events.push({ at: x.at, html: `Weighed in · <b>${x.lb} lb</b>`, kind: "weight" });
    events.sort((a, b) => (a.at < b.at ? 1 : -1));
    const pct = (v, goal) => (v != null && goal ? `${Math.round((v / goal) * 100)}% of ${goal.toLocaleString()}` : "");
    return `
      <div class="c-stats">
        <div class="c-stat"><span>Workouts this week</span><b>${done}/${week.length}</b><em>${week.length ? `${week.length - done} to go` : "Nothing scheduled"}</em></div>
        <div class="c-stat"><span>Food days (7 days)</span><b>${last7.length}/7</b><em>${s.food ? "Days with food logged" : "Food logging is off"}</em></div>
        <div class="c-stat"><span>Avg calories</span><b>${avg("kcal")?.toLocaleString() ?? "–"}</b><em>${pct(avg("kcal"), t?.kcal) || (t ? "" : "No targets set")}</em></div>
        <div class="c-stat"><span>Avg protein</span><b>${avg("protein") != null ? `${avg("protein")}g` : "–"}</b><em>${pct(avg("protein"), t?.protein_g) || ""}</em></div>
        ${s.weight ? `<div class="c-stat"><span>Weight</span><b>${lastW ? `${lastW.lb}` : "–"}</b><em>${lastW && firstW && firstW !== lastW ? `${(lastW.lb - firstW.lb > 0 ? "+" : "") + (lastW.lb - firstW.lb).toFixed(1)} lb since ${shortFmt.format(new Date(firstW.at))}` : lastW ? `on ${shortFmt.format(new Date(lastW.at))}` : "No weigh-ins"}</em></div>` : ""}
      </div>
      <section class="c-card"><h3>Recent activity</h3>
        ${events.length ? `<ul class="c-feed">${events.slice(0, 25).map((e) => `<li class="${e.kind}"><span class="c-dot"></span><div>${e.html}</div>
          <time>${shortFmt.format(new Date(e.at))}</time></li>`).join("")}</ul>` : `<p class="c-empty-line">Nothing in the last two weeks yet.</p>`}
      </section>`;
  }

  function trainingTab(d) {
    const c = st.client;
    const days = Array.from({ length: 14 }, (_, i) => addDays(c.week, i));
    const by = {};
    for (const w of d.workouts) (by[w.scheduled_on] ??= []).push(w);
    const cell = (day) => `
      <div class="c-day ${day === todayStr() ? "today" : ""}" data-t-day="${day}">
        <div class="c-day-h"><span>${wdFmt.format(parse(day))}</span><b>${parse(day).getDate()}</b>
          <button class="c-day-add" data-t-add="${day}" aria-label="Add a workout on ${dayFmt.format(parse(day))}">+</button></div>
        ${(by[day] ?? []).map((w) => `<button class="c-wchip ${wStatus(w)}" draggable="true" data-t-open="${w.id}">
          <span class="t">${esc(w.title)}</span>
          <span class="m">${w.completed_at ? `✓ ${w.feel ? FEEL[w.feel] : "Done"}` : wStatus(w) === "missed" ? "Missed" : w.kind === "video" ? "Video" : plural((w.exercises ?? []).length, "exercise")}${w.time_of_day ? ` · ${w.time_of_day[0].toUpperCase() + w.time_of_day.slice(1)}` : ""}</span>
        </button>`).join("")}
      </div>`;
    return `
      <div class="c-weeknav"><button class="btn ghost" data-t-week="-7">‹ Prev</button>
        <b>${shortFmt.format(parse(days[0]))} – ${shortFmt.format(parse(days[13]))}</b>
        <button class="btn ghost" data-t-week="0">This week</button><button class="btn ghost" data-t-week="7">Next ›</button></div>
      <div class="c-cal">${days.slice(0, 7).map(cell).join("")}</div>
      <div class="c-cal">${days.slice(7).map(cell).join("")}</div>
      <p class="c-vm">Drag a workout to another day to move it. Click one to edit it, or to see what they logged.</p>`;
  }

  function nutritionTab(d) {
    const s = settingsOf(d.member);
    const t = d.targets;
    const days = d.food_days.filter((f) => f.day > addDays(todayStr(), -14));
    const open = st.client.openDay;
    return `
      <section class="c-card">
        <div class="c-card-head"><h3>Daily targets</h3><button class="btn ${t ? "ghost" : "primary"}" data-t-targets>${t ? "Edit targets" : "Set targets"}</button></div>
        ${t ? `<div class="c-tnums"><div><b>${t.kcal.toLocaleString()}</b><span>Calories</span></div><div><b>${t.protein_g}g</b><span>Protein</span></div>
          <div><b>${t.carbs_g}g</b><span>Carbs</span></div><div><b>${t.fat_g}g</b><span>Fat</span></div></div>
          <p class="c-vm" style="margin:10px 0 0">${t.goal ? `${t.goal[0].toUpperCase() + t.goal.slice(1)}${t.goal !== "maintain" ? ` ${t.pace_lb_wk} lb/wk` : ""} · ` : ""}${t.custom ? "Custom numbers" : "From the calculator"} · updated ${shortFmt.format(new Date(t.updated_at))}</p>`
          : `<p class="c-empty-line">No targets yet. Set calories and macros and they show on their Food tab.</p>`}
        ${!s.food ? `<p class="c-vm">Food logging is turned off for this client (Settings).</p>` : ""}
      </section>
      <section class="c-card"><h3>Last 14 days</h3>
        ${days.length ? `<table class="c-table"><thead><tr><th>Day</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Items</th></tr></thead><tbody>
          ${days.map((f) => `<tr class="c-trow" data-t-day-open="${f.day}"><td>${dayFmt.format(parse(f.day))}</td>
            <td><b>${Number(f.kcal).toLocaleString()}</b>${t ? `<span class="c-mini"><i style="width:${Math.min(100, (f.kcal / t.kcal) * 100)}%" class="${f.kcal > t.kcal * 1.08 ? "over" : ""}"></i></span>` : ""}</td>
            <td>${f.protein}g${t ? `<span class="c-vm"> / ${t.protein_g}</span>` : ""}</td><td>${f.carbs}g</td><td>${f.fat}g</td><td>${f.items.length}</td></tr>
            ${open === f.day ? `<tr class="c-tdetail"><td colspan="6">${["breakfast", "lunch", "dinner", "snack"].map((k) => {
              const items = f.items.filter((x) => (x.meal || "snack") === k);
              return items.length ? `<div><b>${{ breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snacks" }[k]}</b> ${items.map((x) => `${esc(x.name)}${x.servings != 1 ? ` ×${x.servings}` : ""} <span class="c-vm">${x.kcal} cal</span>`).join(" · ")}</div>` : "";
            }).join("")}</td></tr>` : ""}`).join("")}
        </tbody></table>` : `<p class="c-empty-line">No food logged in the last two weeks.</p>`}
      </section>`;
  }

  function settingsTab(d) {
    const m = d.member;
    const s = settingsOf(m);
    const sw = (k, label, desc) => `<div class="c-setting"><div><b>${label}</b><span class="c-vm">${desc}</span></div>
      <button class="c-toggle" data-t-set="${k}" aria-pressed="${s[k]}"><span class="c-knob"></span>${s[k] ? "On" : "Off"}</button></div>`;
    return `
      <section class="c-card"><h3>What they see</h3>
        ${sw("food", "Food logging", "The Food tab, food logging on Today, and meal check-ins.")}
        ${sw("weight", "Weight tracking", "Weigh-ins and the weight chart. Turn off for clients who aren't here for weight.")}
        ${sw("targets_edit", "Can change their own targets", "Off means they see the targets you set but can't edit them.")}
        ${sw("move_days", "Can move workouts", "Lets them move a workout to another day.")}
      </section>
      <section class="c-card"><h3>Details</h3>
        <form class="c-add" id="t-name-form"><label><span>Full name</span><input id="t-name" value="${esc(m.name || "")}" required></label>
          <label><span>Email</span><input value="${esc(m.email)}" disabled></label><button class="btn primary">Save</button></form>
      </section>
      <section class="c-card"><h3>Access</h3><p class="c-vm">Removing access blocks them from the app. Their logs are kept, and you can add them back any time.</p>
        <button class="btn ghost" data-t-remove>${SVG(IC.trash, 16)}Remove access</button></section>`;
  }

  // Workout detail for a logged workout: what they did.
  function openLogged(w) {
    const box = document.createElement("div");
    box.className = "c-modal";
    box.innerHTML = `<div class="c-modal-bg" data-x></div>
      <div class="c-modal-box narrow" role="dialog" aria-modal="true">
        <button class="c-icon c-close" data-x aria-label="Close">${SVG(IC.x, 20)}</button>
        <div class="c-modal-info">
          <p class="c-eyebrow">${dayFmt.format(parse(w.scheduled_on))}${w.completed_at ? ` · finished ${ctx.ago(w.completed_at)}` : " · in progress"}</p>
          <h2>${esc(w.title)}</h2>
          ${w.feel ? `<p>Felt <b>${FEEL[w.feel]}</b></p>` : ""}
          ${w.kind === "video" ? `<p class="c-vm">Video workout${w.video_id ? ` · <a href="https://youtu.be/${w.video_id}" target="_blank" rel="noopener">watch</a>` : ""}</p>` : ""}
          ${(w.exercises ?? []).map((x) => `<div class="c-logged"><b>${x.superset ? `${x.superset} · ` : ""}${esc(x.name)}</b>
            ${x.interval ? `<span class="c-vm">${x.interval.rounds} rounds · ${(x.sets?.[0]?.done ? "done" : "not done")}</span>`
              : `<span>${(x.sets ?? []).map((s) => `<i class="${s.done ? "on" : ""}">${s.weight ? `${esc(s.weight)} × ` : ""}${esc(s.reps || "–")}</i>`).join("")}</span>`}</div>`).join("")}
          <div class="c-mail-actions" style="margin-top:16px">
            <label class="bld-f"><span>Move to</span><input type="date" id="lg-day" value="${w.scheduled_on}"></label>
            <button class="btn ghost" id="lg-move">Move</button><button class="btn ghost" id="lg-edit">Edit anyway</button><button class="btn ghost" id="lg-del">Delete</button>
          </div>
          <p class="c-vm">Editing a workout they've started clears what they logged on it.</p>
        </div>
      </div>`;
    document.body.appendChild(box);
    const close = () => box.remove();
    box.addEventListener("click", async (e) => {
      if (e.target.closest("[data-x]")) return close();
      const id = e.target.closest("button")?.id;
      if (id === "lg-move") { await moveWorkout(w.id, box.querySelector("#lg-day").value); close(); }
      if (id === "lg-edit") { close(); editWorkout(w); }
      if (id === "lg-del") {
        const b = e.target.closest("button");
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to delete"; return; }
        await deleteWorkout(w.id); close();
      }
    });
  }

  async function saveWorkout(p, id) {
    const { error } = await db.rpc("coach_save_workout", { p_client: st.client.user_id, w: { ...p, id: id ?? null } });
    if (error) throw error;
    toast("Workout saved");
    ctx.render();
  }
  async function moveWorkout(id, day) {
    const { error } = await db.rpc("coach_move_workout", { p_id: id, p_day: day });
    if (error) return toast(error.message);
    toast(`Moved to ${dayFmt.format(parse(day))}`);
    ctx.render();
  }
  async function deleteWorkout(id) {
    const { error } = await db.rpc("coach_delete_workout", { p_id: id });
    if (error) return toast(error.message);
    toast("Workout deleted");
    ctx.render();
  }
  function editWorkout(w) {
    openBuilder({
      initial: w, heading: `Edit · ${st.client.is_me ? "You" : st.client.detail?.member?.name || ""}`,
      onSave: (p) => saveWorkout(p, w.id),
      onDelete: () => deleteWorkout(w.id),
      onDuplicate: async (p) => { await saveWorkout(p, null); },
    });
  }

  // Targets form (calculator + fine-tune) for a client.
  function openTargetsForm() {
    const t = st.client.detail.targets ?? {};
    const f = { sex: t.sex ?? "male", age: t.age ?? "", height_in: t.height_in ?? "", weight_lb: t.weight_lb ?? (st.client.detail.weights.at(-1)?.lb ?? ""),
      activity: t.activity ?? "moderate", goal: t.goal ?? "maintain", pace_lb_wk: Number(t.pace_lb_wk ?? 0), protein_per_lb: Number(t.protein_per_lb ?? 0.8), fat_pct: Number(t.fat_pct ?? 30) };
    let manual = t.kcal ? { kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g } : null;
    let custom = !!t.custom || (!t.age && !!t.kcal);
    const box = document.createElement("div");
    box.className = "c-modal";
    const sel = (id, opts, v) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    box.innerHTML = `<div class="c-modal-bg" data-x></div>
      <div class="c-modal-box narrow" role="dialog" aria-modal="true"><button class="c-icon c-close" data-x aria-label="Close">${SVG(IC.x, 20)}</button>
        <div class="c-modal-info"><h2>Daily targets</h2>
          <div class="c-form2">
            <label><span>Sex</span>${sel("tg-sex", [["male", "Male"], ["female", "Female"]], f.sex)}</label>
            <label><span>Age</span><input id="tg-age" type="number" value="${esc(f.age)}"></label>
            <label><span>Height (in)</span><input id="tg-h" type="number" value="${esc(f.height_in)}" placeholder="72 = 6'0&quot;"></label>
            <label><span>Weight (lb)</span><input id="tg-w" type="number" step="0.1" value="${esc(f.weight_lb)}"></label>
            <label class="wide"><span>Activity</span>${sel("tg-act", ACTIVITY.map(([k, , l]) => [k, l]), f.activity)}</label>
            <label><span>Goal</span>${sel("tg-goal", [["lose", "Lose"], ["maintain", "Maintain"], ["gain", "Gain"]], f.goal)}</label>
            <label><span>Pace (lb/wk)</span>${sel("tg-pace", [[0, "–"], [0.25, "0.25"], [0.5, "0.5"], [0.75, "0.75"], [1, "1"], [1.5, "1.5"]], f.pace_lb_wk)}</label>
            <label><span>Protein per lb</span>${sel("tg-pro", [0.7, 0.8, 0.9, 1, 1.1, 1.2].map((v) => [v, `${v} g`]), f.protein_per_lb)}</label>
            <label><span>Fat (% of calories)</span>${sel("tg-fat", [20, 25, 30, 35, 40, 50].map((v) => [v, `${v}%`]), f.fat_pct)}</label>
          </div>
          <div id="tg-out" class="c-card" style="margin-top:14px"></div>
          <div class="c-mail-actions" style="margin-top:14px"><button class="btn ghost" id="tg-tune"></button><button class="btn primary" id="tg-save">Save targets</button></div>
        </div></div>`;
    document.body.appendChild(box);
    const read = () => {
      f.sex = box.querySelector("#tg-sex").value; f.age = Number(box.querySelector("#tg-age").value); f.height_in = Number(box.querySelector("#tg-h").value);
      f.weight_lb = Number(box.querySelector("#tg-w").value); f.activity = box.querySelector("#tg-act").value; f.goal = box.querySelector("#tg-goal").value;
      f.pace_lb_wk = f.goal === "maintain" ? 0 : Number(box.querySelector("#tg-pace").value) || 0.5;
      f.protein_per_lb = Number(box.querySelector("#tg-pro").value); f.fat_pct = Number(box.querySelector("#tg-fat").value);
    };
    const ready = () => f.age >= 13 && f.height_in >= 48 && f.weight_lb > 50;
    const draw = () => {
      read();
      const c = ready() ? calcTargets(f) : null;
      const n = custom ? manual ?? c ?? { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 67 } : c;
      box.querySelector("#tg-tune").textContent = custom ? "Use the calculator" : "Type my own numbers";
      box.querySelector("#tg-out").innerHTML = !n ? `<p class="c-vm" style="margin:0">Fill in age, height and weight, or type your own numbers.</p>` : `
        ${c && !custom ? `<p class="c-vm" style="margin:0 0 10px">Burns about ${c.tdee.toLocaleString()} a day.</p>` : ""}
        <div class="c-tnums">${[["kcal", "Calories", ""], ["protein_g", "Protein", "g"], ["carbs_g", "Carbs", "g"], ["fat_g", "Fat", "g"]].map(([k, l, u]) =>
          custom ? `<label><input data-m="${k}" type="number" value="${n[k]}"><span>${l}</span></label>` : `<div><b>${n[k].toLocaleString()}${u}</b><span>${l}</span></div>`).join("")}</div>`;
      if (custom && !manual) manual = { ...n };
    };
    box.addEventListener("input", (e) => {
      const k = e.target.dataset.m;
      if (k) { manual[k] = Math.max(0, Math.round(Number(e.target.value) || 0));
        if (k !== "kcal") { manual.kcal = manual.protein_g * 4 + manual.carbs_g * 4 + manual.fat_g * 9; box.querySelector('[data-m="kcal"]').value = manual.kcal; }
        return; }
      draw();
    });
    box.addEventListener("change", (e) => { if (e.target.tagName === "SELECT") draw(); });
    box.addEventListener("click", async (e) => {
      if (e.target.closest("[data-x]")) return box.remove();
      const id = e.target.closest("button")?.id;
      if (id === "tg-tune") { custom = !custom; if (custom && ready()) manual = { ...calcTargets(f) }; return draw(); }
      if (id === "tg-save") {
        read();
        const n = custom ? manual : ready() ? calcTargets(f) : null;
        if (!n?.kcal) return toast("Fill in their stats or type the numbers");
        const { error } = await db.rpc("coach_set_targets", { p_client: st.client.user_id, t: {
          sex: f.sex, age: f.age || null, height_in: f.height_in || null, weight_lb: f.weight_lb || null, activity: f.activity, goal: f.goal,
          pace_lb_wk: f.pace_lb_wk, protein_per_lb: f.protein_per_lb, fat_pct: f.fat_pct,
          kcal: n.kcal, protein_g: n.protein_g, carbs_g: n.carbs_g, fat_g: n.fat_g, custom } });
        if (error) return toast(error.message);
        box.remove();
        toast("Targets saved");
        ctx.render();
      }
    });
    draw();
  }

  // =========================================================================
  // Programs
  // =========================================================================
  async function programsView() {
    if (st.prog) return programEditor();
    const [{ data: progs }, { data: pws }] = await Promise.all([
      db.from("programs").select("*").order("updated_at", { ascending: false }),
      db.from("program_workouts").select("program_id"),
    ]);
    const count = {};
    for (const x of pws ?? []) count[x.program_id] = (count[x.program_id] || 0) + 1;
    return `<header class="c-head"><div><p class="c-eyebrow">Templates</p><h1>Programs</h1></div>
        <button class="btn primary" data-p-new>${SVG('<path d="M12 5v14M5 12h14"/>', 18)}New program</button></header>
      ${(progs ?? []).length ? `<div class="c-pgrid">${progs.map((p) => `<div class="c-card c-prog">
          <h3>${esc(p.title)}</h3><p class="c-vm">${p.weeks} week${p.weeks === 1 ? "" : "s"} · ${count[p.id] || 0} workouts${p.description ? ` · ${esc(p.description)}` : ""}</p>
          <div class="c-mail-actions"><button class="btn ghost" data-p-edit="${p.id}">Edit</button><button class="btn primary" data-p-assign="${p.id}">Assign</button></div>
        </div>`).join("")}</div>`
        : `<section class="c-card c-empty"><p>Build a program once (a week of workouts, or several) and assign it to any client from a start date. They get their own copy, so you can tweak theirs without changing the template.</p>
          <button class="btn primary" data-p-new>Create your first program</button></section>`}`;
  }

  async function programEditor() {
    const P = st.prog;
    const [{ data: p }, { data: ws }] = await Promise.all([
      db.from("programs").select("*").eq("id", P.id).single(),
      db.from("program_workouts").select("*").eq("program_id", P.id).order("day_index").order("position"),
    ]);
    if (!p) { st.prog = null; return programsView(); }
    P.program = p; P.workouts = ws ?? [];
    const by = {};
    for (const w of P.workouts) (by[w.day_index] ??= []).push(w);
    const D = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return `
      <button class="c-link c-back" data-p-back>‹ Programs</button>
      <header class="c-head"><div class="c-ptitle"><p class="c-eyebrow">Program · ${P.workouts.length} workouts</p>
          <input class="bld-name" id="p-title" value="${esc(p.title)}" aria-label="Program name"></div>
        <div class="c-head-act"><button class="btn ghost" data-p-del>${SVG(IC.trash, 16)}Delete</button><button class="btn primary" data-p-assign="${p.id}">Assign to a client</button></div></header>
      <label class="bld-f" style="max-width:640px"><span>Description (optional)</span><input id="p-desc" value="${esc(p.description || "")}" placeholder="3 days a week, full body, beginner friendly"></label>
      ${Array.from({ length: p.weeks }, (_, wk) => `
        <div class="c-pweek"><div class="c-card-head"><h3>Week ${wk + 1}</h3>
          ${wk < p.weeks - 1 || p.weeks < 12 ? `<button class="c-link" data-p-copyweek="${wk}">Copy to week ${wk + 2}</button>` : ""}</div>
          <div class="c-cal">${D.map((dn, di) => {
            const idx = wk * 7 + di;
            return `<div class="c-day" data-p-day="${idx}"><div class="c-day-h"><span>${dn}</span><b>${idx + 1}</b>
              <button class="c-day-add" data-p-add="${idx}" aria-label="Add a workout on week ${wk + 1} ${dn}">+</button></div>
              ${(by[idx] ?? []).map((w) => `<button class="c-wchip planned" draggable="true" data-p-open="${w.id}"><span class="t">${esc(w.title)}</span>
                <span class="m">${w.kind === "video" ? "Video" : plural((w.exercises ?? []).length, "exercise")}${w.time_of_day ? ` · ${w.time_of_day}` : ""}</span></button>`).join("")}
            </div>`;
          }).join("")}</div></div>`).join("")}
      <div class="c-mail-actions">${p.weeks < 12 ? `<button class="btn ghost" data-p-weeks="1">+ Add a week</button>` : ""}
        ${p.weeks > 1 ? `<button class="btn ghost" data-p-weeks="-1">Remove last week</button>` : ""}</div>
      <p class="c-vm">Drag workouts between days. Assigning gives the client their own copy starting on the date you pick.</p>`;
  }

  async function saveProgramWorkout(p, id) {
    const row = { title: p.title, kind: p.kind, video_id: p.video_id, duration_min: p.duration_min, note: p.note, time_of_day: p.time_of_day,
      exercises: p.exercises, day_index: p.day_index, program_id: st.prog.id };
    const { error } = id ? await db.from("program_workouts").update(row).eq("id", id) : await db.from("program_workouts").insert(row);
    if (error) throw error;
    await db.from("programs").update({ updated_at: new Date().toISOString() }).eq("id", st.prog.id);
    toast("Saved to program");
    ctx.render();
  }

  function openAssign(programId, presetClient) {
    const people = [{ user_id: ctx.user.id, name: "You (your own training)" }, ...st.members.filter((m) => m.user_id).map((m) => ({ user_id: m.user_id, name: m.name || m.email }))];
    const nextMon = addDays(mondayOf(todayStr()), 7);
    const box = document.createElement("div");
    box.className = "c-modal";
    const progOpts = (st.progList ?? []).map((p) => `<option value="${p.id}" ${p.id === programId ? "selected" : ""}>${esc(p.title)} · ${p.weeks} wk</option>`).join("");
    box.innerHTML = `<div class="c-modal-bg" data-x></div>
      <div class="c-modal-box narrow" role="dialog" aria-modal="true"><button class="c-icon c-close" data-x aria-label="Close">${SVG(IC.x, 20)}</button>
        <div class="c-modal-info"><h2>Assign a program</h2>
          <div class="c-form2">
            ${programId ? "" : `<label class="wide"><span>Program</span><select id="as-prog">${progOpts || "<option value=''>No programs yet</option>"}</select></label>`}
            <label class="wide"><span>Who</span><select id="as-who">${people.map((x) => `<option value="${x.user_id}" ${x.user_id === presetClient ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
            <label class="wide"><span>Start date (day 1)</span><input type="date" id="as-start" value="${nextMon}"></label>
          </div>
          <p class="c-vm" id="as-sum"></p>
          <div class="c-mail-actions"><button class="btn primary" id="as-go">Assign</button></div>
        </div></div>`;
    document.body.appendChild(box);
    const pid = () => programId || box.querySelector("#as-prog")?.value;
    const sum = () => {
      const p = (st.progList ?? []).find((x) => x.id === pid());
      const s = box.querySelector("#as-start").value;
      box.querySelector("#as-sum").textContent = p && s ? `Runs ${dayFmt.format(parse(s))} to ${dayFmt.format(parse(addDays(s, p.weeks * 7 - 1)))}. They get their own copy.` : "";
    };
    box.addEventListener("change", sum);
    box.addEventListener("click", async (e) => {
      if (e.target.closest("[data-x]")) return box.remove();
      if (e.target.closest("#as-go")) {
        if (!pid()) return toast("Pick a program");
        const who = box.querySelector("#as-who").value;
        const { data: n, error } = await db.rpc("coach_assign_program", { p_program: pid(), p_client: who, p_start: box.querySelector("#as-start").value });
        if (error) return toast(error.message);
        box.remove();
        toast(`Assigned ${n} workout${n === 1 ? "" : "s"}`);
        ctx.render();
      }
    });
    sum();
  }

  async function loadProgList() {
    const { data } = await db.from("programs").select("id,title,weeks").order("updated_at", { ascending: false });
    st.progList = data ?? [];
  }

  // =========================================================================
  // Events (one set of listeners on the coach root)
  // =========================================================================
  let drag = null;
  ctx.root.addEventListener("click", async (e) => {
    const t = e.target.closest("button, tr[data-t-day-open]");
    if (!t) return;
    const c = st.client;
    // client page
    if (t.dataset.tTab) { c.tab = t.dataset.tTab; return ctx.render(); }
    if (t.dataset.tWeek) { c.week = t.dataset.tWeek === "0" ? mondayOf(todayStr()) : addDays(c.week, Number(t.dataset.tWeek)); return ctx.render(); }
    if (t.dataset.tAdd) {
      return openBuilder({ heading: `New workout · ${c.is_me ? "You" : c.detail?.member?.name || ""}`, date: t.dataset.tAdd, onSave: (p) => saveWorkout(p, null) });
    }
    if (t.dataset.tOpen) {
      const w = c.detail.workouts.find((x) => x.id === t.dataset.tOpen);
      if (!w) return;
      return loggedAny(w) ? openLogged(w) : editWorkout(w);
    }
    if (t.dataset.tDayOpen) { c.openDay = c.openDay === t.dataset.tDayOpen ? null : t.dataset.tDayOpen; return ctx.render(); }
    if (t.hasAttribute("data-t-targets")) return openTargetsForm();
    if (t.hasAttribute("data-t-assign")) { await loadProgList(); return openAssign(null, c.user_id); }
    if (t.dataset.tSet) {
      const m = c.detail.member;
      const s = settingsOf(m);
      s[t.dataset.tSet] = !s[t.dataset.tSet];
      const { error } = await db.from("members").update({ settings: s }).eq("id", m.id);
      if (error) return toast(error.message);
      m.settings = s;
      return ctx.render();
    }
    if (t.hasAttribute("data-t-remove")) {
      if (t.dataset.sure !== "1") { t.dataset.sure = "1"; t.textContent = "Tap again to remove access"; return; }
      const { error } = await db.from("members").delete().eq("id", c.detail.member.id);
      if (error) return toast(error.message);
      toast("Access removed. Their logs are kept.");
      st.client = null; st.view = "clients";
      return ctx.render();
    }
    // programs
    if (t.hasAttribute("data-p-new")) {
      const { data, error } = await db.from("programs").insert({ title: "New program", weeks: 1 }).select().single();
      if (error) return toast(error.message);
      st.prog = { id: data.id };
      await ctx.render();
      const ti = ctx.root.querySelector("#p-title"); ti?.focus(); ti?.select();
      return;
    }
    if (t.dataset.pEdit) { st.prog = { id: t.dataset.pEdit }; return ctx.render(); }
    if (t.hasAttribute("data-p-back")) { st.prog = null; return ctx.render(); }
    if (t.dataset.pAssign) { await loadProgList(); return openAssign(t.dataset.pAssign, null); }
    if (t.dataset.pAdd) {
      const p = st.prog.program;
      return openBuilder({ heading: `${p.title} · new workout`, dayIndex: Number(t.dataset.pAdd), weeks: p.weeks, onSave: (x) => saveProgramWorkout(x, null) });
    }
    if (t.dataset.pOpen) {
      const w = st.prog.workouts.find((x) => x.id === t.dataset.pOpen);
      const p = st.prog.program;
      return openBuilder({ initial: w, heading: `${p.title} · edit`, dayIndex: w.day_index, weeks: p.weeks,
        onSave: (x) => saveProgramWorkout(x, w.id),
        onDelete: async () => { await db.from("program_workouts").delete().eq("id", w.id); toast("Removed from program"); ctx.render(); },
        onDuplicate: (x) => saveProgramWorkout(x, null) });
    }
    if (t.dataset.pWeeks) {
      const p = st.prog.program;
      const weeks = Math.max(1, Math.min(12, p.weeks + Number(t.dataset.pWeeks)));
      if (weeks < p.weeks) {
        if (st.prog.workouts.some((w) => w.day_index >= weeks * 7) && t.dataset.sure !== "1") {
          t.dataset.sure = "1"; t.textContent = "Tap again: removes that week's workouts"; return;
        }
        await db.from("program_workouts").delete().eq("program_id", p.id).gte("day_index", weeks * 7);
      }
      await db.from("programs").update({ weeks, updated_at: new Date().toISOString() }).eq("id", p.id);
      return ctx.render();
    }
    if (t.dataset.pCopyweek) {
      const wk = Number(t.dataset.pCopyweek), p = st.prog.program;
      const rows = st.prog.workouts.filter((w) => Math.floor(w.day_index / 7) === wk).map((w) => ({
        program_id: p.id, day_index: w.day_index + 7, position: w.position, title: w.title, kind: w.kind, video_id: w.video_id,
        duration_min: w.duration_min, note: w.note, time_of_day: w.time_of_day, exercises: w.exercises }));
      if (!rows.length) return toast("Nothing in that week to copy");
      if (wk + 1 >= p.weeks) await db.from("programs").update({ weeks: Math.min(12, p.weeks + 1) }).eq("id", p.id);
      const { error } = await db.from("program_workouts").insert(rows);
      if (error) return toast(error.message);
      toast(`Copied ${rows.length} workout${rows.length === 1 ? "" : "s"} to week ${wk + 2}`);
      return ctx.render();
    }
    if (t.hasAttribute("data-p-del")) {
      if (t.dataset.sure !== "1") { t.dataset.sure = "1"; t.textContent = "Tap again to delete the program"; return; }
      await db.from("programs").delete().eq("id", st.prog.id);
      st.prog = null;
      toast("Program deleted. Workouts already assigned stay on calendars.");
      return ctx.render();
    }
  });
  ctx.root.addEventListener("change", async (e) => {
    if (!st.prog?.program) return;
    if (e.target.id === "p-title" || e.target.id === "p-desc") {
      const patch = e.target.id === "p-title" ? { title: e.target.value.trim() || "Untitled program" } : { description: e.target.value.trim() || null };
      await db.from("programs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", st.prog.id);
      Object.assign(st.prog.program, patch);
      toast("Saved");
    }
  });
  ctx.root.addEventListener("submit", async (e) => {
    if (e.target.id !== "t-name-form") return;
    e.preventDefault();
    const name = ctx.root.querySelector("#t-name").value.trim().replace(/\s+/g, " ");
    if (!name) return;
    const { error } = await db.from("members").update({ name }).eq("id", st.client.detail.member.id);
    if (error) return toast(error.message);
    toast("Saved");
    ctx.render();
  });
  // Drag workouts between days (client calendar and program weeks).
  ctx.root.addEventListener("dragstart", (e) => {
    const chip = e.target.closest("[data-t-open],[data-p-open]");
    if (!chip) return;
    drag = chip.dataset.tOpen ? { client: chip.dataset.tOpen } : { prog: chip.dataset.pOpen };
    chip.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "bf");
  });
  ctx.root.addEventListener("dragend", () => { drag = null; ctx.root.querySelectorAll(".dragging,.drop-on").forEach((x) => x.classList.remove("dragging", "drop-on")); });
  ctx.root.addEventListener("dragover", (e) => {
    if (!drag) return;
    const day = e.target.closest(drag.client ? "[data-t-day]" : "[data-p-day]");
    if (!day) return;
    e.preventDefault();
    ctx.root.querySelectorAll(".drop-on").forEach((x) => x !== day && x.classList.remove("drop-on"));
    day.classList.add("drop-on");
  });
  ctx.root.addEventListener("drop", async (e) => {
    if (!drag) return;
    const day = e.target.closest(drag.client ? "[data-t-day]" : "[data-p-day]");
    if (!day) return;
    e.preventDefault();
    const d = drag; drag = null;
    if (d.client) {
      const w = st.client.detail.workouts.find((x) => x.id === d.client);
      if (w && w.scheduled_on !== day.dataset.tDay) await moveWorkout(d.client, day.dataset.tDay);
    } else {
      const idx = Number(day.dataset.pDay);
      const w = st.prog.workouts.find((x) => x.id === d.prog);
      if (w && w.day_index !== idx) { await db.from("program_workouts").update({ day_index: idx }).eq("id", d.prog); ctx.render(); }
    }
  });

  // Open a person's page (from the client list or dashboard).
  function openClient(user_id, from = "clients") {
    st.client = { user_id, is_me: user_id === ctx.user.id, tab: "overview", week: mondayOf(todayStr()), from };
    st.view = "client";
    return ctx.render();
  }

  return { clientView, programsView, openClient, openBuilder };
}
