export const MAX_BODY_BYTES = 1_000_000;
export const MAX_MESSAGES = 200;

export function validateChatBody(
  raw: unknown,
  rawLength: number,
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  if (rawLength > MAX_BODY_BYTES) return { ok: false, message: 'Request body too large (max 1 MB).' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Body must be a JSON object.' };
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, message: 'messages must be a non-empty array.' };
  }
  if (body.messages.length > MAX_MESSAGES) return { ok: false, message: `Too many messages (max ${MAX_MESSAGES}).` };
  return { ok: true, body };
}
