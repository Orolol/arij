import type { StreamChunk, QuestionData } from "@/lib/claude/spawn";
import type { ProviderResult } from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only complete tool calls can present questions (never streaming JSON fragments). */
export function piQuestions(event: Record<string, unknown>): QuestionData[] | undefined {
  if (event.type !== "tool_execution_start" || event.toolName !== "AskUserQuestion" || !record(event.args)) return;
  const questions = event.args.questions;
  if (!Array.isArray(questions) || !questions.length || questions.length > 4) return;
  const valid = questions.every((q) => record(q) && typeof q.question === "string" &&
    typeof q.header === "string" && typeof q.multiSelect === "boolean" && Array.isArray(q.options) &&
    q.options.every((o) => record(o) && typeof o.label === "string" && typeof o.description === "string"));
  return valid ? questions as QuestionData[] : undefined;
}

export function piStreamEvent(event: Record<string, unknown>): StreamChunk | undefined {
  const questions = piQuestions(event);
  if (questions) return { type: "questions", questions };
  if (event.type === "message_update" && record(event.assistantMessageEvent)) {
    const delta = event.assistantMessageEvent;
    if (delta.type === "text_delta" && typeof delta.delta === "string") return { type: "text", text: delta.delta };
    if (delta.type === "thinking_start") return { type: "status", status: "Thinking..." };
  }
  if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
    return { type: "status", status: `Using ${event.toolName}...` };
  }
}

/** Per-request assistant usage; session history and agent_end echoes are not counted again. */
export function extractPiUsage(stdout: string): ProviderResult["usage"] {
  let found = false;
  const total = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
  const childCalls = new Set<string>();
  const n = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  for (const line of stdout.split("\n")) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!record(event)) continue;
    if (event.type === "message_end" && record(event.message) && event.message.role === "assistant" && record(event.message.usage)) {
      const usage = event.message.usage;
      found = true;
      total.inputTokens += n(usage.input) + n(usage.cacheRead) + n(usage.cacheWrite);
      total.outputTokens += n(usage.output);
      if (record(usage.cost)) total.totalCostUsd += n(usage.cost.total);
    }
    if (event.type === "tool_execution_end" && event.toolName === "Task" && typeof event.toolCallId === "string" &&
        !childCalls.has(event.toolCallId) && record(event.result) && record(event.result.details) && record(event.result.details.usage)) {
      childCalls.add(event.toolCallId);
      found = true;
      const usage = event.result.details.usage;
      total.inputTokens += n(usage.inputTokens);
      total.outputTokens += n(usage.outputTokens);
      total.totalCostUsd += n(usage.totalCostUsd);
    }
  }
  return found ? total : undefined;
}
