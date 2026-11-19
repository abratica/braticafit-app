// Emails sent by the app itself (not sign-in links): the welcome email for new clients.
// Sent through Resend from Andrew's braticafit.com address.

export const APP_URL = "https://abratica.github.io/braticafit-app/";
const LOGO = APP_URL + "icons/wordmark-email.png";
const FROM = "Andrew from BraticaFit <andrew@braticafit.com>";
const REPLY_TO = "andrew@braticafit.com";

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
export function renderWelcome(tpl: { subject: string; body: string }, name: string, email: string) {
  const first = (name || "").trim().split(/\s+/)[0] || "there";
  const fill = (s: string) => s.replace(/\{\s*first name\s*\}/gi, first);
  const link = `${APP_URL}?email=${encodeURIComponent(email)}`;
  const subject = fill(tpl.subject).trim() || "Welcome to BraticaFit";
  let body = fill(tpl.body).replace(/\r\n/g, "\n").trim();
  if (!/\{\s*button\s*\}/i.test(body)) body += "\n\n{button}";

  const button = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px"><tr><td style="border-radius:10px;background:#fb4311">
    <a href="${link}" style="display:inline-block;padding:14px 26px;font:700 15px/1 Arial,Helvetica,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#ffffff;text-decoration:none">Open BraticaFit</a>
  </td></tr></table>`;

  const blocks = body.split(/\n{2,}/).map((p) =>
    /^\s*\{\s*button\s*\}\s*$/i.test(p)
      ? button
      : `<p style="margin:0 0 18px;font:16px/1.55 Arial,Helvetica,sans-serif;color:#eeeeee">${esc(p).replace(/\n/g, "<br>")}</p>`
  ).join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0d0d0d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
    <tr><td style="padding:0 0 26px"><img src="${LOGO}" width="200" alt="BraticaFit" style="display:block;width:200px;height:auto;border:0"></td></tr>
    <tr><td style="background:#171717;border:1px solid #2a2a2a;border-radius:16px;padding:28px 26px 10px">${blocks}</td></tr>
    <tr><td style="padding:18px 4px 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:#8a8a8a">Button not working? Open ${esc(APP_URL)} and sign in with ${esc(email)}.</td></tr>
  </table>
</td></tr></table></body></html>`;

  const text = body.replace(/\{\s*button\s*\}/gi, `Open BraticaFit: ${link}`);
  return { subject, html, text };
}

export async function sendEmail(to: string, msg: { subject: string; html: string; text: string }) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("Email isn't connected yet");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, ...msg }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Email failed (${res.status})`);
  return data?.id as string | undefined;
}
