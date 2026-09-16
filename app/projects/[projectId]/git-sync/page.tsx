"use client";

import { useProjects } from "@/hooks/useProjects";
import { usePolledResource } from "@/hooks/usePolledResource";
import { fetchJson, requestJson } from "@/lib/api/client";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { PillButton } from "@/components/piscine";
import { Input } from "@/components/ui/input";
import { ToastStack } from "@/components/toast/ToastStack";
import { useToastStack } from "@/components/toast/useToastStack";
import { NamedAgentSelect } from "@/components/shared/NamedAgentSelect";
import { RepoStrataBand } from "@/components/github/RepoStrataBand";
import { SessionPicker } from "@/components/shared/SessionPicker";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNamedAgentsList } from "@/hooks/useNamedAgentsList";
import { useWorktrees, type WorktreeState } from "@/hooks/useWorktrees";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/catalogue";
import { formatRelative } from "@/lib/i18n/format";
import {
  Loader2,
  ArrowDownToLine,
  ArrowUpToLine,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

interface StatusResponse {
  data?: {
    branch: string;
    remote: string;
    ahead: number;
    behind: number;
    hasRemoteBranch: boolean;
    /** null when the server could not read the repository's remote list. */
    remoteConfigured?: boolean | null;
    configuredRemotes?: string[] | null;
    remoteFetchConfigured?: boolean | null;
    remotePushConfigured?: boolean | null;
    fetchRemotes?: string[] | null;
    pushRemotes?: string[] | null;
    lastFetchedAt?: number | null;
    lastFetchError?: string | null;
  };
  error?: string;
}

interface ConflictDiff {
  filePath: string;
  diff: string;
}

/** Worktree state → the token that colors it (agent teal / meta / bug). */
const WORKTREE_STATE_TONE: Record<WorktreeState, string> = {
  running: "text-agent",
  idle: "text-meta",
  orphan: "text-destructive",
};

/**
 * A MODULE-SCOPE COPY TABLE, so it holds catalogue KEY REFERENCES and the
 * aside resolves them at render with the namespace-less translator
 * (`lib/i18n/catalogue.ts`, pattern 3).
 */
const WORKTREE_STATE_LABEL_KEYS: Record<WorktreeState, TranslationKey> = {
  running: "GitSync.worktrees.running",
  idle: "GitSync.worktrees.idle",
  orphan: "GitSync.worktrees.orphan",
};

/** The `<mono>` of the missing-remote prose — the remote name, in mono. */
const monoTag = (chunks: ReactNode) => <span className="font-mono">{chunks}</span>;

function diffLineTone(line: string): string {
  if (line.startsWith("@@")) return "text-meta";
  if (line.startsWith("+++") || line.startsWith("---")) return "text-meta";
  if (line.startsWith("+")) return "text-agent";
  if (line.startsWith("-")) return "text-destructive";
  return "";
}

export default function GitSyncPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  return <GitSyncContent key={projectId} projectId={projectId} />;
}

function GitSyncContent({ projectId }: { projectId: string }) {
  const locale = useLocale();
  const t = useTranslations("GitSync");
  // The worktree-state table holds full dotted paths, so it resolves through
  // the namespace-less translator.
  const tKey = useTranslations();

  /**
   * The project record comes from the shared catalogue.
   * The repository band consumes this
   * page’s branch status snapshot.
   */
  const { allProjects } = useProjects();
  const project = allProjects.find((row) => row.id === projectId) ?? null;
  const logs = usePolledResource<Array<{ id: string; operation: string; status: string; createdAt: string | null }>>(`/api/projects/${projectId}/git/log`, 10000, useCallback(() => t("history.failed"), [t]), { validateData: Array.isArray });
  const [exporting, setExporting] = useState(false);
  const exportPending = useRef(false);

  const [remote, setRemote] = useState("origin");
  const [branchDraft, setBranchDraft] = useState<string | null>(null);
  const [resolvedBranch, setResolvedBranch] = useState("");
  const branch = branchDraft ?? resolvedBranch;
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [hasRemoteBranch, setHasRemoteBranch] = useState(true);
  // These come from the status read, so the missing-remote affordance is
  // re-derived on every mount instead of living in a push/pull response.
  const [configuredRemotes, setConfiguredRemotes] = useState<string[]>([]);
  const [remoteFetchConfigured, setRemoteFetchConfigured] = useState<
    boolean | null
  >(null);
  const [remotePushConfigured, setRemotePushConfigured] = useState<
    boolean | null
  >(null);
  const [fetchRemotes, setFetchRemotes] = useState<string[]>([]);
  const [pushRemotes, setPushRemotes] = useState<string[]>([]);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [lastFetchError, setLastFetchError] = useState<string | null>(null);
  const [statusBusy, setLoadingStatus] = useState(true);
  const [loadedStatusUrl, setLoadedStatusUrl] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * The error line, plus WHERE it came from.
   *
   * On a project with no local repository the status read cannot succeed, and
   * the Repository band above already says so in prose — so that one failure
   * is not repeated in coral underneath it. Every other error is the answer to
   * something the user asked for and is always shown.
   *
   * The provenance is bundled with the message rather than kept beside it: as
   * two independent `useState`s the flag survived an action's `setError(null)`
   * and went on suppressing the action's own failure. Set them together and
   * that cannot drift — `setError` is the ordinary path and always clears the
   * flag; only `refreshStatus` reaches for `setStatusReadError`.
   */
  const [errorState, setErrorState] = useState<{
    message: string | null;
    fromStatusRead: boolean;
  }>({ message: null, fromStatusRead: false });
  const error = errorState.message;
  const setError = useCallback((message: string | null) => {
    setErrorState({ message, fromStatusRead: false });
  }, []);
  const setStatusReadError = useCallback((message: string) => {
    setErrorState({ message, fromStatusRead: true });
  }, []);
  const [namedAgentId, setNamedAgentId] = useState<string | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | undefined>(undefined);
  const { agents } = useNamedAgentsList();

  const selectedProvider =
    agents.find((agent) => agent.id === namedAgentId)?.provider || "claude-code";
  const { toasts, raise: showToast, dismiss: dismissToast } = useToastStack();
  const [conflictDiffs, setConflictDiffs] = useState<ConflictDiff[]>([]);
  const [autoResolveConflicts, setAutoResolveConflicts] = useState(true);
  const operationPending = useRef(false);
  const statusRequest = useRef<AbortController | null>(null);
  const activeStatusUrl = useRef<string | null>(null);

  const statusUrl = useMemo(() => {
    const q = new URLSearchParams();
    q.set("remote", remote);
    if (branchDraft?.trim()) q.set("branch", branchDraft.trim());
    return `/api/projects/${projectId}/git/status?${q.toString()}`;
  }, [projectId, remote, branchDraft]);

  const loadingStatus = statusBusy || loadedStatusUrl !== statusUrl;
  const loadStatus = useCallback(() => {
    if (activeStatusUrl.current !== statusUrl) return Promise.resolve();
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    const { signal } = controller;
    return requestJson<NonNullable<StatusResponse["data"]>>(statusUrl, {
      signal, errorMessage: t("status.readFailed"),
    }).then((result) => {
      if (signal.aborted) return;
      setLoadingStatus(false);
      setLoadedStatusUrl(statusUrl);
      if (result.error !== null) {
        setStatusReadError(result.error);
        return;
      }
      setError(null);
      const data = result.data;
      setResolvedBranch(data.branch);
      setAhead(data.ahead);
      setBehind(data.behind);
      setHasRemoteBranch(data.hasRemoteBranch);
      setConfiguredRemotes(data.configuredRemotes ?? []);
      setRemoteFetchConfigured(data.remoteFetchConfigured ?? data.remoteConfigured ?? null);
      setRemotePushConfigured(data.remotePushConfigured ?? data.remoteConfigured ?? null);
      setFetchRemotes(data.fetchRemotes ?? data.configuredRemotes ?? []);
      setPushRemotes(data.pushRemotes ?? data.configuredRemotes ?? []);
      setLastFetchedAt(data.lastFetchedAt ?? null);
      setLastFetchError(data.lastFetchError ?? null);
    });
  }, [statusUrl, setError, setStatusReadError, t]);

  const refreshStatus = useCallback(() => {
    if (activeStatusUrl.current !== statusUrl) return Promise.resolve();
    setLoadingStatus(true);
    setError(null);
    return loadStatus();
  }, [statusUrl, loadStatus, setError]);

  useEffect(() => {
    activeStatusUrl.current = statusUrl;
    void loadStatus();
    return () => {
      activeStatusUrl.current = null;
      statusRequest.current?.abort();
    };
  }, [loadStatus, statusUrl]);

  // Declared after the status effect on purpose: the branch counters are the
  // page's headline, so their request must go out first.
  const {
    worktrees,
    orphanCount,
    loading: worktreesLoading,
    error: worktreeError,
    refresh: refreshWorktrees,
    prune: pruneWorktrees,
    pruning: pruningWorktrees,
  } = useWorktrees(projectId);

  async function exportJson() {
    if (exportPending.current) return;
    exportPending.current = true;
    setExporting(true);
    const result = await requestJson(`/api/projects/${projectId}/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "export" }), errorMessage: t("arji.exportFailed") });
    setError(result.error);
    if (!result.error) setMessage(t("arji.exported"));
    exportPending.current = false;
    setExporting(false);
  }

  async function synchronize(direction: "pull" | "push") {
    if (operationPending.current) return;
    operationPending.current = true;
    statusRequest.current?.abort();
    setLoadingStatus(false);
    setPulling(direction === "pull");
    setPushing(direction === "push");
    setError(null);
    setMessage(null);
    if (direction === "pull") setConflictDiffs([]);
    const fallback = direction === "pull" ? t("pull.failed") : t("push.failed");
    const response = await fetchJson<{
      data?: { sessionId?: string }; error?: string; code?: string;
      conflicted?: boolean; conflictDiffs?: ConflictDiff[];
    }>(`/api/projects/${projectId}/git/${direction}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        remote, branch: branch.trim() || undefined,
        ...(direction === "pull" ? { autoResolveConflicts, namedAgentId, resumeSessionId } : {}),
      }),
    });
    if (activeStatusUrl.current === null) {
      operationPending.current = false;
      return;
    }
    const json = response?.body;
    if (response?.status === 409 && json?.code === "remote_not_configured") {
      showToast("error", t("remoteMissing.toast"));
      await refreshStatus();
      setError(json.error || t("remoteMissing.error"));
    } else if (direction === "pull" && response?.status === 409 && json?.conflicted) {
      setError(json.error || t("pull.conflicts"));
      showToast("error", t("pull.conflicts"));
      setConflictDiffs(Array.isArray(json.conflictDiffs) ? json.conflictDiffs : []);
    } else if (!response?.ok || !json || json.error) {
      const message = json?.error || fallback;
      setError(message);
      showToast("error", message);
    } else {
      const agentStarted = direction === "pull" && response.status === 202;
      setMessage(agentStarted ? t("pull.agentStarted", { sessionId: json.data?.sessionId ?? "" })
        : direction === "pull" ? t("pull.done") : t("push.done"));
      showToast("success", agentStarted ? t("pull.agentStartedToast")
        : direction === "pull" ? t("pull.doneToast") : t("push.doneToast"));
      await refreshStatus();
    }
    operationPending.current = false;
    setPulling(false);
    setPushing(false);
  }

  function handlePull() { return synchronize("pull"); }
  function handlePush() { return synchronize("push"); }

  // `null` means the server could not read the remote list — unknown, not
  // missing, so the actions stay available.
  const fetchMissing = remoteFetchConfigured === false;
  const pushMissing = remotePushConfigured === false;
  const remoteMissing = fetchMissing && pushMissing;
  const operationMissing = fetchMissing || pushMissing;
  const recoveryRemotes = remoteMissing
    ? configuredRemotes
    : fetchMissing
      ? fetchRemotes
      : pushRemotes;

  const rows: Array<{ id: string; label: string; value: ReactNode }> = [
    {
      id: "ahead",
      label: t("status.ahead"),
      value: t("status.commits", { count: ahead }),
    },
    {
      id: "behind",
      label: t("status.behind"),
      value: t("status.commits", { count: behind }),
    },
    {
      id: "remote-branch",
      label: t("status.remoteBranch"),
      value: hasRemoteBranch ? t("status.yes") : t("status.no"),
    },
    {
      id: "last-fetch",
      label: t("status.lastFetch"),
      value:
        lastFetchedAt !== null || lastFetchError ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={
                  lastFetchError ? "text-priority-yellow" : "text-muted-foreground"
                }
              >
                {lastFetchedAt !== null
                  ? t("status.synced", {
                      age: formatRelative(lastFetchedAt, { locale }),
                    })
                  : t("status.neverSynced")}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {lastFetchError
                ? t("status.fetchError", { error: lastFetchError })
                : t("status.lastFetchHint")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-meta">—</span>
        ),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-start gap-[16px] px-[26px] pb-[18px] pt-[24px]">
        <div className="flex flex-col gap-[5px]">
          <h2 className="text-[19px] font-semibold">{t("header.title")}</h2>
          <p className="text-[13px] text-muted-foreground">
            {t("header.subtitle")}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-[9px]">
          <PillButton
            variant="outline"
            size="md"
            onClick={refreshStatus}
            disabled={loadingStatus || pulling || pushing}
          >
            {loadingStatus ? (
              <Loader2 className="h-[14px] w-[14px] animate-spin" />
            ) : (
              <RefreshCw className="h-[14px] w-[14px]" />
            )}
            {t("header.refresh")}
          </PillButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[26px] pb-[26px]">
        {/*
          Repository state, relocated from the pre-redesign RepoStatusBar that
          used to hang under the project board. Full width above the two
          columns: it is the headline of this page.
        */}
        {project ? (
          <RepoStrataBand
            projectId={projectId}
            ownerRepo={project.githubOwnerRepo}
            gitRepoPath={project.gitRepoPath}
            defaultBranch={project.defaultBranch}
            snapshot={{ branch, ahead, behind, lastFetchedAt, loading: loadingStatus, error, refresh: () => { void refreshStatus(); }, push: () => { void handlePush(); }, pushing, worktreeCount: worktreesLoading || worktreeError ? null : worktrees.length, refreshWorktrees: () => { void refreshWorktrees(); } }}
          />
        ) : null}

        <section className="space-y-2" aria-label={t("history.title")}>
          <h3>{t("history.title")}</h3>
          {logs.error && <p role="alert">{logs.error}</p>}
          {logs.data?.map((log) => <p key={log.id} className="text-sm"><time>{log.createdAt}</time> · {log.operation} · {log.status}</p>)}
        </section>
        <div className="flex min-h-0 gap-[22px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
          <div className="flex flex-col gap-[18px] rounded-[12px] border border-border bg-card p-[20px]">
            <div className="flex flex-wrap gap-[16px]">
              <div className="flex flex-col gap-[6px]">
                <label
                  htmlFor="git-sync-remote"
                  className="text-[12px] text-muted-foreground"
                >
                  {t("fields.remote")}
                </label>
                <Input
                  id="git-sync-remote"
                  value={remote}
                  onChange={(e) => setRemote(e.target.value)}
                  disabled={pulling || pushing}
                  className="h-[34px] w-[160px] rounded-[8px] font-mono text-[12.5px]"
                />
              </div>
              <div className="flex flex-col gap-[6px]">
                <label
                  htmlFor="git-sync-branch"
                  className="text-[12px] text-muted-foreground"
                >
                  {t("fields.branch")}
                </label>
                <Input
                  id="git-sync-branch"
                  value={branch}
                  onChange={(e) => setBranchDraft(e.target.value)}
                  disabled={pulling || pushing}
                  className="h-[34px] w-[160px] rounded-[8px] font-mono text-[12.5px]"
                />
              </div>
            </div>

            <div className="flex flex-col">
              {rows.map((row, index) => (
                <div
                  key={row.id}
                  className={cn(
                    "flex items-center justify-between border-t border-border-soft py-[11px]",
                    index === rows.length - 1 && "border-b"
                  )}
                >
                  <span className="text-[12.5px] text-muted-foreground">
                    {row.label}
                  </span>
                  <span className="text-[13px]">{row.value}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-[9px] text-[13px]">
              <label className="flex items-center gap-[9px]">
                <input
                  type="checkbox"
                  checked={autoResolveConflicts}
                  onChange={(e) => setAutoResolveConflicts(e.target.checked)}
                  className="h-[15px] w-[15px] accent-primary"
                />
                {t("fields.autoResolve")}
              </label>
              <div className="ml-auto flex flex-wrap items-center gap-[9px]">
                <NamedAgentSelect
                  value={namedAgentId}
                  onChange={(next: string) => setNamedAgentId(next)}
                  className="h-[31px] w-[220px] rounded-[8px] text-[12.5px]"
                  dispatchRole="merge"
                />
                <SessionPicker
                  projectId={projectId}
                  agentType="merge"
                  namedAgentId={namedAgentId}
                  provider={selectedProvider}
                  selectedSessionId={resumeSessionId}
                  onSelect={setResumeSessionId}
                />
              </div>
            </div>

            {operationMissing && (
              <div
                data-testid={
                  remoteMissing
                    ? "git-remote-missing"
                    : fetchMissing
                      ? "git-remote-fetch-missing"
                      : "git-remote-push-missing"
                }
                className="flex flex-col gap-[10px] rounded-[10px] border border-border-soft bg-band p-[14px]"
              >
                <div className="flex items-center gap-[9px]">
                  <TriangleAlert className="h-[15px] w-[15px] flex-none text-priority-yellow" />
                  <h3 className="text-[13.5px] font-semibold">
                    {remoteMissing
                      ? t("remoteMissing.titleBoth")
                      : fetchMissing
                        ? t("remoteMissing.titleFetch")
                        : t("remoteMissing.titlePush")}
                  </h3>
                </div>
                <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
                  {remoteMissing
                    ? t.rich("remoteMissing.bodyBoth", { remote, mono: monoTag })
                    : fetchMissing
                      ? t.rich("remoteMissing.bodyFetch", {
                          remote,
                          mono: monoTag,
                        })
                      : t.rich("remoteMissing.bodyPush", {
                          remote,
                          mono: monoTag,
                        })}
                </p>
                {recoveryRemotes.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-[9px]">
                    <span className="text-[12.5px] text-muted-foreground">
                      {t("remoteMissing.available")}
                    </span>
                    {recoveryRemotes.map((name) => (
                      <PillButton
                        key={name}
                        variant="outline"
                        size="sm"
                        data-testid={`use-remote-${name}`}
                        className="font-mono"
                        onClick={() => setRemote(name)}
                      >
                        {t("remoteMissing.use", { remote: name })}
                      </PillButton>
                    ))}
                  </div>
                ) : (
                  <p
                    data-testid="git-remote-add-hint"
                    className="text-[12.5px] leading-[1.55] text-muted-foreground"
                  >
                    {t("remoteMissing.configureHint")}{" "}
                    {/* A shell command, not copy: it is typed verbatim. */}
                    <span className="font-mono">
                      {remoteMissing
                        ? `git remote add ${remote} <url>`
                        : fetchMissing
                          ? `git remote set-url ${remote} <url>`
                          : `git remote set-url --push ${remote} <url>`}
                    </span>
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-[10px]">
              <PillButton
                variant="filled"
                size="md"
                onClick={handlePull}
                disabled={pulling || pushing || loadingStatus || fetchMissing}
              >
                {pulling ? (
                  <Loader2 className="h-[14px] w-[14px] animate-spin" />
                ) : (
                  <ArrowDownToLine className="h-[14px] w-[14px]" />
                )}
                {t("actions.pull")}
              </PillButton>
              <PillButton
                variant="outline"
                size="md"
                onClick={handlePush}
                disabled={pushing || pulling || loadingStatus || pushMissing}
              >
                {pushing ? (
                  <Loader2 className="h-[14px] w-[14px] animate-spin" />
                ) : (
                  <ArrowUpToLine className="h-[14px] w-[14px]" />
                )}
                {t("actions.push")}
              </PillButton>
            </div>

            {message && <p className="text-[13px] text-agent">{message}</p>}
            {/*
              Missing configuration is not an error. With no repository path
              the status read cannot succeed, and the band above already names
              what is missing and how to supply it; repeating that in coral
              would make an unconfigured project look broken.

              ONLY the status read is silenced. An action's failure is the
              user's own request answering back — a mid-session 409 from Push
              on a repository whose remote disappeared has to be visible, and
              suppressing every error on an unconfigured project swallowed it.
            */}
            {error && !(errorState.fromStatusRead && project?.gitRepoPath === null) && (
              <p data-testid="git-sync-error" className="text-[13px] text-destructive">
                {error}
              </p>
            )}
          </div>

          {conflictDiffs.length > 0 && (
            <div className="flex flex-col gap-[12px] rounded-[12px] border border-border bg-card p-[20px]">
              <div className="flex items-center gap-[10px]">
                <TriangleAlert className="h-[15px] w-[15px] flex-none text-destructive" />
                <h3 className="text-[14px] font-semibold">
                  {t("conflicts.title")}
                </h3>
              </div>
              {conflictDiffs.map((item) => (
                <div key={item.filePath} className="flex flex-col gap-[8px]">
                  <div className="font-mono text-[11.5px] text-meta">
                    {item.filePath}
                  </div>
                  <div className="overflow-x-auto rounded-[10px] bg-band p-[14px] font-mono text-[11.5px] leading-[1.8]">
                    {(item.diff || t("conflicts.noDiff"))
                      .split("\n")
                      .map((line, index) => (
                        <div
                          key={index}
                          className={cn(
                            "whitespace-pre-wrap",
                            diffLineTone(line)
                          )}
                        >
                          {line || " "}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="hidden w-[330px] flex-none flex-col gap-[16px] lg:flex">
          <div
            className="flex flex-col gap-[10px] rounded-[12px] border border-border p-[18px]"
            data-testid="git-sync-worktrees"
          >
            <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
              {t("worktrees.title")}
            </span>

            {worktreeError ? (
              <div role="alert" className="flex items-center gap-2 text-[13px] leading-[1.55] text-muted-foreground">
                <span>{worktreeError}</span>
                <PillButton variant="outline" size="sm" onClick={() => void refreshWorktrees()}>{t("header.refresh")}</PillButton>
              </div>
            ) : worktrees.length === 0 ? (
              <span className="text-[13px] leading-[1.55] text-muted-foreground">
                {worktreesLoading
                  ? t("worktrees.loading")
                  : t("worktrees.empty")}
              </span>
            ) : (
              <div className="flex flex-col">
                {worktrees.map((worktree) => (
                  <div
                    key={worktree.path}
                    data-testid={`worktree-row-${worktree.branch ?? worktree.path}`}
                    className="flex items-center justify-between gap-[10px] border-b border-border-soft py-[9px] last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-col gap-[2px]">
                      <span className="truncate font-mono text-[12px]">
                        {worktree.branch ?? t("worktrees.detached")}
                      </span>
                      {worktree.epicReadableId && (
                        <span className="font-mono text-[11px] text-meta">
                          {worktree.epicReadableId}
                        </span>
                      )}
                    </div>
                    <span
                      className={cn(
                        "flex-none text-[11.5px]",
                        WORKTREE_STATE_TONE[worktree.state]
                      )}
                    >
                      {tKey(WORKTREE_STATE_LABEL_KEYS[worktree.state])}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => void pruneWorktrees()}
              disabled={orphanCount === 0 || pruningWorktrees}
              data-testid="worktree-prune-button"
              className="self-start text-[12.5px] text-primary hover:underline disabled:cursor-not-allowed disabled:text-meta disabled:no-underline"
            >
              {orphanCount > 0
                ? t("worktrees.pruneCount", { count: orphanCount })
                : t("worktrees.prune")}
            </button>
          </div>

          <div className="flex flex-col gap-[10px] rounded-[12px] border border-border p-[18px]">
            <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
              {t("arji.title")}
            </span>
            <span className="text-[13.5px] leading-[1.55] text-muted-foreground">
              {t("arji.body")}
            </span>
            <PillButton variant="filled" size="md" onClick={exportJson} disabled={exporting}>{t("arji.export")}</PillButton>
          </div>
        </aside>
        </div>
      </div>

      <ToastStack items={toasts} onDismiss={dismissToast} testId="git-sync-toast" />
    </div>
  );
}
