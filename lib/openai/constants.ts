/**
 * Client-safe constants for the OpenAI-compatible chat provider (fast mode).
 *
 * Like `lib/night/constants.ts` and `lib/pipeline/constants.ts`, this file
 * is imported by both the browser (Settings page, chat provider dropdown)
 * and the server (API routes), and it never imports `db`. Setting keys and
 * value parsers live here; server-only DB access lives in `./client.ts`.
 */

/* ------------------------------------------------------------------ */
/* Settings keys                                                       */
/* ------------------------------------------------------------------ */

/** Base URL of the OpenAI-compatible server, e.g. http://localhost:11434/v1. */
export const OPENAI_BASE_URL_SETTING_KEY = "openai_base_url";

/**
 * Bearer token for the endpoint. Optional: local servers usually run
 * without auth, and when empty no Authorization header is sent.
 */
export const OPENAI_API_KEY_SETTING_KEY = "openai_api_key";

/** Model name to request, e.g. "llama3.1" or "gpt-4o-mini". */
export const OPENAI_MODEL_SETTING_KEY = "openai_model";

/** Reasoning effort for reasoning models. "off" omits the field entirely. */
export const OPENAI_REASONING_EFFORT_SETTING_KEY = "openai_reasoning_effort";

/* ------------------------------------------------------------------ */
/* Reasoning effort                                                    */
/* ------------------------------------------------------------------ */

export const OPENAI_REASONING_EFFORTS = ["off", "low", "medium", "high"] as const;

export type OpenAiReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

export const DEFAULT_OPENAI_REASONING_EFFORT: OpenAiReasoningEffort = "off";

/** Coerces a stored value into a known effort, defaulting to "off". */
export function parseOpenAiReasoningEffort(value: unknown): OpenAiReasoningEffort {
  if (
    typeof value === "string" &&
    (OPENAI_REASONING_EFFORTS as readonly string[]).includes(value)
  ) {
    return value as OpenAiReasoningEffort;
  }
  return DEFAULT_OPENAI_REASONING_EFFORT;
}
