import { z } from 'zod';
import { loadCredentials } from '@/keys/service';
import { generateImage } from '@/images/generate';
import { generateImageGemini } from '@/images/gemini';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  engine: z.enum(['pollinations', 'gemini']).optional(),
  model: z.string().max(40).optional(),
});

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: 'A prompt (1–2000 characters) is required.' } }, { status: 400 });

  const deps = getDeps();

  if (parsed.data.engine === 'gemini') {
    const gemini = (await loadCredentials(deps.db, uid, deps.vaultKey)).get('gemini');
    if (!gemini) return Response.json({ error: { message: 'Connect Gemini at /connect to use the Gemini engine.' } }, { status: 400 });
    const result = await generateImageGemini({ prompt: parsed.data.prompt }, gemini.creds.key, { fetchImpl: deps.fetchImpl });
    if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status || 502 });
    return Response.json({ dataUrl: result.dataUrl });
  }

  // Default engine: keyless Pollinations (free FLUX/Turbo) — no provider needed.
  const result = await generateImage({ prompt: parsed.data.prompt, model: parsed.data.model }, { fetchImpl: deps.fetchImpl });
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status || 502 });
  return Response.json({ dataUrl: result.dataUrl });
}
