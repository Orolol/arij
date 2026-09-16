"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/i18n/format";
import type { UiLocale } from "@/lib/i18n/locales";
/**
 * "MCP servers" settings surface, used at BOTH scopes.
 *
 * `projectId === null` renders the global list (app/settings); a project id
 * renders that project's own servers plus the globals it inherits, read-only,
 * with the two ways to override one: disable it locally, or create a local
 * entry of the same name (a project entry shadows a global).
 *
 * Two contracts this component exists to honour, both easy to get wrong:
 *
 *   1. **Secrets are write-only.** The API returns "***" for every `env` /
 *      `header` value, never the value. So the secrets box starts EMPTY on
 *      edit, and an empty field means "keep what is stored" — never "clear
 *      it", which is why `handleSave` OMITS the key rather than sending `{}`
 *      (`mergeSecretMap` walks the patch it is given, so `{}` erases).
 *      Rendering the mask into the field would save the literal string "***"
 *      the moment the user touched anything else.
 *
 *      The field is a `<textarea>` — several `KEY=value` lines at once — so it
 *      cannot carry `type="password"`. It is password-CLASS by behaviour, not
 *      by input type: never pre-filled, never echoed back, blank preserves.
 *
 *   2. **Length caps are mirrored, not re-invented.** Every `maxLength` here
 *      comes from the same constant the service validates against, so the form
 *      cannot accept something the API will reject. The server still rejects
 *      over-length input explicitly rather than truncating it; this is the
 *      other half of that rule, not a replacement for it.
 *
 *      The four single-value fields (name, command, url, usage hint) carry one
 *      because their cap is 1:1 with the field. The multi-line ones — args,
 *      agent types, allowed tools, secrets — deliberately do NOT, and that is
 *      a decision rather than an omission: each of their caps is per-ITEM
 *      (`MCP_SERVER_ARG_MAX_LENGTH` per line, `MCP_SERVER_ENV_VALUE_MAX_LENGTH`
 *      per value), which a single textarea-wide `maxLength` cannot express.
 *      Spending the args cap on the textarea would be actively wrong, since
 *      `MCP_SERVER_ARGS_MAX_TOTAL_LENGTH` is measured over the JSON encoding
 *      — quotes, commas and brackets included — and so does not correspond to
 *      any count of the raw characters typed here. These fields are left to
 *      the server's explicit rejection, which reports the offending limit.
 *
 * COPY LIVES IN THE CATALOGUE, under the `SettingsLegacy` namespace — this is
 * the OLDER settings surface, distinct from `components/settings-piscine/`,
 * which owns `Settings`. `healthLabel` composes a display string outside
 * React, so it takes the RESOLVED PHRASES from its caller rather than a
 * translator: every key stays a literal next to the `useTranslations` binding
 * (`lib/i18n/catalogue.ts`, pattern 3).
 */

import { useCallback, useState } from "react";
import { requestJson } from "@/lib/api/client";
import { usePolledResource } from "@/hooks/usePolledResource";
import { useScopedMutation } from "@/hooks/useScopedMutation";
import { PillButton, Stamp } from "@/components/piscine";
import {
  MCP_SERVER_COMMAND_MAX_LENGTH,
  MCP_SERVER_NAME_MAX_LENGTH,
  MCP_SERVER_URL_MAX_LENGTH,
  MCP_SERVER_USAGE_HINT_MAX_LENGTH,
  type McpServerView,
} from "@/lib/mcp/server-limits";

interface InheritedServer extends McpServerView {
  /** True when a project entry of the same name overrides this global. */
  shadowed: boolean;
}

interface ProjectPayload {
  servers: McpServerView[];
  inherited: InheritedServer[];
  unsupportedProviders: string[];
}

type ServerListData = McpServerView[] | ProjectPayload;
interface ProbeResult { ok: boolean; toolCount: number; toolNames: string[]; error: string | null }
const NO_SERVERS: McpServerView[] = [];
const NO_INHERITED: InheritedServer[] = [];
const NO_PROVIDERS: string[] = [];
function isServer(value: unknown): value is McpServerView {
  if (!value || typeof value !== "object") return false;
  const server = value as McpServerView;
  return typeof server.id === "string" && typeof server.name === "string"
    && Array.isArray(server.args) && Boolean(server.env && server.headers);
}
const isServers = (value: unknown): value is McpServerView[] => Array.isArray(value) && value.every(isServer);
function isProjectPayload(value: unknown): value is ProjectPayload {
  if (!value || typeof value !== "object") return false;
  const data = value as ProjectPayload;
  return isServers(data.servers) && isServers(data.inherited) && Array.isArray(data.unsupportedProviders);
}
const isDeleted = (value: unknown): value is { id: string; deleted: true } =>
  Boolean(value && typeof value === "object" && "deleted" in value && value.deleted === true
    && "id" in value && typeof value.id === "string");
function isProbeResult(value: unknown): value is ProbeResult {
  if (!value || typeof value !== "object") return false;
  const result = value as ProbeResult;
  return typeof result.ok === "boolean" && typeof result.toolCount === "number" && Array.isArray(result.toolNames);
}

/** Draft state for the add/edit form. Secrets are entered as `KEY=value` lines. */
interface Draft {
  id: string | null;
  name: string;
  transport: "stdio" | "http";
  /**
   * The transport the row had when editing started, or null on create. A save
   * needs to distinguish "switched transport" (clear the other side's stored
   * fields) from "edited something else" (leave them alone).
   */
  originalTransport: "stdio" | "http" | null;
  command: string;
  args: string;
  url: string;
  usageHint: string;
  secrets: string;
  /** Newline-separated agent types; blank = every type (stored as NULL). */
  agentTypes: string;
  /** Newline-separated bare tool names; blank = every tool the server exposes. */
  toolAllowlist: string;
  enabled: boolean;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  transport: "stdio",
  originalTransport: null,
  command: "",
  args: "",
  url: "",
  usageHint: "",
  secrets: "",
  agentTypes: "",
  toolAllowlist: "",
  enabled: true,
};

/**
 * Parses the `KEY=value` textarea into a map.
 *
 * "Leave it blank to keep it" is enforced by the CALLER, not here: a blank
 * textarea must make the secret key absent from the payload entirely. Sending
 * `{}` is NOT the same thing — `mergeSecretMap` iterates the patch it is given,
 * so an empty map erases every stored value rather than preserving them.
 */
function parseSecretLines(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    map[line.slice(0, eq).trim()] = line.slice(eq + 1);
  }
  return map;
}

/**
 * Newline list -> array, or NULL when blank.
 *
 * NULL and [] mean different things in these two columns: `agent_types` NULL is
 * "every agent type", while an empty array would match nothing and silently
 * keep the server out of every session. Same for `tool_allowlist`, where NULL
 * is "every tool the server exposes".
 */
function parseListLines(text: string): string[] | null {
  const items = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

/**
 * The stored secret KEYS for a server's transport. Values are masked by the
 * API and never appear here; the keys are what make "this server has
 * credentials configured" legible on the list.
 */
function secretKeys(server: McpServerView): string[] {
  return Object.keys(server.transport === "http" ? server.headers : server.env);
}

/** The three phrases `healthLabel` picks between, already resolved. */
interface HealthCopy {
  neverTested: string;
  ok: (when: string) => string;
  failed: (when: string) => string;
}

function healthLabel(
  server: McpServerView,
  locale: UiLocale,
  copy: HealthCopy,
): {
  text: string;
  tone: "live" | "failed" | "asks";
} {
  if (server.lastCheckOk === null || server.lastCheckedAt === null) {
    return { text: copy.neverTested, tone: "asks" };
  }
  const when = formatDateTime(server.lastCheckedAt, { locale, style: "dateTimeSeconds" });
  return server.lastCheckOk
    ? { text: copy.ok(when), tone: "live" }
    : { text: copy.failed(when), tone: "failed" };
}

export function McpServersSection({ projectId }: { projectId?: string | null }) {
  return <McpServersWorkspace key={JSON.stringify(projectId ?? null)} projectId={projectId} />;
}

function McpServersWorkspace({ projectId }: { projectId?: string | null }) {
  const locale = useLocale();
  const t = useTranslations("Settings");
  const scopedProjectId = projectId ?? null;
  const baseUrl = scopedProjectId
    ? `/api/projects/${scopedProjectId}/mcp-servers`
    : "/api/settings/mcp-servers";

  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const errorMessage = useCallback(() => t("mcp.message.loadFailed"), [t]);
  const { data, loading, error: loadError, refresh, updateData } = usePolledResource<ServerListData>(
    baseUrl, null, errorMessage, { validateData: scopedProjectId ? isProjectPayload : isServers },
  );
  const { run, pending: busy, error: mutationError } = useScopedMutation(baseUrl);
  const servers = Array.isArray(data) ? data : data?.servers ?? NO_SERVERS;
  const inherited = data && !Array.isArray(data) ? data.inherited : NO_INHERITED;
  const unsupportedProviders = data && !Array.isArray(data) ? data.unsupportedProviders : NO_PROVIDERS;
  const feedback = mutationError ?? loadError ?? message;

  async function send(url: string, method: string, payload?: unknown): Promise<boolean> {
    if (!data) return false;
    const result = await run(async () => {
      setMessage(null);
      const response = await requestJson<McpServerView | { id: string; deleted: true }>(url, {
        method,
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
        errorMessage: t("mcp.message.requestFailed"),
        validateData: method === "DELETE" ? isDeleted : isServer,
      });
      if (response.error !== null) throw new Error(response.error);
      return response.data;
    }, t("mcp.message.requestFailed"));
    if (!result) return false;
    // Apply the sanitized canonical row returned by the mutation. A second
    // GET must not decide whether this save succeeded or revive removed rows.
    updateData((current) => {
      const previous = Array.isArray(current) ? current : current?.servers ?? NO_SERVERS;
      const rows = isDeleted(result)
        ? previous.filter((server) => server.id !== result.id)
        : previous.some((server) => server.id === result.id)
          ? previous.map((server) => server.id === result.id ? result : server)
          : [...previous, result];
      if (Array.isArray(current)) return rows;
      const names = new Set(rows.map((server) => server.name));
      return {
        servers: rows,
        inherited: (current?.inherited ?? NO_INHERITED).map((server) => ({
          ...server, shadowed: names.has(server.name),
        })),
        unsupportedProviders: current?.unsupportedProviders ?? NO_PROVIDERS,
      };
    });
    return true;
  }

  async function handleSave() {
    if (!draft) return;
    const isStdio = draft.transport === "stdio";
    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      transport: draft.transport,
      enabled: draft.enabled,
      usageHint: draft.usageHint.trim() || null,
      agentTypes: parseListLines(draft.agentTypes),
      toolAllowlist: parseListLines(draft.toolAllowlist),
    };

    // PATCH is a merge, so the fields belonging to the OTHER transport have to
    // be cleared explicitly. Leaving them behind makes the merged row
    // transport-inconsistent and the API rejects the save naming a field the
    // form has just stopped rendering — with no affordance to fix it.
    if (isStdio) {
      payload.command = draft.command.trim();
      payload.args = draft.args
        .split("\n")
        .map((a) => a.trim())
        .filter(Boolean);
      payload.url = null;
    } else {
      payload.url = draft.url.trim();
      payload.command = null;
      payload.args = null;
    }

    // A blank secrets box means "keep what is stored", which requires OMITTING
    // the key: `mergeSecretMap` walks the patch it receives, so `{}` would
    // erase every stored value instead of preserving it.
    const secretsText = draft.secrets.trim();
    if (secretsText) {
      payload[isStdio ? "env" : "headers"] = parseSecretLines(secretsText);
    }

    // Switching transport makes the other side's credentials dead config for
    // this server. Clear them rather than leaving a live secret in the row —
    // but only on an actual switch, so an ordinary edit never drops anything.
    if (draft.originalTransport && draft.originalTransport !== draft.transport) {
      payload[isStdio ? "headers" : "env"] = {};
    }

    const ok = draft.id
      ? await send(`${baseUrl}/${draft.id}`, "PATCH", payload)
      : await send(baseUrl, "POST", payload);
    if (ok) setDraft(null);
  }

  async function handleTest(serverId: string) {
    if (!data) return;
    const result = await run(async () => {
      setMessage(null);
      const response = await requestJson<ProbeResult>(`${baseUrl}/${serverId}/test`, {
        method: "POST", errorMessage: t("mcp.message.testFailed"), validateData: isProbeResult,
      });
      if (response.error !== null) throw new Error(response.error);
      return response.data;
    }, t("mcp.message.testFailed"));
    if (!result) return;
    setMessage(result.ok
      ? t("mcp.message.testConnected", { count: result.toolCount, tools: result.toolNames.join(", ") || t("mcp.message.testNoTools") })
      : t("mcp.message.testRefused", { reason: result.error ?? t("mcp.message.testNoReason") }));
    await refresh();
  }

  const healthCopy: HealthCopy = {
    neverTested: t("mcp.health.neverTested"),
    ok: (when) => t("mcp.health.ok", { when }),
    failed: (when) => t("mcp.health.failed", { when }),
  };

  function startEdit(server: McpServerView) {
    setDraft({
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command ?? "",
      args: server.args.join("\n"),
      url: server.url ?? "",
      usageHint: server.usageHint ?? "",
      // Deliberately EMPTY: the API never hands back a secret, and rendering
      // the "***" mask here would save that literal string on the next PATCH.
      secrets: "",
      agentTypes: (server.agentTypes ?? []).join("\n"),
      toolAllowlist: (server.toolAllowlist ?? []).join("\n"),
      enabled: server.enabled,
      originalTransport: server.transport,
    });
  }

  return (
    <section
      className="space-y-4 rounded-[12px] border border-border/40 bg-card p-4"
      data-testid="mcp-servers-section"
    >
      <div>
        <h2 className="text-base font-semibold">{t("mcp.heading")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("mcp.intro")}{" "}
          {scopedProjectId ? t("mcp.scopeProject") : t("mcp.scopeGlobal")}{" "}
          {t.rich("mcp.strictConfig", {
            code: (chunks) => <code>{chunks}</code>,
          })}
        </p>
        {/* Stated rather than left to be discovered: the fast chat mode is an
            HTTP chat endpoint, not an MCP host, so nothing declared here can
            reach it. Without this line its absence reads as a broken server. */}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("mcp.notChatMode")}
        </p>
      </div>

      <ul className="space-y-2" data-testid="mcp-servers-list">
        {data && servers.length === 0 && (
          <li className="text-xs text-muted-foreground">
            {scopedProjectId ? t("mcp.emptyProject") : t("mcp.emptyGlobal")}
          </li>
        )}
        {servers.map((server) => {
          const health = healthLabel(server, locale, healthCopy);
          return (
            <li
              key={server.id}
              className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border/40 bg-background/50 p-2.5 text-xs"
              data-testid={`mcp-server-${server.name}`}
            >
              <span className="font-medium text-foreground">{server.name}</span>
              <Stamp tone="next">{server.transport}</Stamp>
              {!server.enabled && (
                <Stamp tone="conflict">{t("mcp.server.disabled")}</Stamp>
              )}
              <Stamp tone={health.tone}>{health.text}</Stamp>
              {server.agentTypes && server.agentTypes.length > 0 && (
                <span
                  className="inline-flex"
                  data-testid={`mcp-server-agent-types-${server.name}`}
                >
                  <Stamp tone="next">
                    {t("mcp.server.agentTypes", { list: server.agentTypes.join(", ") })}
                  </Stamp>
                </span>
              )}
              {server.toolAllowlist && server.toolAllowlist.length > 0 && (
                <span
                  className="inline-flex"
                  data-testid={`mcp-server-tools-${server.name}`}
                >
                  <Stamp tone="next">
                    {t("mcp.server.tools", { list: server.toolAllowlist.join(", ") })}
                  </Stamp>
                </span>
              )}
              {secretKeys(server).length > 0 && (
                <span
                  className="inline-flex"
                  data-testid={`mcp-server-secret-keys-${server.name}`}
                >
                  <Stamp tone="next">
                    {t("mcp.server.secrets", { list: secretKeys(server).join(", ") })}
                  </Stamp>
                </span>
              )}
              {server.usageHint && (
                <span className="text-muted-foreground">{server.usageHint}</span>
              )}
              {server.lastCheckOk === false && server.lastCheckError && (
                <span
                  className="w-full break-words text-[11px] text-destructive font-mono"
                  data-testid={`mcp-server-check-error-${server.name}`}
                >
                  {server.lastCheckError}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1.5">
                <PillButton
                  size="sm"
                  variant="outline"
                  outlineTone="neutral"
                  disabled={busy || !data}
                  onClick={() => handleTest(server.id)}
                >
                  {t("mcp.server.test")}
                </PillButton>
                <PillButton
                  size="sm"
                  variant="outline"
                  outlineTone="neutral"
                  disabled={busy || !data}
                  onClick={() => startEdit(server)}
                >
                  {t("mcp.server.edit")}
                </PillButton>
                <PillButton
                  size="sm"
                  variant="outline"
                  outlineTone="neutral"
                  disabled={busy || !data}
                  onClick={() =>
                    send(`${baseUrl}/${server.id}`, "PATCH", {
                      enabled: !server.enabled,
                    })
                  }
                >
                  {server.enabled ? t("mcp.server.disable") : t("mcp.server.enable")}
                </PillButton>
                <PillButton
                  size="sm"
                  variant="outline"
                  outlineTone="neutral"
                  labelTone="danger"
                  disabled={busy || !data}
                  onClick={() => send(`${baseUrl}/${server.id}`, "DELETE")}
                >
                  {t("mcp.server.delete")}
                </PillButton>
              </span>
              {scopedProjectId && unsupportedProviders.length > 0 && (
                <span
                  className="w-full text-[11px] text-muted-foreground"
                  data-testid={`mcp-server-unsupported-${server.name}`}
                >
                  {t("mcp.server.unsupportedProviders", {
                    providers: unsupportedProviders.join(", "),
                  })}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {scopedProjectId && (
        <div className="space-y-2 pt-2 border-t border-border/40" data-testid="mcp-inherited-list">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-mono">
            {t("mcp.inherited.heading")}
          </h3>
          {inherited.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("mcp.inherited.empty")}
            </p>
          )}
          {inherited.map((server) => (
            <div
              key={server.id}
              className="flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-border/50 bg-muted/20 p-2.5 text-xs"
              data-testid={`mcp-inherited-${server.name}`}
            >
              <span className="font-medium text-foreground">{server.name}</span>
              <Stamp tone="next">{t("mcp.inherited.badge")}</Stamp>
              {server.shadowed && (
                <Stamp tone="conflict">
                  {unsupportedProviders.length > 0
                    ? t("mcp.inherited.overriddenExcept", {
                        providers: unsupportedProviders.join(", "),
                      })
                    : t("mcp.inherited.overridden")}
                </Stamp>
              )}
              {server.usageHint && (
                <span className="text-muted-foreground">{server.usageHint}</span>
              )}
              <span className="ml-auto">
                {!server.shadowed && (
                  <PillButton
                    size="sm"
                    variant="outline"
                    outlineTone="neutral"
                    disabled={busy || !data}
                    onClick={() =>
                      send(`${baseUrl}/shadow`, "POST", {
                        globalServerId: server.id,
                      })
                    }
                  >
                    {t("mcp.inherited.disableForProject")}
                  </PillButton>
                )}
              </span>
              {!server.shadowed && unsupportedProviders.length > 0 && (
                <span
                  className="w-full text-[11px] text-muted-foreground"
                  data-testid={`mcp-inherited-partial-${server.name}`}
                >
                  {t("mcp.inherited.partialDisable", {
                    providers: unsupportedProviders.join(", "),
                  })}
                </span>
              )}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">{t("mcp.inherited.note")}</p>
        </div>
      )}

      {draft === null ? (
        <PillButton
          size="sm"
          variant="filled"
          disabled={busy || !data}
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
        >
          {t("mcp.form.add")}
        </PillButton>
      ) : (
        <fieldset
          disabled={busy || !data}
          className="space-y-3 rounded-[10px] border border-border/40 bg-background/50 p-3"
          data-testid="mcp-server-form"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs space-y-1 block">
              <span className="block text-muted-foreground font-medium">
                {t("mcp.form.name")}
              </span>
              <input
                className="h-8 w-full rounded-[6px] border border-border/50 bg-background px-2.5 text-xs font-mono outline-none focus:border-primary"
                value={draft.name}
                maxLength={MCP_SERVER_NAME_MAX_LENGTH}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="text-xs space-y-1 block">
              <span className="block text-muted-foreground font-medium">
                {t("mcp.form.transport")}
              </span>
              <select
                className="h-8 w-full rounded-[6px] border border-border/50 bg-background px-2.5 text-xs outline-none focus:border-primary cursor-pointer"
                value={draft.transport}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    transport: e.target.value as "stdio" | "http",
                  })
                }
                data-testid="mcp-server-transport"
              >
                <option value="stdio">{t("mcp.form.transportStdio")}</option>
                <option value="http">{t("mcp.form.transportHttp")}</option>
              </select>
            </label>
          </div>

          {draft.transport === "stdio" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs space-y-1 block">
                <span className="block text-muted-foreground font-medium">
                  {t("mcp.form.command")}
                </span>
                <input
                  className="h-8 w-full rounded-[6px] border border-border/50 bg-background px-2.5 text-xs font-mono outline-none focus:border-primary"
                  value={draft.command}
                  maxLength={MCP_SERVER_COMMAND_MAX_LENGTH}
                  onChange={(e) =>
                    setDraft({ ...draft, command: e.target.value })
                  }
                  data-testid="mcp-server-command"
                />
              </label>
              <label className="text-xs space-y-1 block">
                <span className="block text-muted-foreground font-medium">
                  {t("mcp.form.args")}
                </span>
                <textarea
                  className="min-h-16 w-full rounded-[6px] border border-border/50 bg-background p-2 text-xs font-mono outline-none focus:border-primary resize-y"
                  value={draft.args}
                  onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                />
              </label>
            </div>
          ) : (
            <label className="text-xs space-y-1 block">
              <span className="block text-muted-foreground font-medium">{t("mcp.form.url")}</span>
              <input
                className="h-8 w-full rounded-[6px] border border-border/50 bg-background px-2.5 text-xs font-mono outline-none focus:border-primary"
                value={draft.url}
                maxLength={MCP_SERVER_URL_MAX_LENGTH}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                data-testid="mcp-server-url"
              />
            </label>
          )}

          <label className="text-xs space-y-1 block">
            <span className="block text-muted-foreground font-medium">
              {t("mcp.form.usageHint")}
            </span>
            <input
              className="h-8 w-full rounded-[6px] border border-border/50 bg-background px-2.5 text-xs outline-none focus:border-primary"
              value={draft.usageHint}
              maxLength={MCP_SERVER_USAGE_HINT_MAX_LENGTH}
              onChange={(e) =>
                setDraft({ ...draft, usageHint: e.target.value })
              }
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs space-y-1 block">
              <span className="block text-muted-foreground font-medium">
                {t("mcp.form.agentTypes")}
              </span>
              <textarea
                className="min-h-16 w-full rounded-[6px] border border-border/50 bg-background p-2 text-xs font-mono outline-none focus:border-primary resize-y"
                placeholder={t("mcp.form.agentTypesPlaceholder")}
                value={draft.agentTypes}
                onChange={(e) =>
                  setDraft({ ...draft, agentTypes: e.target.value })
                }
                data-testid="mcp-server-agent-types"
              />
            </label>
            <label className="text-xs space-y-1 block">
              <span className="block text-muted-foreground font-medium">
                {t("mcp.form.toolAllowlist")}
              </span>
              <textarea
                className="min-h-16 w-full rounded-[6px] border border-border/50 bg-background p-2 text-xs font-mono outline-none focus:border-primary resize-y"
                placeholder={t("mcp.form.toolAllowlistPlaceholder")}
                value={draft.toolAllowlist}
                onChange={(e) =>
                  setDraft({ ...draft, toolAllowlist: e.target.value })
                }
                data-testid="mcp-server-tool-allowlist"
              />
            </label>
          </div>

          <label className="text-xs space-y-1 block">
            <span className="block text-muted-foreground font-medium">
              {draft.transport === "http"
                ? t("mcp.form.secretsHeaders")
                : t("mcp.form.secretsEnv")}{" "}
              {t("mcp.form.secretsNote")}
            </span>
            <textarea
              className="min-h-16 w-full rounded-[6px] border border-border/50 bg-background p-2 text-xs font-mono outline-none focus:border-primary resize-y"
              placeholder={draft.id ? t("mcp.form.secretsPlaceholder") : ""}
              value={draft.secrets}
              onChange={(e) => setDraft({ ...draft, secrets: e.target.value })}
              data-testid="mcp-server-secrets"
            />
          </label>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="rounded accent-primary"
              checked={draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, enabled: e.target.checked })
              }
            />
            <span className="font-medium text-foreground">{t("mcp.form.enabled")}</span>
          </label>

          <div className="flex gap-2 pt-1">
            <PillButton size="sm" variant="filled" disabled={busy || !data} onClick={handleSave}>
              {draft.id ? t("mcp.form.save") : t("mcp.form.create")}
            </PillButton>
            <PillButton
              size="sm"
              variant="outline"
              outlineTone="neutral"
              disabled={busy || !data}
              onClick={() => setDraft(null)}
            >
              {t("mcp.form.cancel")}
            </PillButton>
          </div>
        </fieldset>
      )}

      {loading && <p role="status" className="text-xs text-muted-foreground">{t("mcp.message.loading")}</p>}
      {feedback && (
        <p role={mutationError || loadError ? "alert" : "status"} className="text-xs text-muted-foreground" data-testid="mcp-servers-message">
          {feedback}
        </p>
      )}
      {loadError && (
        <PillButton variant="outline" outlineTone="neutral" size="sm" onClick={() => void refresh()}>
          {t("mcp.message.retry")}
        </PillButton>
      )}
    </section>
  );
}
