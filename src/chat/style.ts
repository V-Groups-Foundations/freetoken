// How FreeToken's chats ask models to answer. Without it, free models answered every message — even
// "I had a protein shake" — with a full report: headings, tables, the plan from two messages ago again,
// a list of "next steps" and a closing pitch.
export const CHAT_STYLE = `Answer the latest message directly and precisely.
- Match the length to the question: a short question or an update gets a few sentences, not a report.
- Don't repeat what you already said earlier in the conversation unless asked; refer to it instead.
- Use headings and tables only when the answer is genuinely long or tabular. No emoji decoration.
- No closing pitch, no menu of things you could do next, no disclaimers beyond one short line when it truly matters.
- If something important is missing, ask one short question.`;

/** The conversation as sent to the model: the style first, then the turns. */
export const withChatStyle = <T extends { role: string }>(messages: T[]) => [{ role: 'system' as const, content: CHAT_STYLE }, ...messages];
