"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/i18n/format";
import type { UiLocale } from "@/lib/i18n/locales";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestJson, fetchJson, type ApiResult } from "@/lib/api/client";
import { useScopedMutation } from "@/hooks/useScopedMutation";
import { Clock3, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { PillButton, Stamp } from "@/components/piscine";
import { NamedAgentSelect } from "@/components/shared/NamedAgentSelect";
import {
  AVAILABLE_ROUTINE_KINDS,
  ROUTINE_KIND_DESCRIPTIONS,
  ROUTINE_KIND_LABELS,
  defaultRoutineConfig,
  isAvailableRoutineKind,
  type AvailableRoutineKind,
} from "@/lib/routines/constants";

interface RoutineRecord {
  id: string;
  projectId: string;
  kind: AvailableRoutineKind;
  enabled: boolean;
  timeOfDay: string;
  config: Record<string, unknown>;
  lastRunAt: string | null;
  lastStatus: string | null;
}

interface RoutineKindOption {
  kind: AvailableRoutineKind;
  label: string;
  description: string;
}

interface RoutinesResponse {
  data?: RoutineRecord[];
  meta?: {
    availableKinds?: Array<{
      kind?: unknown;
      label?: unknown;
      description?: unknown;
    }>;
    serverTimezone?: unknown;
    ciAutofixEnabled?: unknown;
  };
  error?: string;
}

const DEFAULT_TIME_OF_DAY = "22:00";

/*
 * NO COPY IN THE HELPERS BELOW. `parseConfig`, `formatLastRun` and
 * `statusLabel` are pure and evaluated outside React, so they take their
 * phrases ALREADY RESOLVED from the component that calls them — they compose,
 * they do not word (`lib/i18n/catalogue.ts`, pattern 3).
 */

function fallbackKindOptions(): RoutineKindOption[] {
  return AVAILABLE_ROUTINE_KINDS.map((kind) => ({
    kind,
    label: ROUTINE_KIND_LABELS[kind],
    description: ROUTINE_KIND_DESCRIPTIONS[kind],
  }));
}

function parseKindOptions(
  value: RoutinesResponse["meta"],
): RoutineKindOption[] {
  const parsed = (Array.isArray(value?.availableKinds) ? value.availableKinds : []).flatMap((option) => {
    if (!isAvailableRoutineKind(option.kind)) return [];
    return [
      {
        kind: option.kind,
        label:
          typeof option.label === "string"
            ? option.label
            : ROUTINE_KIND_LABELS[option.kind],
        description:
          typeof option.description === "string"
            ? option.description
            : ROUTINE_KIND_DESCRIPTIONS[option.kind],
      },
    ];
  });
  return parsed.length > 0 ? parsed : fallbackKindOptions();
}

function formatConfig(config: Record<string, unknown>): string {
  return JSON.stringify(config, null, 2);
}

function parseConfig(
  config: string,
  copy: { notJson: string; notObject: string; invalid: string },
): ApiResult<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(config);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: null, error: copy.notObject };
    }
    return { data: parsed as Record<string, unknown>, error: null };
  } catch (error) {
    return { data: null, error: error instanceof SyntaxError ? copy.notJson : copy.invalid };
  }
}

function isRoutine(value: unknown): value is RoutineRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as RoutineRecord;
  return typeof row.id === "string" && isAvailableRoutineKind(row.kind)
    && typeof row.enabled === "boolean" && typeof row.timeOfDay === "string"
    && Boolean(row.config && typeof row.config === "object" && !Array.isArray(row.config));
}

const isAutofix = (value: unknown): value is { enabled: boolean } =>
  Boolean(value && typeof value === "object" && "enabled" in value && typeof value.enabled === "boolean");

function formatLastRun(
  value: string | null,
  serverTimezone: string,
  locale: UiLocale,
  never: string,
): string {
  if (!value) return never;
  return (
    formatDateTime(value, {
      locale,
      style: "dateTime",
      ...(serverTimezone !== "local" ? { timeZone: serverTimezone } : {}),
    }) || value
  );
}

/**
 * The routine's last outcome. `status` is the SERVER's own value
 * (`completed`, `failed`, `running`, `scheduled`) and stays out of the
 * catalogue like every other persisted string; only the "no run yet" wording
 * is copy.
 */
function statusLabel(status: string | null, notRun: string): string {
  if (!status) return notRun;
  return status.replaceAll("_", " ");
}

function routineStatusTone(status: string | null): "live" | "failed" | "next" | "asks" {
  if (status === "completed") return "live";
  if (status === "failed") return "failed";
  if (status === "running") return "next";
  return "asks";
}

interface RoutineEditorProps {
  projectId: string;
  routine: RoutineRecord | null;
  kindOptions: RoutineKindOption[];
  serverTimezone: string;
  onSaved: (routine: RoutineRecord) => void;
  onDeleted: (routineId: string) => void;
  onCancelNew: () => void;
}

function RoutineEditor({
  projectId,
  routine,
  kindOptions,
  serverTimezone,
  onSaved,
  onDeleted,
  onCancelNew,
}: RoutineEditorProps) {
  const locale = useLocale();
  const t = useTranslations("Routines");
  const initialKind = routine?.kind ?? kindOptions[0]?.kind ?? "night_run";
  const [kind, setKind] = useState<AvailableRoutineKind>(initialKind);
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [timeOfDay, setTimeOfDay] = useState(
    routine?.timeOfDay ?? DEFAULT_TIME_OF_DAY,
  );
  const [configText, setConfigText] = useState(
    formatConfig(routine?.config ?? defaultRoutineConfig(initialKind)),
  );
  const [action, setAction] = useState<"save" | "delete">("save");
  const { run, pending, error: mutationError, clearError } = useScopedMutation(`routine:${projectId}:${routine?.id ?? "new"}`);
  const saving = pending && action === "save";
  const deleting = pending && action === "delete";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(routine);
  const isNew = routine === null;
  const selectedKind =
    kindOptions.find((option) => option.kind === kind) ?? kindOptions[0];

  // Refresh status metadata without discarding unsaved configuration. Update
  // each field only if the user has left its previous server value intact.
  if (routine !== baseline) {
    setBaseline(routine);
    if (routine) {
      if (!baseline || kind === baseline.kind) setKind(routine.kind);
      if (!baseline || enabled === baseline.enabled) setEnabled(routine.enabled);
      if (!baseline || timeOfDay === baseline.timeOfDay) setTimeOfDay(routine.timeOfDay);
      if (!baseline || configText === formatConfig(baseline.config)) {
        setConfigText(formatConfig(routine.config));
      }
    }
  }

  async function save() {
    setError(null);
    clearError();
    setMessage(null);
    const config = parseConfig(configText, {
      notJson: t("errors.configNotJson"),
      notObject: t("errors.configNotObject"),
      invalid: t("errors.invalidConfig"),
    });
    if (config.error !== null) { setError(config.error); return; }
    const saved = await run(async () => {
      setAction("save");
      const url = routine
        ? `/api/projects/${projectId}/routines/${routine.id}`
        : `/api/projects/${projectId}/routines`;
      const response = await requestJson<RoutineRecord>(url, {
        method: routine ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, enabled, timeOfDay, config: config.data }),
        errorMessage: t("errors.save"), validateData: isRoutine,
      });
      if (response.error !== null) throw new Error(response.error);
      return response.data;
    }, t("errors.save"));
    if (!saved) return;
    setBaseline(saved);
    setKind(saved.kind);
    setEnabled(saved.enabled);
    setTimeOfDay(saved.timeOfDay);
    setConfigText(formatConfig(saved.config));
    onSaved(saved);
    setMessage(isNew ? t("editor.created") : t("editor.saved"));
  }

  async function toggleEnabled(next: boolean) {
    if (!routine) { setEnabled(next); return; }
    setError(null);
    const saved = await run(async () => {
      setAction("save");
      const response = await requestJson<RoutineRecord>(`/api/projects/${projectId}/routines/${routine.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }), errorMessage: t("errors.update"), validateData: isRoutine,
      });
      if (response.error !== null) throw new Error(response.error);
      return response.data;
    }, t("errors.update"));
    if (saved) {
      setEnabled(saved.enabled);
      onSaved(saved);
    }
  }

  async function remove() {
    if (!routine) return;
    setError(null);
    const removed = await run(async () => {
      setAction("delete");
      const response = await requestJson<unknown>(`/api/projects/${projectId}/routines/${routine.id}`, {
        method: "DELETE", errorMessage: t("errors.delete"),
      });
      if (response.error !== null) throw new Error(response.error);
      return true;
    }, t("errors.delete"));
    if (removed) onDeleted(routine.id);
    setConfirmDelete(false);
  }

  function changeKind(next: AvailableRoutineKind) {
    setKind(next);
    setConfigText(formatConfig(defaultRoutineConfig(next)));
    setMessage(null);
    setError(null);
    clearError();
  }

  return (
    <article
      className="rounded-[10px] border border-border/40 bg-card p-3.5"
      data-testid={routine ? `routine-${routine.id}` : "new-routine"}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-foreground">
              {isNew ? t("editor.newRoutine") : ROUTINE_KIND_LABELS[routine.kind]}
            </h3>
            {!isNew && (
              <Stamp tone={routineStatusTone(routine.lastStatus)}>
                {statusLabel(routine.lastStatus, t("editor.statusNotRun"))}
              </Stamp>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedKind?.description}
          </p>
        </div>

        <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium">
          <input
            id={`enabled-${routine?.id ?? "new"}`}
            type="checkbox"
            className="rounded accent-primary cursor-pointer"
            checked={enabled}
            disabled={saving || deleting}
            aria-label={t("editor.enableAria", {
              label: selectedKind?.label ?? t("editor.routineFallback"),
            })}
            onChange={(e) => void toggleEnabled(e.target.checked)}
          />
          <span>{t("editor.enabled")}</span>
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(180px,0.7fr)_160px_minmax(280px,1.3fr)]">
        <div className="space-y-1">
          <label
            className="block text-xs font-medium text-muted-foreground"
            htmlFor={`kind-${routine?.id ?? "new"}`}
          >
            {t("editor.kind")}
          </label>
          <select
            id={`kind-${routine?.id ?? "new"}`}
            data-testid="routine-kind-select"
            className="h-8 w-full rounded-[6px] border border-border/50 bg-background px-2.5 text-xs outline-none focus:border-primary cursor-pointer"
            value={kind}
            disabled={saving || deleting}
            onChange={(e) => {
              const value = e.target.value;
              if (isAvailableRoutineKind(value)) changeKind(value);
            }}
          >
            {kindOptions.map((option) => (
              <option key={option.kind} value={option.kind}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label
            className="block text-xs font-medium text-muted-foreground"
            htmlFor={`time-${routine?.id ?? "new"}`}
          >
            {t("editor.dailyTime")}
          </label>
          <input
            id={`time-${routine?.id ?? "new"}`}
            type="time"
            className="h-8 w-full rounded-[6px] border border-border/50 bg-background px-2.5 text-xs font-mono outline-none focus:border-primary"
            value={timeOfDay}
            disabled={saving || deleting}
            onChange={(event) => setTimeOfDay(event.target.value)}
          />
          {kind === "ci_watch" && (
            <p className="text-[11px] text-muted-foreground">
              {t("editor.ciWatchTimeNote")}
            </p>
          )}
        </div>

        <div className="space-y-2">
          {kind === "night_run" && (
            <div className="space-y-1">
              <span className="block text-xs font-medium text-muted-foreground">
                {t("editor.namedAgent")}
              </span>
              <NamedAgentSelect
                value={(() => {
                  try {
                    const p = JSON.parse(configText);
                    return typeof p?.namedAgentId === "string" ? p.namedAgentId : null;
                  } catch {
                    return null;
                  }
                })()}
                onChange={(agentId) => {
                  try {
                    const p = JSON.parse(configText);
                    if (!agentId || agentId === "__none__") {
                      delete p.namedAgentId;
                    } else {
                      p.namedAgentId = agentId;
                    }
                    setConfigText(formatConfig(p));
                  } catch {}
                }}
                disabled={saving || deleting}
                dispatchRole="night_runs"
                allowClear
              />
            </div>
          )}
          <div className="space-y-1">
            <label
              className="block text-xs font-medium text-muted-foreground"
              htmlFor={`config-${routine?.id ?? "new"}`}
            >
              {t("editor.configuration")}
            </label>
            <textarea
              id={`config-${routine?.id ?? "new"}`}
              value={configText}
              rows={4}
              spellCheck={false}
              disabled={saving || deleting}
              onChange={(event) => setConfigText(event.target.value)}
              className="w-full rounded-[6px] border border-border/50 bg-background p-2 font-mono text-xs outline-none focus:border-primary resize-y"
            />
            <p className="text-[11px] text-muted-foreground">
              {kind === "night_run"
                ? t("editor.configHintNightRun")
                : kind === "github_issue_sync"
                  ? t("editor.configHintGithubIssueSync")
                  : kind === "retention"
                    ? t("editor.configHintRetention")
                    : t("editor.configHintInterval")}
            </p>
          </div>
        </div>
      </div>

      {!isNew && routine.lastStatus === "scheduled" && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          {t("editor.scheduledTomorrow", {
            time: routine.timeOfDay,
            timezone: serverTimezone,
          })}
        </div>
      )}

      {!isNew && routine.lastStatus !== "scheduled" && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          {t("editor.lastRun", {
            time: formatLastRun(
              routine.lastRunAt,
              serverTimezone,
              locale,
              t("editor.lastRunNever"),
            ),
          })}
          <span aria-hidden="true">·</span>
          {t("editor.status", {
            status: statusLabel(routine.lastStatus, t("editor.statusNotRun")),
          })}
        </div>
      )}

      {(error || mutationError || message) && (
        <p
          role={error || mutationError ? "alert" : "status"}
          className={`mt-2 text-xs ${
            error || mutationError ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {error ?? mutationError ?? message}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <PillButton
          type="button"
          size="sm"
          variant="filled"
          disabled={saving || deleting}
          onClick={() => void save()}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
          {isNew ? t("editor.create") : t("editor.save")}
        </PillButton>

        {isNew ? (
          <PillButton
            type="button"
            size="sm"
            variant="outline"
            outlineTone="neutral"
            disabled={pending}
            onClick={onCancelNew}
          >
            {t("editor.cancel")}
          </PillButton>
        ) : confirmDelete ? (
          <>
            <PillButton
              type="button"
              size="sm"
              variant="filled"
              labelTone="danger"
              disabled={pending}
              onClick={() => void remove()}
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              {t("editor.confirmDelete")}
            </PillButton>
            <PillButton
              type="button"
              size="sm"
              variant="outline"
              outlineTone="neutral"
              disabled={pending}
              onClick={() => setConfirmDelete(false)}
            >
              {t("editor.cancel")}
            </PillButton>
          </>
        ) : (
          <PillButton
            type="button"
            size="sm"
            variant="outline"
            outlineTone="neutral"
            labelTone="danger"
            className="ml-auto"
            aria-label={t("editor.deleteAria", {
              label: selectedKind?.label ?? t("editor.routineFallback"),
            })}
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {t("editor.delete")}
          </PillButton>
        )}
      </div>
    </article>
  );
}

export function RoutinesSettings({ projectId }: { projectId: string }) {
  return <RoutinesWorkspace key={projectId} projectId={projectId} />;
}

function RoutinesWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations("Routines");
  const [routines, setRoutines] = useState<RoutineRecord[]>([]);
  const [kindOptions, setKindOptions] = useState<RoutineKindOption[]>(
    fallbackKindOptions(),
  );
  const [serverTimezone, setServerTimezone] = useState("local");
  const [ciAutofixEnabled, setCiAutofixEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { run: runAutofix, pending: savingAutofix, error: autofixError, clearError: clearAutofixError } = useScopedMutation(`autofix:${projectId}`);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readSequence = useRef(0);

  const load = useCallback(() => {
    const sequence = ++readSequence.current;
    return fetchJson<RoutinesResponse>(`/api/projects/${projectId}/routines`).then((response) => {
      if (sequence !== readSequence.current) return;
      const payload = response?.body;
      if (!response?.ok || payload?.error || !Array.isArray(payload?.data) || !payload.data.every(isRoutine)) {
        setError(payload?.error || t("errors.load"));
      } else {
        const options = parseKindOptions(payload.meta);
        const allowed = new Set(options.map((option) => option.kind));
        setKindOptions(options);
        setRoutines(payload.data.filter((routine) => allowed.has(routine.kind)));
        if (typeof payload.meta?.serverTimezone === "string") setServerTimezone(payload.meta.serverTimezone);
        setCiAutofixEnabled(payload.meta?.ciAutofixEnabled === true);
        setHasLoaded(true);
        setError(null);
      }
      setLoading(false);
      setRefreshing(false);
    });
  }, [projectId, t]);

  function refresh() {
    setRefreshing(true);
    clearAutofixError();
    void load();
  }

  useEffect(() => {
    void load();
    return () => { readSequence.current += 1; };
  }, [load]);

  const availableKindsLabel = useMemo(
    () => kindOptions.map((option) => option.label).join(", "),
    [kindOptions],
  );
  const configuredKinds = useMemo(
    () => new Set(routines.map((routine) => routine.kind)),
    [routines],
  );
  const newRoutineKindOptions = useMemo(
    () => kindOptions.filter((option) => !configuredKinds.has(option.kind)),
    [configuredKinds, kindOptions],
  );

  function invalidateReads() {
    readSequence.current += 1;
    setLoading(false);
    setRefreshing(false);
  }

  function upsertRoutine(next: RoutineRecord) {
    invalidateReads();
    setRoutines((current) => {
      const index = current.findIndex((routine) => routine.id === next.id);
      if (index < 0) return [...current, next];
      return current.map((routine) =>
        routine.id === next.id ? next : routine,
      );
    });
    setCreating(false);
  }

  async function toggleAutofix(next: boolean) {
    if (!hasLoaded || error) return;
    const saved = await runAutofix(async () => {
      const response = await requestJson<{ enabled: boolean }>(
        `/api/projects/${projectId}/routines/ci-autofix`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }),
          errorMessage: t("errors.autofix"), validateData: isAutofix },
      );
      if (response.error !== null) throw new Error(response.error);
      return response.data;
    }, t("errors.autofix"));
    if (saved) {
      invalidateReads();
      setCiAutofixEnabled(saved.enabled);
    }
  }

  return (
    <section
      className="space-y-4 rounded-[12px] border border-border/40 bg-card p-4"
      data-testid="routines-settings-section"
    >
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <h2 className="text-base font-semibold">{t("section.heading")}</h2>
          <p className="text-xs text-muted-foreground">
            {serverTimezone !== "local"
              ? t("section.timezoneNoteZoned", {
                  timezone: serverTimezone,
                })
              : t("section.timezoneNote")}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("section.availableKinds", { kinds: availableKindsLabel })}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <PillButton
            type="button"
            variant="outline"
            outlineTone="neutral"
            size="sm"
            disabled={loading || refreshing}
            onClick={refresh}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            {t("page.refresh")}
          </PillButton>
          <PillButton
            type="button"
            variant="filled"
            size="sm"
            disabled={!hasLoaded || Boolean(error) || creating || newRoutineKindOptions.length === 0}
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("page.addRoutine")}
          </PillButton>
        </div>
      </div>

      <div className="rounded-[10px] border border-border/40 bg-muted/20 p-3">
        <label className="flex items-start gap-2.5 text-xs cursor-pointer">
          <input
            id="ci-autofix-enabled"
            type="checkbox"
            className="mt-0.5 rounded accent-primary cursor-pointer"
            checked={ciAutofixEnabled}
            disabled={loading || !!error || savingAutofix}
            aria-label={t("autofix.label")}
            onChange={(e) =>
              void toggleAutofix(e.target.checked)
            }
          />
          <div>
            <span className="font-medium text-foreground">{t("autofix.label")}</span>
            <span className="block text-[11px] text-muted-foreground">
              {t("autofix.description")}
            </span>
          </div>
        </label>
        {autofixError && (
          <p
            className="mt-2 text-xs text-destructive"
            role="alert"
          >
            {autofixError}
          </p>
        )}
      </div>

      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("page.loading")}
        </div>
      ) : hasLoaded ? (
        <div className="space-y-3">
          {creating && (
            <RoutineEditor
              projectId={projectId}
              routine={null}
              kindOptions={newRoutineKindOptions}
              serverTimezone={serverTimezone}
              onSaved={upsertRoutine}
              onDeleted={() => {}}
              onCancelNew={() => setCreating(false)}
            />
          )}

          {routines.length === 0 && !creating && (
            <div className="rounded-[10px] border border-dashed border-border/50 p-6 text-center">
              <p className="text-xs font-medium text-foreground">
                {t("empty.title")}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("empty.description")}
              </p>
            </div>
          )}

          {routines.map((routine) => (
            <RoutineEditor
              key={routine.id}
              projectId={projectId}
              routine={routine}
              kindOptions={kindOptions.filter(
                (option) =>
                  option.kind === routine.kind ||
                  !configuredKinds.has(option.kind),
              )}
              serverTimezone={serverTimezone}
              onSaved={upsertRoutine}
              onDeleted={(routineId) => {
                invalidateReads();
                setRoutines((current) =>
                  current.filter((item) => item.id !== routineId),
                );
              }}
              onCancelNew={() => {}}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
