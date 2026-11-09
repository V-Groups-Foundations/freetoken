import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { tapAssistant } from '@/server/stream';
import { routeChat } from '@/router/execute';
import { getDeps } from '@/server/deps';
import { coachSystemPrompt, parseDietBlocks, stripDietBlocks } from '@/diet/protocol';
import { addDietMessage, applyDietActions, coachState, listDietMessages, savedReply } from '@/diet/service';
import { dayParam } from '@/diet/day';

// the coach is told the user's numbers every turn, so it needs only the recent conversation
const HISTORY = 30;

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  // words, or words and up to 3 photos (a plate, a nutrition label) for a vision model to read
  const content = z.union([
    z.string().trim().min(1).max(20_000),
    z.array(z.union([
      z.object({ type: z.literal('text'), text: z.string().max(20_000) }),
      z.object({ type: z.literal('image_url'), image_url: z.object({ url: z.string().startsWith('data:image/').max(6_000_000) }) }),
    ])).min(1).max(4).refine((parts) => parts.filter((p) => p.type === 'image_url').length <= 3, 'Up to 3 photos.'),
  ]);
  const parsed = z.object({ content, day: z.string().optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: 'Message is required (and up to 3 photos).' } }, { status: 400 });
  const rich = parsed.data.content;
  const photos = typeof rich === 'string' ? 0 : rich.filter((p) => p.type === 'image_url').length;
  // saved as text: the photos become a marker, so the conversation stays small
  const words = typeof rich === 'string' ? rich : rich.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n').trim();
  const stored = `${photos ? `📷 ${photos === 1 ? 'photo' : `${photos} photos`}${words ? '\n' : ''}` : ''}${words}`;
  const today = dayParam(parsed.data.day);
  const db = getDb();

  const [state, prior] = await Promise.all([coachState(db, uid, today), listDietMessages(db, uid, HISTORY)]);
  // earlier replies without their recording blocks: what was logged is in the system prompt already
  const history = prior.map((m) => ({ role: m.role, content: m.role === 'assistant' ? stripDietBlocks(m.content) || '(logged)' : m.content }));
  const out = await routeChat({
    // a photo needs a model that can see; words go to the best reasoner (the numbers are arithmetic)
    userId: uid, source: 'chat', task: photos ? 'vision' : 'reasoning', session: `diet:${uid}`,
    body: { model: 'auto-smart', messages: [{ role: 'system', content: coachSystemPrompt(state) }, ...history, { role: 'user', content: rich }], stream: true },
  }, getDeps());
  if (!out.ok) return Response.json({ error: { message: out.message, code: out.code } }, { status: out.status });
  await addDietMessage(db, uid, { role: 'user', content: stored });

  const provider = out.response.headers.get('x-freetoken-provider');
  const body = out.response.body
    ? tapAssistant(out.response.body, (text) => {
        // the log first, then the reply: the page waits for the reply to appear, and the log is ready by then
        void applyDietActions(db, uid, today, parseDietBlocks(text), words)
          .then((applied) => addDietMessage(db, uid, { role: 'assistant', content: savedReply(text, applied), provider }))
          .catch((e) => console.error('diet: saving the reply failed', e));
      })
    : null;
  return new Response(body, { status: 200, headers: out.response.headers });
}
