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
  role: "system" | "user" | "assistant";
  content: string;
}

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
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream,
  };
  if (config.reasoningEffort !== "off") {
    body.reasoning_effort = config.reasoningEffort;
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
 * Extracts the content delta from one SSE line.
 *
 * - `data: [DONE]` → the DONE sentinel
 * - `data: {json}` → the `choices[0].delta.content` string (or
 *   `choices[0].message.content` for a non-streaming chunk)
 * - plain non-JSON `data:` payload → the payload itself
 * - anything else (comments, `event:`/`id:` lines, empty) → null
 */
function parseSseDataLine(line: string): string | typeof DONE | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice("data:".length).trimStart();
  if (payload === "[DONE]") return DONE;
  if (!payload || payload === "{}") return null;
  try {
    return extractDelta(JSON.parse(payload));
  } catch {
    return payload;
  }
}

function extractDelta(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = choices[0] as { delta?: unknown; message?: unknown } | undefined;
  const content =
    choice?.delta && typeof choice.delta === "object"
      ? (choice.delta as { content?: unknown }).content
      : choice?.message && typeof choice.message === "object"
        ? (choice.message as { content?: unknown }).content
        : undefined;
  return typeof content === "string" ? content : null;
}

/**
 * Streams a chat completion and yields content deltas as they arrive.
 *
 * Parses the SSE wire format: `data: {json}` lines separated by newlines,
 * `data: [DONE]` ending the stream. Tolerates servers that ignore
 * `stream: true` and answer with a single JSON completion (emits the whole
 * `message.content` as one delta).
 *
 * Throws an Error with a readable message on HTTP or network failure.
 */
export async function* streamOpenAiChatCompletion(
  config: OpenAiConfig,
  messages: OpenAiChatMessage[],
  signal?: AbortSignal,
  timeoutMs = 60000,
): AsyncGenerator<string, void, unknown> {
  let url: string;
  try {
    url = buildChatCompletionsUrl(config.baseUrl);
    new URL(url);
  } catch {
    throw new Error(`${ERROR_PREFIX} invalid Base URL "${redactUrl(config.baseUrl)}".`);
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(new DOMException("The request timed out.", "TimeoutError"));
  }, timeoutMs);

  const { signal: fetchSignal, cleanup } = combineAbortSignals(
    signal,
    timeoutController.signal,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildOpenAiHeaders(config.apiKey),
      body: JSON.stringify(buildChatCompletionsBody(config, messages, true)),
      signal: fetchSignal,
    });
  } catch (error) {
    throw new Error(describeNetworkError(error));
  } finally {
    clearTimeout(timer);
    cleanup();
  }

  if (!response.ok || !response.body) {
    const bodyText = await response.text().catch(() => "");
    throw httpError(response.status, response.statusText, bodyText);
  }

  const reader = response.body.getReader();
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) {
      reader.cancel().catch(() => {});
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let sawSseDataLine = false;

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done || signal?.aborted) break;
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
        const delta = parseSseDataLine(line);
        if (delta === DONE) return;
        if (delta) yield delta;
      }
    }
    const lastChunk = decoder.decode();
    if (lastChunk) {
      if (!sawSseDataLine) rawText += lastChunk;
      buffer += lastChunk;
    }
    const tail = buffer.replace(/\r$/, "");
    if (tail.startsWith("data:")) sawSseDataLine = true;
    const tailDelta = parseSseDataLine(tail);
    if (tailDelta === DONE) return;
    if (tailDelta) yield tailDelta;
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
    reader.releaseLock();
  }

  // A server that ignored `stream: true` answered with one JSON completion
  // instead of an SSE stream — emit it as a single delta.
  if (!sawSseDataLine) {
    try {
      const delta = extractDelta(JSON.parse(rawText.trim()));
      if (delta) yield delta;
    } catch {
      // Empty or unparseable body: nothing to emit.
    }
  }
}
