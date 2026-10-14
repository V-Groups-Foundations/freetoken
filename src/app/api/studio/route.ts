import { z } from 'zod';
import { completeText } from '@/server/complete';
import { sessionUserId } from '@/lib/session';

const bodySchema = z.object({ prompt: z.string().trim().min(1).max(2000) });

const SYSTEM =
  'You build small, self-contained web apps and games. Respond with ONE complete HTML document only — ' +
  'no explanation, no Markdown fences. Inline all CSS in a <style> tag and all JavaScript in a <script> tag; ' +
  'do not reference external files or networks. Make it work when opened directly in a browser, keyboard- and ' +
  'touch-friendly, and sized to fit an iframe (use 100% width/height). Prefer a dark, polished look.';

/** Pull the HTML document out of a model reply, tolerating stray Markdown fences. */
function extractHtml(text: string): string {
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : text).trim();
  const start = body.search(/<!doctype html|<html/i);
  return start > 0 ? body.slice(start) : body;
}

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: 'Describe what to build (1–2000 characters).' } }, { status: 400 });

  const result = await completeText(
    uid,
    [{ role: 'system', content: SYSTEM }, { role: 'user', content: parsed.data.prompt }],
    { temperature: 0.7 },
  );
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status });

  const html = extractHtml(result.text);
  if (!/<[a-z!]/i.test(html)) return Response.json({ error: { message: 'The model did not return valid HTML. Try rephrasing.' } }, { status: 502 });
  return Response.json({ html, provider: result.provider });
}
