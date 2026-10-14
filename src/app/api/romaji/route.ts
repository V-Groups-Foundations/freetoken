import { z } from 'zod';
import { completeText } from '@/server/complete';
import { sessionUserId } from '@/lib/session';

const bodySchema = z.object({ text: z.string().trim().min(1).max(4000) });

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: 'Japanese text is required.' } }, { status: 400 });

  const result = await completeText(
    uid,
    [
      {
        role: 'system',
        content:
          'Convert the Japanese text to Hepburn romaji (romanized Japanese). Output only the romaji — ' +
          'no translation, no notes — preserving line breaks and sentence spacing. Capitalize sentence starts.',
      },
      { role: 'user', content: parsed.data.text },
    ],
    { temperature: 0 },
  );
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status });
  return Response.json({ romaji: result.text, provider: result.provider });
}
