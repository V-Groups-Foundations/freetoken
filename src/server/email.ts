// Sending account emails (password reset, address verification) through Resend's HTTP API.
// Off until RESEND_API_KEY is set; EMAIL_FROM is the sender ("FreeToken <no-reply@your-domain>") — without
// a verified domain of your own, Resend's test sender only delivers to the Resend account's own address.

export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY);

export async function sendEmail(to: string, subject: string, text: string, html: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'email is not set up' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'FreeToken <onboarding@resend.dev>', to: [to], subject, text, html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A plain, readable email with one button. */
export function linkEmail(title: string, intro: string, button: string, url: string, outro: string) {
  const text = `${title}\n\n${intro}\n\n${url}\n\n${outro}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
<h2 style="margin:0 0 12px">${esc(title)}</h2><p>${esc(intro)}</p>
<p style="margin:24px 0"><a href="${esc(url)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(button)}</a></p>
<p style="color:#555;font-size:13px">${esc(outro)}</p><p style="color:#888;font-size:12px;word-break:break-all">${esc(url)}</p></div>`;
  return { text, html };
}
