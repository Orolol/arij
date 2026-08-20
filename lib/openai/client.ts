/**
 * Server-side client for OpenAI-compatible chat endpoints (fast mode).
 *
 * Talks to `{base_url}/chat/completions` with native fetch — no new
 * dependencies. The API key is read from the settings table at request
 * time and only ever placed in the Authorization header of an in-flight
 * request: it is never persisted elsewhere, never logged, and never
 * included in any response body.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  DEFAULT_OPENAI_REASONING_EFFORT,
  OPENAI_API_KEY_SETTING_KEY,
  OPENAI_BASE_URL_SETTING_KEY,
  OPENAI_MODEL_SETTING_KEY,
  OPENAI_REASONING_EFFORT_SETTING_KEY,
  parseOpenAiReasoningEffort,
  type OpenAiReasoningEffort,
} from "./constants";

export interface OpenAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: OpenAiReasoningEffort;
}

export interface OpenAiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages that requested tool calls. */
  tool_calls?: OpenAiToolCall[];
  /** Present on role:"tool" messages, echoing the call being answered. */
  tool_call_id?: string;
}

/** One function-call request emitted by the model. */
export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A function tool advertised to the endpoint. */
export interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Structured event from the tool-aware streaming generator. */
export type OpenAiStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_calls"; toolCalls: OpenAiToolCall[] };

const ERROR_PREFIX = "OpenAI-compatible API error:";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function readStringSetting(key: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = row.value;
  }
  return typeof parsed === "string" ? parsed.trim() : "";
}

/**
 * Loads the saved OpenAI-compatible configuration. Missing keys read as
 * empty strings so a half-configured section is detectable by callers
 * (the chat route 400s with a readable "not configured" error).
 */
export function getOpenAiConfigFromSettings(): OpenAiConfig {
  return {
    baseUrl: readStringSetting(OPENAI_BASE_URL_SETTING_KEY),
    apiKey: readStringSetting(OPENAI_API_KEY_SETTING_KEY),
    model: readStringSetting(OPENAI_MODEL_SETTING_KEY),
    reasoningEffort: parseOpenAiReasoningEffort(
      readStringSetting(OPENAI_REASONING_EFFORT_SETTING_KEY) ||
        DEFAULT_OPENAI_REASONING_EFFORT,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Request building                                                    */
/* ------------------------------------------------------------------ */

/** `{base_url}/chat/completions`, tolerating trailing slashes on the base. */
export function buildChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Headers for a completions request. The Authorization header is only
 * present when a key is configured, so keyless local servers work.
 */
export function buildOpenAiHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Request body for /chat/completions. `reasoning_effort` is only included
 * when it is not "off", so non-reasoning endpoints are unaffected.
 */
export function buildChatCompletionsBody(
  config: Pick<OpenAiConfig, "model" | "reasoningEffort">,
  messages: OpenAiChatMessage[],
  stream: boolean,
  tools?: OpenAiToolDefinition[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream,
  };
  if (config.reasoningEffort !== "off") {
    body.reasoning_effort = config.reasoningEffort;
  }
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  return body;
}

/* ------------------------------------------------------------------ */
/* Error descriptions                                                  */
/* ------------------------------------------------------------------ */

function redactUrl(url: string): string {
  return url.replace(/(https?:\/\/)[^@/]+@/, "$1");
}
function combineAbortSignals(
  signal1?: AbortSignal,
  signal2?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();

  if (signal1) {
    if (signal1.aborted) {
      controller.abort();
      return { signal: controller.signal, cleanup: () => {} };
    }
    signal1.addEventListener("abort", onAbort, { once: true });
  }

  if (signal2) {
    if (signal2.aborted) {
      controller.abort();
      return { signal: controller.signal, cleanup: () => {} };
    }
    signal2.addEventListener("abort", onAbort, { once: true });
  }

  const cleanup = () => {
    if (signal1) signal1.removeEventListener("abort", onAbort);
    if (signal2) signal2.removeEventListener("abort", onAbort);
  };

  return { signal: controller.signal, cleanup };
}


function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Pulls a short human message out of an error response body, if any. */
function extractErrorMessage(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    const error = json.error;
    if (typeof error === "string") return truncate(error);
    if (
      error &&
      typeof error === "object" &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      return truncate((error as { message: string }).message);
    }
    if (typeof json.message === "string") return truncate(json.message);
  } catch {
    // Non-JSON body: fall through to the raw-text guard below.
  }
  // Plain-text bodies are useful; markup dumps are not.
  if (trimmed.startsWith("<")) return null;
  return truncate(trimmed);
}

/** e.g. "401 Unauthorized" or "HTTP 500" with a server detail when given. */
function describeHttpError(status: number, statusText: string, bodyText: string): string {
  const base = statusText ? `${status} ${statusText}` : `HTTP ${status}`;
  const detail = extractErrorMessage(bodyText);
  return detail ? `${base}: ${detail}` : base;
}

function networkCauseCode(error: unknown): string | null {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

const NETWORK_CODE_MESSAGES: Record<string, string> = {
  ECONNREFUSED: "connection refused — is the server running",
  ENOTFOUND: "host not found",
  ECONNRESET: "connection reset",
  ETIMEDOUT: "connection timed out",
  EAI_AGAIN: "DNS lookup failed",
};

/** Maps a fetch failure to a readable message (timeout, refused, DNS…). */
export function describeNetworkError(error: unknown): string {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return `${ERROR_PREFIX} request timed out.`;
  }
  if (error instanceof TypeError) {
    // fetch throws TypeError on network-level failures (DNS, refused, TLS).
    const code = networkCauseCode(error);
    const detail = code ? (NETWORK_CODE_MESSAGES[code] ?? code) : "could not connect";
    return `${ERROR_PREFIX} ${detail}.`;
  }
  if (error instanceof Error && error.message) {
    return `${ERROR_PREFIX} ${error.message}`;
  }
  return `${ERROR_PREFIX} request failed.`;
}

function httpError(status: number, statusText: string, bodyText: string): Error {
  return new Error(`${ERROR_PREFIX} ${describeHttpError(status, statusText, bodyText)}`);
}

/* ------------------------------------------------------------------ */
/* Connection test                                                     */
/* ------------------------------------------------------------------ */

export type OpenAiTestResult =
  | { ok: true; model: string }
  | { ok: false; error: string; status?: number };

/**
 * Minimal non-streaming completion used by the Settings "Test connection"
 * route. The config is passed in (the route reads it server-side), so the
 * API key never round-trips through the browser.
 */
export async function testOpenAiConnection(
  config: OpenAiConfig,
  timeoutMs = 15000,
): Promise<OpenAiTestResult> {
  if (!config.baseUrl) {
    return { ok: false, error: `${ERROR_PREFIX} no Base URL configured.`, status: 400 };
  }
  if (!config.model) {
    return { ok: false, error: `${ERROR_PREFIX} no Model configured.`, status: 400 };
  }

  let url: string;
  try {
    url = buildChatCompletionsUrl(config.baseUrl);
    new URL(url); // throws on invalid URLs (e.g. missing scheme)
  } catch {
    return {
      ok: false,
      error: `${ERROR_PREFIX} invalid Base URL "${redactUrl(config.baseUrl)}".`,
      status: 400,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildOpenAiHeaders(config.apiKey),
      body: JSON.stringify(
        buildChatCompletionsBody(
          config,
          [{ role: "user", content: "Reply with the single word: ok" }],
          false,
        ),
      ),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const status = response.status === 401 || response.status === 403 ? 401 : 502;
      return {
        ok: false,
        error: `${ERROR_PREFIX} ${describeHttpError(response.status, response.statusText, bodyText)}`,
        status,
      };
    }

    const json: unknown = await response.json().catch(() => null);
    const model =
      json &&
      typeof json === "object" &&
      typeof (json as { model?: unknown }).model === "string"
        ? (json as { model: string }).model
        : config.model;
    return { ok: true, model };
  } catch (error) {
    return { ok: false, error: describeNetworkError(error), status: 502 };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* SSE streaming                                                       */
/* ------------------------------------------------------------------ */

const DONE = Symbol("sse-done");

/**
 * Accumulates streamed `delta.tool_calls` fragments (keyed by their `index`)
 * into complete OpenAiToolCall objects. Non-streaming `message.tool_calls`
 * arrive as already-complete fragments and assemble identically.
 */
class ToolCallAssembler {
  private fragments = new Map<number, { id: string; name: string; args: string }>();

  add(rawCalls: unknown): void {
    if (!Array.isArray(rawCalls)) return;
    for (const raw of rawCalls) {
      if (!raw || typeof raw !== "object") continue;
      const fragment = raw as {
        index?: unknown;
        id?: unknown;
        function?: unknown;
      };
      const fn =
        fragment.function && typeof fragment.function === "object"
          ? (fragment.function as { name?: unknown; arguments?: unknown })
          : null;
      // Index-less fragments: a fragment that carries an id or a name opens
      // a new call; a bare arguments fragment continues the latest one
      // (servers that omit `index` stream arguments that way).
      const opensCall = Boolean(fragment.id) || Boolean(fn?.name);
      const index =
        typeof fragment.index === "number"
          ? fragment.index
          : !opensCall && this.fragments.size > 0
            ? Math.max(...this.fragments.keys())
            : this.fragments.size;
      const acc = this.fragments.get(index) ?? { id: "", name: "", args: "" };
      if (typeof fragment.id === "string" && fragment.id) acc.id = fragment.id;
      if (fragment.function && typeof fragment.function === "object") {
        const fn = fragment.function as { name?: unknown; arguments?: unknown };
        if (typeof fn.name === "string") acc.name += fn.name;
        if (typeof fn.arguments === "string") acc.args += fn.arguments;
      }
      this.fragments.set(index, acc);
    }
  }

  get hasAny(): boolean {
    return this.fragments.size > 0;
  }

  finalize(): OpenAiToolCall[] {
    const fragments = [...this.fragments.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, fragment]) => fragment)
      .filter((fragment) => fragment.name.length > 0);
    // Fallback ids are assigned after the name filter (so they stay dense)
    // and dodge any explicit ids the server did send.
    const used = new Set(fragments.map((fragment) => fragment.id).filter(Boolean));
    return fragments.map((fragment, i) => {
      let id = fragment.id;
      if (!id) {
        id = `call_${i}`;
        while (used.has(id)) id = `${id}_`;
        used.add(id);
      }
      return {
        id,
        type: "function" as const,
        function: { name: fragment.name, arguments: fragment.args || "{}" },
      };
    });
  }
}

/**
 * Parses one SSE line into its useful parts.
 *
 * - `data: [DONE]` → the DONE sentinel
 * - `data: {json}` → `{ text, toolCallDeltas }` from choices[0] (delta for
 *   streaming chunks, message for a non-streaming completion)
 * - plain non-JSON `data:` payload → treated as text
 * - anything else (comments, `event:`/`id:` lines, empty) → null
 */
function parseSseDataLine(
  line: string,
): { text: string | null; toolCallDeltas: unknown } | typeof DONE | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice("data:".length).trimStart();
  if (payload === "[DONE]") return DONE;
  if (!payload || payload === "{}") return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (obj.error) {
        const errorObj = obj.error;
        const msg =
          typeof errorObj === "string"
            ? errorObj
            : errorObj !== null &&
                typeof errorObj === "object" &&
                typeof (errorObj as { message?: unknown }).message === "string"
              ? (errorObj as { message: string }).message
              : "stream error";
        throw new Error(`${ERROR_PREFIX} ${msg}`);
      }
    }
    return {
      text: extractDelta(parsed),
      toolCallDeltas: extractToolCallDeltas(parsed),
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(ERROR_PREFIX)) {
      throw error;
    }
    if (payload.startsWith("{") || payload.startsWith("[")) {
      return null;
    }
    return { text: payload, toolCallDeltas: null };
  }
}

function firstChoice(json: unknown): { delta?: unknown; message?: unknown } | null {
  if (!json || typeof json !== "object") return null;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  return choices[0] as { delta?: unknown; message?: unknown };
}

function extractDelta(json: unknown): string | null {
  const choice = firstChoice(json);
  const content =
    choice?.delta && typeof choice.delta === "object"
      ? (choice.delta as { content?: unknown }).content
      : choice?.message && typeof choice.message === "object"
        ? (choice.message as { content?: unknown }).content
        : undefined;
  return typeof content === "string" ? content : null;
}

/** `choices[0].delta.tool_calls` (streaming) or `message.tool_calls`. */
function extractToolCallDeltas(json: unknown): unknown {
  const choice = firstChoice(json);
  const calls =
    choice?.delta && typeof choice.delta === "object"
      ? (choice.delta as { tool_calls?: unknown }).tool_calls
      : choice?.message && typeof choice.message === "object"
        ? (choice.message as { tool_calls?: unknown }).tool_calls
        : undefined;
  return Array.isArray(calls) ? calls : null;
}

export interface OpenAiStreamOptions {
  /** Function tools to advertise; omitted → plain text completion. */
  tools?: OpenAiToolDefinition[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Streams a chat completion and yields structured events as they arrive:
 * `{type:"text"}` for each content delta, then at most one
 * `{type:"tool_calls"}` event once the stream ends with assembled calls.
 *
 * Parses the SSE wire format: `data: {json}` lines separated by newlines,
 * `data: [DONE]` ending the stream. Tolerates servers that ignore
 * `stream: true` and answer with a single JSON completion (emits the whole
 * `message.content` as one text event, and `message.tool_calls` whole).
 *
 * Throws an Error with a readable message on HTTP or network failure.
 */
export async function* streamOpenAiChatEvents(
  config: OpenAiConfig,
  messages: OpenAiChatMessage[],
  options: OpenAiStreamOptions = {},
): AsyncGenerator<OpenAiStreamEvent, void, unknown> {
  const { tools, signal, timeoutMs = 60000 } = options;
  let url: string;
  try {
    url = buildChatCompletionsUrl(config.baseUrl);
    new URL(url);
  } catch {
    throw new Error(`${ERROR_PREFIX} invalid Base URL "${redactUrl(config.baseUrl)}".`);
  }

  const timeoutController = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const resetTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timeoutController.abort(new DOMException("The request timed out.", "TimeoutError"));
    }, timeoutMs);
  };
  resetTimer();

  const { signal: fetchSignal, cleanup } = combineAbortSignals(
    signal,
    timeoutController.signal,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildOpenAiHeaders(config.apiKey),
      body: JSON.stringify(buildChatCompletionsBody(config, messages, true, tools)),
      signal: fetchSignal,
    });
  } catch (error) {
    throw new Error(describeNetworkError(error));
  }

  if (!response.ok || !response.body) {
    clearTimeout(timer);
    cleanup();
    const bodyText = await response.text().catch(() => "");
    throw httpError(response.status, response.statusText, bodyText);
  }

  const reader = response.body.getReader();
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  if (fetchSignal) {
    if (fetchSignal.aborted) {
      reader.cancel().catch(() => {});
    } else {
      fetchSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const decoder = new TextDecoder();
  const assembler = new ToolCallAssembler();
  let buffer = "";
  let rawText = "";
  let sawSseDataLine = false;
  let sawDone = false;

  try {
    while (!sawDone) {
      if (fetchSignal?.aborted) break;
      const { done, value } = await reader.read();
      resetTimer();
      if (done || fetchSignal?.aborted) break;
      const chunk = decoder.decode(value, { stream: true });
      if (!sawSseDataLine) {
        rawText += chunk;
      }
      buffer += chunk;

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) sawSseDataLine = true;
        const parsed = parseSseDataLine(line);
        if (parsed === DONE) {
          sawDone = true;
          break;
        }
        if (!parsed) continue;
        if (parsed.toolCallDeltas) assembler.add(parsed.toolCallDeltas);
        if (parsed.text) yield { type: "text", text: parsed.text };
      }
    }

    if (!sawDone && !fetchSignal?.aborted) {
      const lastChunk = decoder.decode();
      if (lastChunk) {
        if (!sawSseDataLine) rawText += lastChunk;
        buffer += lastChunk;
      }
      const tail = buffer.replace(/\r$/, "");
      if (tail.startsWith("data:")) sawSseDataLine = true;
      const parsed = parseSseDataLine(tail);
      if (parsed && parsed !== DONE) {
        if (parsed.toolCallDeltas) assembler.add(parsed.toolCallDeltas);
        if (parsed.text) yield { type: "text", text: parsed.text };
      }
    }
  } finally {
    clearTimeout(timer);
    cleanup();
    if (fetchSignal) {
      fetchSignal.removeEventListener("abort", onAbort);
    }
    reader.releaseLock();
  }

  // A server that ignored `stream: true` answered with one JSON completion
  // instead of an SSE stream — emit its content and tool calls whole.
  if (!sawSseDataLine && !fetchSignal?.aborted) {
    try {
      const parsed: unknown = JSON.parse(rawText.trim());
      const text = extractDelta(parsed);
      if (text) yield { type: "text", text };
      assembler.add(extractToolCallDeltas(parsed));
    } catch {
      // Empty or unparseable body: nothing to emit.
    }
  }

  if (!fetchSignal?.aborted && assembler.hasAny) {
    const toolCalls = assembler.finalize();
    if (toolCalls.length > 0) {
      yield { type: "tool_calls", toolCalls };
    }
  }
}

/**
 * Text-only view over streamOpenAiChatEvents: yields content deltas as
 * plain strings. Kept for callers that never advertise tools.
 */
export async function* streamOpenAiChatCompletion(
  config: OpenAiConfig,
  messages: OpenAiChatMessage[],
  signal?: AbortSignal,
  timeoutMs = 60000,
): AsyncGenerator<string, void, unknown> {
  for await (const event of streamOpenAiChatEvents(config, messages, { signal, timeoutMs })) {
    if (event.type === "text") {
      yield event.text;
    }
  }
}
