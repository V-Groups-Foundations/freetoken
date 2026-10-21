// How models are named in the UI: FreeToken reports "provider/model" ("requesty/nvidia/nemotron-3-ultra-550b-a55b").

/** "requesty/nvidia/nemotron-3-ultra-550b-a55b" → "nemotron-3-ultra-550b-a55b" */
export const shortModel = (ref: string) => ref.split("/").pop()!.replace(/:free$/, "");

/** "requesty/nvidia/nemotron-3-ultra-550b-a55b" → "requesty" */
export const providerOf = (ref: string) => ref.split("/")[0];

/** FreeToken's task kinds, as the user would say them. */
const TASKS: Record<string, string> = {
  agent: "agent work", code: "coding", reasoning: "reasoning", vision: "images", creative: "writing", chat: "chat",
};
export const taskLabel = (task?: string) => (task ? TASKS[task] ?? task : "");
