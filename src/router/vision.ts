// Which connected models can actually look at an image (via the OpenAI-compatible
// image_url content part). Flagged here in code so adding image support needs no
// schema change; edit this when the catalog gains or loses a multimodal model.
export function supportsVision(provider: string, modelId: string): boolean {
  if (provider === 'gemini') return true; // Gemini models are all multimodal
  if (modelId.includes('gpt-4.1')) return true; // GPT-4.1 mini/nano accept images
  if (modelId.includes('gemma')) return true; // Gemma 3/4 are multimodal
  if (/-vl\b|-vl-|vision/i.test(modelId)) return true; // vision-language models (Nemotron Super VL, Command A Vision)
  return false;
}

type Part = { type?: string };
type Message = { content?: unknown };

/** True if any message carries an image_url part — i.e. the request needs a vision model. */
export function hasImageContent(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    const content = (m as Message)?.content;
    return Array.isArray(content) && content.some((p) => (p as Part)?.type === 'image_url');
  });
}
