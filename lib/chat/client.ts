import type { QuestionData } from "@/lib/claude/spawn";
import { requestJson, type ApiResult } from "@/lib/api/client";

export interface ChatAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  metadata?: string;
  attachments?: ChatAttachment[];
  createdAt: string;
}

/** HTTP acceptance persists the user message, even if the reply later fails. */
export interface ChatSendResult {
  accepted: boolean;
  error: string | null;
}

export interface ChatStreamEvent {
  status?: string;
  delta?: string;
  questions?: QuestionData[];
  done?: boolean;
}

export async function fetchChatHistory(url: string, errorMessage: string): Promise<ApiResult<ChatMessage[]>> {
  return requestJson<ChatMessage[]>(url, { errorMessage, validateData: (value): value is ChatMessage[] => Array.isArray(value) });
}

/** SSE framing and transport errors, independent of React and conversation state. */
export async function streamChatMessage(
  url: string,
  body: { content: string; conversationId: string; attachmentIds?: string[]; finalize?: boolean },
  signal: AbortSignal,
  onEvent: (event: ChatStreamEvent) => void | Promise<void>,
  errors: { request: string; send: string },
): Promise<ChatSendResult> {
  let accepted = false;
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal,
    });
    accepted = response.ok;
    if (!accepted || !response.body) {
      const payload = await response.json().catch(() => ({}));
      return { accepted, error: payload.error || errors.request };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const applyLine = async (line: string) => {
      if (!line.startsWith("data:")) return;
      let event;
      try { event = JSON.parse(line.slice(5).trim()); } catch { return; }
      if (event.error) throw new Error(event.error);
      await onEvent(event);
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) await applyLine(line);
      if (done) {
        if (buffer) await applyLine(buffer);
        break;
      }
    }
    return { accepted, error: null };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { accepted, error: null };
    return { accepted, error: error instanceof Error ? error.message : errors.send };
  }
}
