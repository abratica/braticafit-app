// Full-screen video call (Daily Prebuilt), shared by the client app and coach mode.
// The coach joins as the room owner, which starts Daily's live transcript for the call notes.

const DAILY_JS = "https://unpkg.com/@daily-co/daily-js@0/dist/daily-iframe.js";
let overlay = null, frame = null;

export const inCall = () => !!overlay;

function loadDaily() {
  if (window.Daily) return Promise.resolve(window.Daily);
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = DAILY_JS; s.async = true;
    s.onload = () => (window.Daily ? ok(window.Daily) : fail(new Error("Daily didn't load")));
    s.onerror = () => fail(new Error("Couldn't load the call. Check your connection."));
    document.head.appendChild(s);
  });
}

const THEME = {
  colors: {
    accent: "#2563EB", accentText: "#FFFFFF", background: "#0F0F0E", backgroundAccent: "#1C1C1A",
    baseText: "#F2EFE9", border: "#2A2A27", mainAreaBg: "#050505", mainAreaBgAccent: "#1C1C1A",
    mainAreaText: "#F2EFE9", supportiveText: "#A8A49C",
  },
};

// pass: { url, token, title, coach } from the call_join action.
export async function openCall(pass, { esc, toast, onEnd } = {}) {
  if (overlay) return;
  let Daily;
  try { Daily = await loadDaily(); } catch (e) { toast?.(e.message); return; }

  overlay = document.createElement("div");
  overlay.id = "call";
  overlay.innerHTML = `
    <div class="call-bar"><b>${esc ? esc(pass.title || "Call") : "Call"}</b><span class="call-tx" id="call-tx" hidden><i></i>Transcript on</span></div>
    <div class="call-stage" id="call-stage"></div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  frame = Daily.createFrame(overlay.querySelector("#call-stage"), {
    iframeStyle: { width: "100%", height: "100%", border: "0" },
    showLeaveButton: true, showFullscreenButton: false, theme: THEME,
  });
  const tx = overlay.querySelector("#call-tx");
  frame.on("transcription-started", () => { tx.hidden = false; });
  frame.on("transcription-stopped", () => { tx.hidden = true; });
  frame.on("left-meeting", () => close());
  frame.on("error", (e) => { toast?.(e?.errorMsg || "The call ran into a problem"); close(); });
  if (pass.coach) {
    // Daily starts the transcript when the owner joins; if it didn't, start it here.
    frame.on("joined-meeting", () => setTimeout(() => {
      if (frame && tx.hidden) frame.startTranscription?.().catch?.(() => {});
    }, 6000));
  }

  let ended = false;
  async function close() {
    if (ended) return;
    ended = true;
    const f = frame; frame = null;
    try { await f?.destroy(); } catch {}
    overlay?.remove(); overlay = null;
    document.body.style.overflow = "";
    onEnd?.();
  }

  try {
    await frame.join({ url: pass.url, token: pass.token });
  } catch (e) {
    toast?.("Couldn't join the call");
    console.error(e);
    close();
  }
}

// Back button while in a call: don't hang up by accident.
export function callBack(toast) {
  if (!overlay) return false;
  toast?.("Tap Leave to end the call");
  return true;
}
