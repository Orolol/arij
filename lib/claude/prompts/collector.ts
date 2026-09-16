/** Account for the exact fragments emitted by composition, without changing their order. */
import type { PromptContextSectionKey, PromptSectionCollector } from "../prompt-sections";

export function pushPromptPart(
  parts: string[],
  collector: PromptSectionCollector | undefined,
  key: PromptContextSectionKey,
  text: string,
): void {
  parts.push(text);
  if (text) collector?.(key, text);
}
