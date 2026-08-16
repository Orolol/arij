import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, settings } from "@/lib/db/schema";

/**
 * Outbound project webhooks.
 *
 * A project can store one webhook URL in the key/value `settings` table under
 * `webhook_url:<projectId>` (same storage pattern as `github_pat`). When set,
 * agent-session completion/failure and release creation POST a small JSON body
 * to it — compatible with ntfy.sh, Discord and Slack-style receivers that
 * accept an arbitrary JSON payload.
 *
 * Delivery is strictly fire-and-forget: `sendProjectWebhook` never throws and
 * never rejects, so callers can `void` it without risking an unhandled
 * rejection or a delayed API response.
 */

export const WEBHOOK_URL_SETTING_PREFIX = "webhook_url:";

/** Hard cap on a single delivery attempt. No retries — this is best effort. */
export const WEBHOOK_TIMEOUT_MS = 3000;

export const DEFAULT_APP_BASE_URL = "http://localhost:3000";

export type WebhookEventName =
  | "session.completed"
  | "session.failed"
  | "release.created";

/** Caller-supplied context. Everything else on the wire is derived here. */
export interface WebhookEventInput {
  event: WebhookEventName;
  /** Human label for the thing that finished (epic title, release version). */
  ticketTitle?: string | null;
  epicId?: string | null;
  sessionId?: string | null;
  durationMs?: number | null;
  error?: string | null;
  /** App-relative deep-link path; defaults to the project board. */
  path?: string | null;
}

/** Exact JSON body POSTed to the receiver. Absent context is omitted. */
export interface WebhookPayload {
  event: WebhookEventName;
  projectId: string;
  projectName: string;
  url: string;
  ticketTitle?: string;
  epicId?: string;
  sessionId?: string;
  durationMs?: number;
  error?: string;
}

/** Settings key holding a project's webhook URL. */
export function webhookSettingKey(projectId: string): string {
  return `${WEBHOOK_URL_SETTING_PREFIX}${projectId}`;
}

/** Inverse of {@link webhookSettingKey}; `null` for unrelated keys. */
export function projectIdFromWebhookSettingKey(key: string): string | null {
  if (!key.startsWith(WEBHOOK_URL_SETTING_PREFIX)) return null;
  const projectId = key.slice(WEBHOOK_URL_SETTING_PREFIX.length);
  return projectId.length > 0 ? projectId : null;
}

/** True only for absolute http(s) URLs — no file:, no javascript:, no mailto:. */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Base URL used to build the deep link inside the payload.
 *
 * LIMITATION: webhooks fire from background code paths that have no incoming
 * request to derive an origin from, so the base is a constant. Override with
 * `ARIJ_BASE_URL` when the app is not served from http://localhost:3000.
 */
export function getAppBaseUrl(): string {
  const raw = process.env.ARIJ_BASE_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_APP_BASE_URL;
  return base.replace(/\/+$/, "");
}

/** Settings values are JSON-encoded; tolerate legacy bare strings too. */
export function parseWebhookUrl(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") return null;

  let value: unknown = rawValue;
  try {
    value = JSON.parse(rawValue);
  } catch {
    value = rawValue;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return isHttpUrl(trimmed) ? trimmed : null;
}

/** Configured webhook URL for a project, or `null` when unset/invalid. */
export function getProjectWebhookUrl(projectId: string): string | null {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, webhookSettingKey(projectId)))
    .get();

  if (!row) return null;
  return parseWebhookUrl(row.value);
}

/** Elapsed ms between two ISO timestamps; `null` when unusable. */
export function durationMsBetween(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined
): number | null {
  if (!startedAt || !endedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const elapsed = end - start;
  return elapsed >= 0 ? elapsed : null;
}

export function buildWebhookPayload(
  projectId: string,
  projectName: string,
  event: WebhookEventInput
): WebhookPayload {
  const path =
    event.path && event.path.startsWith("/")
      ? event.path
      : `/projects/${projectId}`;

  const payload: WebhookPayload = {
    event: event.event,
    projectId,
    projectName,
    url: `${getAppBaseUrl()}${path}`,
  };

  if (event.ticketTitle) payload.ticketTitle = event.ticketTitle;
  if (event.epicId) payload.epicId = event.epicId;
  if (event.sessionId) payload.sessionId = event.sessionId;
  if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)) {
    payload.durationMs = event.durationMs;
  }
  if (event.error) payload.error = event.error;

  return payload;
}

/**
 * POST an event to the project's webhook URL, if one is configured.
 *
 * No-op when unset. Never throws: transport errors, timeouts and non-2xx
 * responses are swallowed with a `console.warn`. All context travels in the
 * body — nothing is appended to the receiver URL.
 */
export async function sendProjectWebhook(
  projectId: string,
  event: WebhookEventInput
): Promise<void> {
  let target: string | null = null;

  try {
    target = getProjectWebhookUrl(projectId);
    if (!target) return;

    const project = db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();

    const payload = buildWebhookPayload(
      projectId,
      project?.name ?? "",
      event
    );

    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!response?.ok) {
      console.warn(
        `[webhooks] ${event.event} for project ${projectId} returned HTTP ${response?.status}`
      );
    }
  } catch (error) {
    console.warn(
      `[webhooks] ${event.event} delivery failed for project ${projectId}:`,
      error instanceof Error ? error.message : error
    );
  }
}
