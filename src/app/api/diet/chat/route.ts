import { z } from 'zod';
import { after } from 'next/server';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { tapAssistant } from '@/server/stream';
import { routeChat } from '@/router/execute';
import { getDeps } from '@/server/deps';
import { cleanReply, coachSystemPrompt, onlyAsking, parseDietBlocks, stripDietBlocks, todayLine } from '@/diet/protocol';
import { addDietMessage, applyDietActions, coachState, deleteDietMessage, exactNumbers, getProfile, listDietMessages, listEntries, myFoods, savedReply } from '@/diet/service';
import { portionLine } from '@/diet/portion';
import { dayParam } from '@/diet/day';
import { menuFacts } from '@/diet/eating-out';
import { loadCredentials } from '@/keys/service';
import { searchWeb } from '@/web/search';

/** "Today", "Yesterday (Wed 11-11)", or "Mon 11-09". */
function dayLabel(d: string, today: string) {
  if (d === today) return 'Today';
  const date = new Date(`${d}T12:00:00Z`);
  const name = `${date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${d.slice(5)}`;
  return new Date(`${today}T12:00:00Z`).getTime() - date.getTime() === 86_400_000 ? `Yesterday (${name})` : name;
}
import { currentPlan, generatePlan, trainingCoachLines } from '@/diet/plan';
import { wantsPlanChange } from '@/diet/training';

export const maxDuration = 300; // a plan rewrite asked for in the chat runs after the reply

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

  const deps = getDeps();
  // eating out: the place's menu nutrition from the web (not the model's guesses), with their own search key
  const searchKey = (await loadCredentials(db, uid, deps.vaultKey).catch(() => null))?.get('tavily')?.creds.key as string | undefined;
  const [state, prior, training, menu] = await Promise.all([coachState(db, uid, today), listDietMessages(db, uid, HISTORY), trainingCoachLines(db, uid, today),
    menuFacts(deps.kv, uid, words, searchKey ? (q) => searchWeb(q, searchKey, { maxResults: 6 }, deps.fetchImpl) : null)]);
  state.training = training;
  if (menu) state.menu = menu;
  // earlier replies without their recording blocks: what was logged is in the system prompt already
  const history = prior.map((m) => ({ role: m.role, content: m.role === 'assistant' ? stripDietBlocks(m.content) || '(logged)' : m.content }));
  const out = await routeChat({
    // a photo needs a model that can see; words go to the best reasoner (the numbers are arithmetic)
    userId: uid, source: 'chat', task: photos ? 'vision' : 'reasoning', session: `diet:${uid}`,
    body: { model: 'auto-smart', messages: [{ role: 'system', content: coachSystemPrompt(state) }, ...history, { role: 'user', content: rich }], stream: true },
  }, getDeps());
  if (!out.ok) return Response.json({ error: { message: out.message, code: out.code } }, { status: out.status });
  const asked = await addDietMessage(db, uid, { role: 'user', content: stored });

  const provider = out.response.headers.get('x-freetoken-provider');
  // the reply's full text once it has streamed; the log and any plan change are applied after the response
  let finished!: (text: string) => void;
  const replyText = new Promise<string>((ok) => { finished = ok; });
  after(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raw = await Promise.race([replyText, new Promise<string>((ok) => { timer = setTimeout(() => ok(''), 280_000); })]);
    clearTimeout(timer);
    const text = cleanReply(raw).trim();
    // no answer (the model only thought, or the stream broke): the page offers to send it again, so the
    // unanswered question is taken back out rather than left in the conversation twice
    if (!text) { await deleteDietMessage(db, uid, asked).catch(() => {}); return; }
    // a question with no photo reports nothing eaten: any food the model "logged" was its own suggestion
    const asking = !photos && onlyAsking(words);
    const actions = parseDietBlocks(text).map((a) => (asking ? { ...a, log: undefined, remove: undefined } : a));
    try {
      const balanced: string[] = [];
      const applied = await applyDietActions(db, uid, today, actions, words, balanced);
      // food logged or taken back: each day's line comes from the real log (the model's sums went wrong) —
      // food logged for yesterday gets yesterday's line, not "Today: 0 of 2000"
      let day: string | undefined;
      if (applied.log?.length || applied.remove?.length) {
        const profile = await getProfile(db, uid);
        const days = [...new Set([...(applied.log ?? []).map((i) => i.day ?? today), ...(applied.remove?.length ? [today] : [])])].sort();
        const lines = await Promise.all(days.map(async (d) => todayLine(await listEntries(db, uid, d), profile, dayLabel(d, today))));
        if (balanced.length) lines.unshift(`_Fat and carbs adjusted so they add up to the calories: ${balanced.join(', ')}._`);
        day = lines.join('\n');
      }
      // "how much should I eat": the app sizes the foods the coach named from what's really left
      const ask = actions.find((a) => a.portion)?.portion;
      let portion: string | null = null;
      if (ask) {
        const known = await myFoods(db, uid);
        portion = portionLine({ meal: ask.meal, foods: ask.foods, keep: (ask.keep ?? []).map((k) => exactNumbers(k, known)), eaten: await listEntries(db, uid, today), targets: await getProfile(db, uid) });
      }
      const lines = [day, portion].filter(Boolean).join('\n\n') || undefined;
      await addDietMessage(db, uid, { role: 'assistant', content: savedReply(text, applied, lines), provider });
      // the coach asked for a plan change — or the message plainly asked for one and the coach forgot to
      const replan = applied.replan ?? (wantsPlanChange(words, (await currentPlan(db, uid))?.plan ?? null) ? words.slice(0, 500) : null);
      if (replan) {
        const r = await generatePlan(db, uid, today, { instruction: `The client asked in chat: "${words.slice(0, 500)}". Change: ${replan}`, source: 'chat' });
        if (!r.ok) console.error('diet: replanning from chat failed', r.message);
      }
    } catch (e) { console.error('diet: saving the reply failed', e); }
  });
  const body = out.response.body
    ? tapAssistant(out.response.body, (text) => finished(text), () => finished(''))
    : null;
  if (!body) finished('');
  return new Response(body, { status: 200, headers: out.response.headers });
}
