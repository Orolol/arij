/**
 * Pure parsing logic for extracting epic data from conversation messages.
 * Extracted from useEpicCreate.ts so it can be tested independently.
 */

export interface ParsedUserStory {
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
}

export interface ParsedEpic {
  title: string;
  description: string;
  userStories: ParsedUserStory[];
}

export interface ConversationMessage {
  role: string;
  content: string;
}

function cleanLine(input: string): string {
  return input.replace(/\*\*/g, "").replace(/^["'`]+|["'`]+$/g, "").trim();
}

export function extractJsonCandidates(content: string): string[] {
  const candidates: string[] = [];

  // 1. Code-fenced JSON blocks
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of content.matchAll(fenceRegex)) {
    if (match[1]) {
      candidates.push(match[1].trim());
    }
  }

  // 2. Entire content is a JSON object
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }

  // 3. Embedded JSON object in text (no code fence) — greedy brace matching
  if (candidates.length === 0) {
    const startIdx = content.indexOf("{");
    if (startIdx !== -1) {
      // Find the matching closing brace by counting nesting
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = startIdx; i < content.length; i++) {
        const ch = content[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === "{") depth++;
        if (ch === "}") {
          depth--;
          if (depth === 0) {
            const candidate = content.slice(startIdx, i + 1);
            try {
              JSON.parse(candidate);
              candidates.push(candidate);
            } catch {
              // Not valid JSON, skip
            }
            break;
          }
        }
      }
    }
  }

  return candidates;
}

function normalizeChecklist(items: string[]): string | null {
  if (items.length === 0) return null;
  return items.map((item) => `- [ ] ${item}`).join("\n");
}

function toRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function toTextScalar(input: unknown): string | null {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed.length > 0 ? cleanLine(trimmed) : null;
  }

  if (typeof input === "number" || typeof input === "boolean") {
    return String(input);
  }

  const record = toRecord(input);
  if (record) {
    const keys = ["text", "description", "title", "name", "value"];
    for (const key of keys) {
      const value = toTextScalar(record[key]);
      if (value) return value;
    }
  }

  return null;
}

function toJoinedText(input: unknown, separator = "\n\n"): string | null {
  if (Array.isArray(input)) {
    const parts = input.map((item) => toTextScalar(item)).filter((part): part is string => Boolean(part));
    if (parts.length === 0) return null;
    return cleanLine(parts.join(separator));
  }
  return toTextScalar(input);
}

function normalizeChecklistItem(input: string): string {
  return input.replace(/^[-*]\s+\[[xX ]\]\s+/, "").replace(/^[-*]\s+/, "").trim();
}

function normalizeAcceptanceCriteria(input: unknown): string | null {
  if (typeof input === "string") {
    const normalized = cleanLine(input);
    return normalized.length > 0 ? normalized : null;
  }

  if (!Array.isArray(input)) {
    return null;
  }

  const items = input
    .map((item) => toTextScalar(item))
    .filter((item): item is string => Boolean(item))
    .map((item) => normalizeChecklistItem(item))
    .filter((item) => item.length > 0);

  return normalizeChecklist(items);
}

function hasStoriesArray(record: Record<string, unknown>): boolean {
  return (
    Array.isArray(record.userStories) ||
    Array.isArray(record.user_stories) ||
    Array.isArray(record.stories) ||
    Array.isArray(record.items)
  );
}

function maybeParseJsonObject(input: string): Record<string, unknown> | null {
  const trimmed = input.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return toRecord(parsed);
  } catch {
    return null;
  }
}

function unwrapEpicPayload(raw: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [raw];
  const seen = new Set<unknown>();
  const wrapperKeys = ["epic", "data", "result", "payload"];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const record = toRecord(current);
    if (!record) continue;

    if (typeof record.title === "string" && record.title.trim().length > 0 && hasStoriesArray(record)) {
      return record;
    }

    for (const key of wrapperKeys) {
      const value = record[key];
      if (!value) continue;
      if (typeof value === "string") {
        const parsed = maybeParseJsonObject(value);
        if (parsed) queue.push(parsed);
        continue;
      }
      queue.push(value);
    }
  }

  return null;
}

function toParsedEpicFromJson(raw: unknown): ParsedEpic | null {
  const input = unwrapEpicPayload(raw);
  if (!input) return null;

  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    return null;
  }

  const storiesRaw = Array.isArray(input.userStories)
    ? input.userStories
    : Array.isArray(input.user_stories)
      ? input.user_stories
      : Array.isArray(input.stories)
        ? input.stories
        : Array.isArray(input.items)
          ? input.items
      : [];

  const userStories: ParsedUserStory[] = storiesRaw
    .map((story) => {
      const storyInput = toRecord(story);
      if (!storyInput) return null;

      const title = toTextScalar(storyInput.title);
      if (!title) {
        return null;
      }

      const rawAcceptance = storyInput.acceptanceCriteria ?? storyInput.acceptance_criteria;
      const acceptance =
        typeof rawAcceptance === "string"
          ? rawAcceptance
          : Array.isArray(rawAcceptance)
            ? normalizeChecklist(
                rawAcceptance.filter((item): item is string => typeof item === "string"),
              )
            : null;

      return {
        title,
        description: toJoinedText(storyInput.description, "\n\n"),
        acceptanceCriteria: acceptance,
      };
    })
    .filter((story): story is ParsedUserStory => Boolean(story));

  if (userStories.length === 0) {
    return null;
  }

  return {
    title: cleanLine(input.title),
    description: toJoinedText(input.description, "\n\n") || "Epic generated from conversation",
    userStories,
  };
}

function parseEpicFromJson(messages: ConversationMessage[]): ParsedEpic | null {
  const assistantContents = messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .filter((content) => content.trim().length > 0)
    .reverse();

  for (const content of assistantContents) {
    const candidates = extractJsonCandidates(content);
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const epic = toParsedEpicFromJson(parsed);
        if (epic) return epic;
      } catch {
        // Ignore malformed JSON candidates.
      }
    }
  }

  return null;
}

function extractEpicTitle(text: string): string | null {
  const explicitPatterns = [
    /(?:^|\n)\s*Epic\s+Title\s*:\s*(.+)/i,
    /(?:^|\n)\s*Title\s*:\s*(.+)/i,
    /(?:^|\n)\s*Epic\s*:\s*(.+)/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanLine(match[1]);
  }

  const heading = text.match(/(?:^|\n)\s*#+\s+(.+)/);
  if (heading?.[1]) {
    return cleanLine(heading[1]);
  }

  return null;
}

function extractEpicDescription(text: string): string | null {
  const explicitDescription = text.match(
    /(?:^|\n)\s*(?:Epic\s+Description|Description)\s*:\s*([\s\S]*?)(?:\n\s*(?:User\s+Stories|Stories)\b|$)/i,
  );
  if (explicitDescription?.[1]) {
    const normalized = cleanLine(explicitDescription[1]);
    if (normalized.length > 0) return normalized;
  }

  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !/^[-*]\s/.test(line) &&
        !/^\d+\.\s/.test(line) &&
        !/^As a[n]? /i.test(line) &&
        !/^acceptance criteria/i.test(line) &&
        !/^criteria/i.test(line) &&
        !/^Epic\s*:/i.test(line) &&
        !/^Title\s*:/i.test(line),
    );

  if (paragraphs.length === 0) return null;
  return cleanLine(paragraphs.slice(0, 2).join(" "));
}

function extractStoriesFromText(text: string): ParsedUserStory[] {
  const lines = text.split(/\r?\n/);
  const parsed: Array<{
    title: string;
    descriptionParts: string[];
    criteria: string[];
  }> = [];

  let current: {
    title: string;
    descriptionParts: string[];
    criteria: string[];
  } | null = null;
  let collectingCriteria = false;

  function commitCurrent() {
    if (!current) return;
    parsed.push(current);
    current = null;
    collectingCriteria = false;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const storyMatch =
      line.match(/^(?:[-*]|\d+\.)\s*(As a[n]? .+)/i) || line.match(/^(As a[n]? .+)/i);
    if (storyMatch?.[1]) {
      commitCurrent();
      current = {
        title: cleanLine(storyMatch[1]),
        descriptionParts: [],
        criteria: [],
      };
      continue;
    }

    if (!current) continue;

    if (/^acceptance criteria[:]?$/i.test(line) || /^criteria[:]?$/i.test(line)) {
      collectingCriteria = true;
      continue;
    }

    const checklistMatch = line.match(/^[-*]\s+\[[xX ]\]\s+(.+)$/) || line.match(/^[-*]\s+(.+)$/);
    if (collectingCriteria && checklistMatch?.[1]) {
      current.criteria.push(cleanLine(checklistMatch[1]));
      continue;
    }

    if (!collectingCriteria && !line.startsWith("#")) {
      current.descriptionParts.push(cleanLine(line));
    }
  }

  commitCurrent();

  const byTitle = new Map<string, ParsedUserStory>();
  for (const story of parsed) {
    const title = cleanLine(story.title);
    if (!title) continue;
    if (byTitle.has(title)) continue;

    byTitle.set(title, {
      title,
      description: story.descriptionParts.length > 0 ? story.descriptionParts.join(" ") : null,
      acceptanceCriteria: normalizeChecklist(story.criteria),
    });
  }

  return Array.from(byTitle.values());
}

export function parseEpicFromConversation(messages: ConversationMessage[]): ParsedEpic | null {
  const fromJson = parseEpicFromJson(messages);
  if (fromJson) return fromJson;

  const assistantText = messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join("\n\n");
  const userText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join("\n\n");

  const title = extractEpicTitle(assistantText) || extractEpicTitle(userText);
  const description = extractEpicDescription(assistantText) || extractEpicDescription(userText);
  const userStories = extractStoriesFromText(assistantText);

  if (!title || userStories.length === 0) {
    return null;
  }

  return {
    title,
    description: description || "Epic generated from conversation",
    userStories,
  };
}
