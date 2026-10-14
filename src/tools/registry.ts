// Small, focused text transforms that run over the user's existing chat models.
// Each tool is just a system prompt plus optional one-field configuration, so adding
// one is a data edit here — no new route, no new provider.

export type ToolId = 'extract' | 'translate' | 'summarize' | 'classify';

export interface ToolDef {
  id: ToolId;
  name: string;
  description: string;
  /** A single free-text option the tool needs (e.g. target language, categories). */
  option?: { label: string; placeholder: string; required: boolean };
  /** One-click presets that fill the option field. */
  presets?: { label: string; value: string }[];
  /** Ask the provider for strict JSON output. */
  jsonMode: boolean;
  system(option: string): string;
}

export const TOOLS: ToolDef[] = [
  {
    id: 'extract',
    name: 'Data extractor',
    description: 'Pull structured fields out of messy text and return clean JSON.',
    option: { label: 'Fields to extract (optional)', placeholder: 'name, email, company, amount', required: false },
    presets: [
      { label: 'Contact info', value: 'name, email, phone, company, title, address' },
      { label: 'Receipt / invoice', value: 'merchant, date, currency, line_items (description, quantity, unit_price, amount), subtotal, tax, total' },
      { label: 'Event details', value: 'event_name, date, start_time, end_time, location, organizer, description' },
      { label: 'Résumé', value: 'name, email, phone, location, skills, experience (company, role, start, end), education (school, degree, year)' },
      { label: 'Tasks & deadlines', value: 'tasks (description, owner, due_date, priority)' },
      { label: 'Product listing', value: 'title, brand, price, currency, specs, availability' },
    ],
    jsonMode: true,
    system: (fields) =>
      'You extract structured data from text. Respond with a single JSON object (or array of objects) and nothing else. ' +
      (fields.trim()
        ? `Extract these fields: ${fields.trim()}. Use null when a field is absent.`
        : 'Choose sensible field names for the information present.'),
  },
  {
    id: 'translate',
    name: 'Translator',
    description: 'Translate text into another language, preserving tone and formatting.',
    option: { label: 'Target language', placeholder: 'Spanish', required: true },
    jsonMode: false,
    system: (lang) =>
      `You are a professional translator. Translate the user's text into ${lang.trim() || 'the requested language'}. ` +
      'Preserve meaning, tone, and any Markdown formatting. Output only the translation, no notes.',
  },
  {
    id: 'summarize',
    name: 'Summarizer',
    description: 'Condense long text into a tight summary or bullet points.',
    option: { label: 'Style (optional)', placeholder: 'three bullet points', required: false },
    jsonMode: false,
    system: (style) =>
      'You summarize text accurately and concisely, keeping the key facts and omitting filler. ' +
      (style.trim() ? `Format the summary as: ${style.trim()}.` : 'Use a short paragraph or a few bullets as fits the content.'),
  },
  {
    id: 'classify',
    name: 'Classifier',
    description: 'Label text against categories you choose.',
    option: { label: 'Categories (comma-separated)', placeholder: 'positive, neutral, negative', required: true },
    jsonMode: true,
    system: (categories) =>
      'You are a text classifier. Classify the user\'s text into exactly one of these categories: ' +
      `${categories.trim()}. Respond with a JSON object {"category": "<label>", "confidence": <0-1>, "reason": "<short>"} and nothing else.`,
  },
];

export function getTool(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

export interface ToolMessage {
  role: 'system' | 'user';
  content: string;
}

export function buildToolMessages(tool: ToolDef, input: string, option: string): ToolMessage[] {
  return [
    { role: 'system', content: tool.system(option) },
    { role: 'user', content: input },
  ];
}
