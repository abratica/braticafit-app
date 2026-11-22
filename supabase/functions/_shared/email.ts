// Emails sent by the app itself (not sign-in links): the welcome email for new clients.
// Sent through Resend from Andrew's braticafit.com address.

export const APP_URL = "https://abratica.github.io/braticafit-app/";
const LOGO = APP_URL + "icons/wordmark-email-clarity.png";
const FROM = "Andrew from BraticaFit <andrew@braticafit.com>";
const REPLY_TO = "andrew@braticafit.com";
export const COACH_INBOX = "andrew@braticafit.com";

export const DEFAULT_WELCOME = {
  subject: "Welcome to BraticaFit, {first name}",
  body: `Hey {first name},

You're in. This is where your workouts, food log, and check-ins with me will live.

{button}

On your phone, add it to your home screen so it works like an app.

Talk soon,
Andrew`,
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function emailConfigured() {
  return !!Deno.env.get("RESEND_API_KEY");
}

// Fill in {first name} and turn the plain-text body into the branded HTML email.
// `signIn` is a one-time link that opens the app already signed in; without it the button just opens the app.
export function renderWelcome(tpl: { subject: string; body: string }, name: string, email: string, signIn?: string) {
  const first = (name || "").trim().split(/\s+/)[0] || "there";
  const fill = (s: string) => s.replace(/\{\s*first name\s*\}/gi, first);
  const link = signIn || `${APP_URL}?email=${encodeURIComponent(email)}`;
  const subject = fill(tpl.subject).trim() || "Welcome to BraticaFit";
  let body = fill(tpl.body).replace(/\r\n/g, "\n").trim();
  if (!/\{\s*button\s*\}/i.test(body)) body += "\n\n{button}";

  const button = btn(link, "Open BraticaFit");

  const blocks = body.split(/\n{2,}/).map((p) =>
    /^\s*\{\s*button\s*\}\s*$/i.test(p)
      ? button
      : para(esc(p).replace(/\n/g, "<br>"))
  ).join("\n");

  const html = layout(blocks, `Button not working or expired? Open ${esc(APP_URL)} and sign in with ${esc(email)}.`);
  const text = body.replace(/\{\s*button\s*\}/gi, `Open BraticaFit: ${link}`);
  return { subject, html, text };
}

// Clarity look: light page, white card, dark text, blue pill button.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const para = (html: string) => `<p style="margin:0 0 18px;font:16px/1.6 ${FONT};color:#0F0F0E">${html}</p>`;
const btn = (href: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 24px"><tr><td style="border-radius:999px;background:#2563EB">
    <a href="${href}" style="display:inline-block;padding:15px 30px;font:600 16px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:999px">${label}</a>
  </td></tr></table>`;

function layout(inner: string, foot: string) {
  return `<!doctype html><html><head><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#F9F9F8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9F9F8"><tr><td align="center" style="padding:36px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
    <tr><td style="padding:0 0 24px"><img src="${LOGO}" width="200" alt="BraticaFit" style="display:block;width:200px;height:auto;border:0"></td></tr>
    <tr><td style="background:#FFFFFF;border:1px solid #E8E8E4;border-radius:16px;padding:30px 28px 10px">${inner}</td></tr>
    <tr><td style="padding:18px 4px 0;font:13px/1.5 ${FONT};color:#6B6B66">${foot}</td></tr>
  </table>
</td></tr></table></body></html>`;
}

// Heads-up to Andrew when someone asks for access from the sign-in screen.
export function renderAccessRequest(r: { name: string; email: string; note?: string | null }) {
  const p = para;
  const link = `${APP_URL}#coach=clients`;
  const inner = p(`<b>${esc(r.name)}</b> asked for access to BraticaFit.`) +
    p(`Email: ${esc(r.email)}`) +
    (r.note ? p(`Note: ${esc(r.note).replace(/\n/g, "<br>")}`) : "") +
    btn(link, "Review in coach mode");
  return {
    subject: `Access request: ${r.name}`,
    html: layout(inner, "Add them as a client or dismiss the request on your Clients page."),
    text: `${r.name} (${r.email}) asked for access to BraticaFit.${r.note ? `\nNote: ${r.note}` : ""}\n\nReview: ${link}`,
  };
}

export async function sendEmail(to: string, msg: { subject: string; html: string; text: string }, replyTo = REPLY_TO) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("Email isn't connected yet");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: replyTo, ...msg }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Email failed (${res.status})`);
  return data?.id as string | undefined;
}
