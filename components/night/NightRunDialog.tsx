"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Moon, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NamedAgentSelect } from "@/components/shared/NamedAgentSelect";
import {
  DEFAULT_NIGHT_CIRCUIT_BREAKER,
  NIGHT_CIRCUIT_BREAKER_RANGE,
  NIGHT_CIRCUIT_BREAKER_SETTING_KEY,
  NIGHT_COST_CAP_SETTING_KEY,
  parseNightCircuitBreaker,
  parseNightCostCap,
} from "@/lib/night/constants";

interface ScopeEpic {
  id: string;
  title: string;
  status: string;
}

export interface NightRunStartedResult {
  batchId: string;
  waves: number;
  totalEpics: number;
  message: string;
}

interface NightRunDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Named agent pre-selected from the board toolbar, if any. */
  defaultNamedAgentId?: string | null;
  onStarted?: (result: NightRunStartedResult) => void;
  onError?: (message: string) => void;
}

/** Friendly copy for the guard codes the batch route can refuse with. */
const CONFLICT_MESSAGES: Record<string, string> = {
  NIGHT_RUN_ACTIVE:
    "A night run is already going for this project — wait for it to finish.",
  BATCH_ACTIVE:
    "A batch build is still running — let it finish before starting the night.",
  PIPELINE_ACTIVE_ON_EPIC:
    "A pipeline run is already active on an epic in this scope.",
};

/**
 * Confirm dialog for an unattended overnight run: picks the scope (To Do
 * epics, optionally Backlog too), previews the prerequisites the server will
 * pull in, collects the safety valves (failure policy, circuit breaker, cost
 * cap) and POSTs the batch build in `dag` + `pipeline` mode — the night
 * semantics of the existing batch route.
 */
export function NightRunDialog({
  projectId,
  open,
  onOpenChange,
  defaultNamedAgentId = null,
  onStarted,
  onError,
}: NightRunDialogProps) {
  const [epics, setEpics] = useState<ScopeEpic[]>([]);
  const [loadingEpics, setLoadingEpics] = useState(false);
  const [includeBacklog, setIncludeBacklog] = useState(false);
  const [failurePolicy, setFailurePolicy] = useState<"halt" | "stop">("halt");
  const [circuitBreaker, setCircuitBreaker] = useState<string>(
    String(DEFAULT_NIGHT_CIRCUIT_BREAKER)
  );
  const [costCap, setCostCap] = useState<string>("");
  const [namedAgentId, setNamedAgentId] = useState<string | null>(
    defaultNamedAgentId
  );
  const [autoIncluded, setAutoIncluded] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Board epics: the scope is picked here rather than from the selection so
  // "Night run" works without selecting anything first.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingEpics(true);
    fetch(`/api/projects/${projectId}/epics`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setEpics(Array.isArray(d?.data) ? (d.data as ScopeEpic[]) : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingEpics(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, open]);

  // Defaults for the two safety valves come from the global settings.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const breaker = parseNightCircuitBreaker(
          d?.data?.[NIGHT_CIRCUIT_BREAKER_SETTING_KEY]
        );
        setCircuitBreaker(
          String(breaker ?? DEFAULT_NIGHT_CIRCUIT_BREAKER)
        );
        const cap = parseNightCostCap(d?.data?.[NIGHT_COST_CAP_SETTING_KEY]);
        setCostCap(cap == null ? "" : String(cap));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) setNamedAgentId(defaultNamedAgentId);
  }, [open, defaultNamedAgentId]);

  const scopeEpicIds = useMemo(() => {
    const wanted = includeBacklog
      ? new Set(["todo", "backlog"])
      : new Set(["todo"]);
    return epics.filter((e) => wanted.has(e.status)).map((e) => e.id);
  }, [epics, includeBacklog]);

  // Live preview of what the server will actually run: it re-expands the
  // scope with the transitive prerequisites (dropping done/released ones).
  const loadPreview = useCallback(async () => {
    if (scopeEpicIds.length === 0) {
      setAutoIncluded([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/projects/${projectId}/dependencies/transitive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketIds: scopeEpicIds }),
        }
      );
      const json = await res.json();
      setAutoIncluded(
        Array.isArray(json?.data?.autoIncluded) ? json.data.autoIncluded : []
      );
    } catch {
      setAutoIncluded([]);
    }
  }, [projectId, scopeEpicIds]);

  useEffect(() => {
    if (!open) return;
    void loadPreview();
  }, [open, loadPreview]);

  async function handleConfirm() {
    if (scopeEpicIds.length === 0) return;
    setSubmitting(true);
    setError(null);

    const breaker = parseNightCircuitBreaker(circuitBreaker);
    const cap = parseNightCostCap(costCap);

    try {
      const res = await fetch(`/api/projects/${projectId}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          epicIds: scopeEpicIds,
          mode: "dag",
          pipeline: true,
          failurePolicy,
          namedAgentId,
          ...(breaker == null ? {} : { circuitBreaker: breaker }),
          ...(cap == null ? {} : { costCapUsd: cap }),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.error) {
        const message =
          (data?.code && CONFLICT_MESSAGES[data.code as string]) ||
          data?.error ||
          "Failed to start the night run";
        setError(message);
        onError?.(message);
        return;
      }

      const waves = Number(data?.data?.waves ?? 0);
      const totalEpics = Number(
        data?.data?.totalEpics ?? scopeEpicIds.length
      );
      onStarted?.({
        batchId: String(data?.data?.batchId ?? ""),
        waves,
        totalEpics,
        message: `Night run started — wave 1/${waves}, ${totalEpics} epic${
          totalEpics === 1 ? "" : "s"
        }`,
      });
      onOpenChange(false);
    } catch {
      const message = "Failed to start the night run";
      setError(message);
      onError?.(message);
    } finally {
      setSubmitting(false);
    }
  }

  const scopeLabel =
    scopeEpicIds.length === 0
      ? loadingEpics
        ? "Loading epics…"
        : includeBacklog
          ? "No To Do or Backlog epics to run"
          : "No To Do epics to run"
      : autoIncluded.length > 0
        ? `${scopeEpicIds.length} epic${
            scopeEpicIds.length === 1 ? "" : "s"
          } + ${autoIncluded.length} required prerequisite${
            autoIncluded.length === 1 ? "" : "s"
          }`
        : `${scopeEpicIds.length} epic${scopeEpicIds.length === 1 ? "" : "s"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Moon className="h-4 w-4" />
            Night run
          </DialogTitle>
          <DialogDescription>
            Builds every epic in scope in dependency waves, each one chained
            through the autonomous build → review → fix pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium" data-testid="night-scope-preview">
              {scopeLabel}
            </p>
            <p className="text-xs text-muted-foreground">
              Scope is every To Do epic. Prerequisites are pulled in
              automatically; epics already Done or Released are left alone.
            </p>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                data-testid="night-include-backlog"
                checked={includeBacklog}
                onChange={(e) => setIncludeBacklog(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border"
              />
              Include Backlog
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="night-failure-policy"
                className="block text-sm font-medium"
              >
                On failure
              </label>
              <Select
                value={failurePolicy}
                onValueChange={(v) => setFailurePolicy(v as "halt" | "stop")}
              >
                <SelectTrigger
                  id="night-failure-policy"
                  className="h-8 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="halt">
                    Halt — skip dependents, keep going
                  </SelectItem>
                  <SelectItem value="stop">
                    Stop — end the run after the wave
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="night-circuit-breaker"
                className="block text-sm font-medium"
              >
                Circuit breaker
              </label>
              <Input
                id="night-circuit-breaker"
                data-testid="night-circuit-breaker"
                type="number"
                min={NIGHT_CIRCUIT_BREAKER_RANGE.min}
                max={NIGHT_CIRCUIT_BREAKER_RANGE.max}
                className="h-8 text-xs"
                value={circuitBreaker}
                onChange={(e) => setCircuitBreaker(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Stop after this many consecutive epic failures (0 = off).
              </p>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="night-cost-cap"
                className="block text-sm font-medium"
              >
                Cost cap (USD)
              </label>
              <Input
                id="night-cost-cap"
                data-testid="night-cost-cap"
                type="number"
                min={0}
                step="0.5"
                className="h-8 text-xs"
                placeholder="Unlimited"
                value={costCap}
                onChange={(e) => setCostCap(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Claude-reported costs only — other providers are not counted,
                so the run may spend more than the cap.
              </p>
            </div>

            <div className="space-y-1">
              <span className="block text-sm font-medium">Agent</span>
              <NamedAgentSelect
                value={namedAgentId}
                onChange={setNamedAgentId}
                className="w-full h-8 text-xs"
              />
            </div>
          </div>

          <div
            data-testid="night-run-warning"
            className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200"
          >
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Agents run <strong>unattended all night</strong>: they create
              worktrees and branches, commit code and spend API budget without
              anyone watching. Nothing gets approved or merged — every epic
              stops in Review for your sign-off in the morning.
            </span>
          </div>

          {error && (
            <p className="text-xs text-destructive" data-testid="night-run-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting || scopeEpicIds.length === 0}
            data-testid="night-run-confirm"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Moon className="h-4 w-4 mr-1" />
            )}
            Start night run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
