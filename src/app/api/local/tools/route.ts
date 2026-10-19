import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { createToken } from '@/server/tokens';
import { localLoginEnabled, localOwner } from '@/server/local-login';
import { connectTool, detectEnv, disconnectTool, toolStatus, type ToolId } from '@/server/tools-connect';

const TOOL_TOKEN_NAME: Record<ToolId, string> = {
  'claude-code': 'Claude Code', codex: 'Codex', aider: 'Aider', continue: 'Continue', freetoken: 'CLI', cursor: 'Cursor', cline: 'Cline',
};

/**
 * Connecting a tool writes files in the home folder of whoever runs this server, so only that
 * person may do it: local installs only, the install's owner, and a header other websites can't send.
 */
async function guard(req: Request) {
  if (!localLoginEnabled()) return 'Connecting tools is only available on your own computer.';
  if (req.headers.get('x-freetoken-ui') !== '1') return 'Not allowed.';
  const uid = await sessionUserId();
  if (!uid || (await localOwner(getDb())).id !== uid) return 'Only the owner of this FreeToken can connect tools.';
  return null;
}
const forbidden = (error: string) => Response.json({ error }, { status: 403 });

export async function GET(req: Request) {
  const no = await guard(req);
  if (no) return forbidden(no);
  return Response.json({ tools: toolStatus(detectEnv()) });
}

export async function POST(req: Request) {
  const no = await guard(req);
  if (no) return forbidden(no);
  const p = z.object({ tool: z.enum(['freetoken', 'claude-code', 'aider', 'codex', 'continue', 'cursor', 'cline']), action: z.enum(['connect', 'disconnect', 'key']) })
    .safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Unknown tool or action.' }, { status: 400 });
  const { tool, action } = p.data;
  const env = detectEnv();
  const baseUrl = `${new URL(req.url).origin}/api/v1`;
  const db = getDb();
  const owner = await localOwner(db);
  try {
    if (action === 'disconnect') {
      disconnectTool(tool, env);
      return Response.json({ ok: true, message: 'Disconnected. (Its key stays under API until you revoke it.)', tools: toolStatus(env) });
    }
    const token = await createToken(db, owner.id, TOOL_TOKEN_NAME[tool]);
    // tools configured inside their own app: hand over the values to paste
    if (action === 'key' || tool === 'cursor' || tool === 'cline') return Response.json({ ok: true, key: token, baseUrl, model: 'auto-smart' });
    const r = connectTool(tool, env, baseUrl, token);
    return Response.json({ ok: true, ...r, tools: toolStatus(env) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
