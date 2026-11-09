/** The user's calendar day as the page sent it (YYYY-MM-DD in their time zone); the server's own day otherwise. */
export function dayParam(v: unknown): string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10);
}
