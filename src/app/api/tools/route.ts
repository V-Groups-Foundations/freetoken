import { z } from 'zod';
import { getTool, buildToolMessages } from '@/tools/registry';
import { completeText } from '@/server/complete';
import { sessionUserId } from '@/lib/session';
import { loadCredentials } from '@/keys/service';
import { getDeps } from '@/server/deps';
import { resolveTarget, translateDeepL } from '@/translate/deepl';

const bodySchema = z.object({
  tool: z.string().min(1),
  input: z.string().trim().min(1).max(100_000),
  option: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: 'A tool and input text are required.' } }, { status: 400 });

  const tool = getTool(parsed.data.tool);
  if (!tool) return Response.json({ error: { message: 'Unknown tool.' } }, { status: 400 });

  const option = parsed.data.option?.trim() ?? '';
  if (tool.option?.required && !option) {
    return Response.json({ error: { message: `${tool.option.label} is required.` } }, { status: 400 });
  }

  // Translator: prefer DeepL when connected and the target maps to a DeepL code; else fall through to the LLM.
  if (tool.id === 'translate') {
    const target = resolveTarget(option);
    if (target) {
      const deps = getDeps();
      const deepl = (await loadCredentials(deps.db, uid, deps.vaultKey)).get('deepl');
      if (deepl) {
        try {
          const out = await translateDeepL(parsed.data.input, target, deepl.creds.key, deps.fetchImpl);
          return Response.json({ output: out, provider: 'deepl' });
        } catch {
          // DeepL unavailable — fall back to LLM translation below.
        }
      }
    }
  }

  const result = await completeText(uid, buildToolMessages(tool, parsed.data.input, option), {
    responseFormatJson: tool.jsonMode,
    temperature: tool.jsonMode ? 0 : 0.3,
  });
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status });

  return Response.json({ output: result.text, provider: result.provider });
}
