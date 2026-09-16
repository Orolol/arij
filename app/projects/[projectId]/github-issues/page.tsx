"use client";

import { requestJson } from "@/lib/api/client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { PillButton } from "@/components/piscine";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Github, Loader2, RefreshCw } from "lucide-react";
import { ToastStack } from "@/components/toast/ToastStack";
import { useToastStack } from "@/components/toast/useToastStack";
import { useGitHubConfig } from "@/hooks/useGitHubConfig";
import type { GitHubConfigErrorCode } from "@/lib/github/client";
import type { TranslationKey } from "@/lib/i18n/catalogue";
import { cn } from "@/lib/utils";
import { usePolledResource } from "@/hooks/usePolledResource";

interface GitHubIssueRow {
  id: string;
  issueNumber: number;
  title: string;
  labels: string[];
  milestone: string | null;
  githubUrl: string;
  createdAtGitHub: string | null;
  importedEpicId: string | null;
}

interface LabelMapping { featureLabels: string[]; bugLabels: string[] }
function isLabelMapping(value: unknown): value is LabelMapping {
  if (!value || typeof value !== "object") return false;
  const mapping = value as Partial<LabelMapping>;
  return Array.isArray(mapping.featureLabels) && Array.isArray(mapping.bugLabels);
}

const GRID = "grid-cols-[64px_1fr_180px_110px_120px]";

/**
 * The triage and sync routes answer 400 with one of these codes when GitHub is
 * not set up for the project. Branching on the code -- rather than on the prose
 * message, or on a 500 that says nothing at all -- is what lets the page
 * explain the state instead of reporting a failure.
 *
 * A MODULE-SCOPE COPY TABLE, so it holds catalogue KEY REFERENCES and the page
 * resolves them at render with the namespace-less translator
 * (`lib/i18n/catalogue.ts`, pattern 3). The shape is load-bearing beyond the
 * copy: `asConfigErrorCode` tests membership against it.
 */
const CONFIG_EMPTY_STATE: Record<
  GitHubConfigErrorCode,
  { titleKey: TranslationKey; detailKey: TranslationKey }
> = {
  GITHUB_REPO_NOT_CONFIGURED: {
    titleKey: "GithubIssues.config.repoTitle",
    detailKey: "GithubIssues.config.repoDetail",
  },
  GITHUB_PAT_NOT_CONFIGURED: {
    titleKey: "GithubIssues.config.patTitle",
    detailKey: "GithubIssues.config.patDetail",
  },
};

function asConfigErrorCode(value: unknown): GitHubConfigErrorCode | null {
  return typeof value === "string" && value in CONFIG_EMPTY_STATE
    ? (value as GitHubConfigErrorCode)
    : null;
}

export default function GitHubIssuesPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  return <GitHubIssuesContent key={projectId} projectId={projectId} />;
}

function GitHubIssuesContent({ projectId }: { projectId: string }) {
  const t = useTranslations("GithubIssues");
  // The empty-state table holds full dotted paths, so it resolves through the
  // namespace-less translator.
  const tKey = useTranslations();

  const [issues, setIssues] = useState<GitHubIssueRow[]>([]);
  const [loadingIssues, setLoading] = useState(true);
  const [settledUrl, setSettledUrl] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [labelFilter, setLabelFilter] = useState("");
  const [milestoneFilter, setMilestoneFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [featureDraft, setFeatureLabels] = useState<string | null>(null);
  const [bugDraft, setBugLabels] = useState<string | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const [serverConfigCode, setServerConfigCode] =
    useState<GitHubConfigErrorCode | null>(null);
  const { ownerRepo, tokenSet, loading: configLoading, error: configError, refresh: refreshConfig } =
    useGitHubConfig(projectId);
  const mappingErrorMessage = useCallback(() => t("mapping.loadFailed"), [t]);
  const mapping = usePolledResource<LabelMapping>(
    `/api/projects/${projectId}/github/label-mapping`, null, mappingErrorMessage,
    { validateData: isLabelMapping },
  );
  const featureLabels = featureDraft ?? mapping.data?.featureLabels.join(", ") ?? "";
  const bugLabels = bugDraft ?? mapping.data?.bugLabels.join(", ") ?? "";
  const operationPending = useRef(false);
  const mappingPending = useRef(false);

  // Derived from the project/settings reads the page already makes, so the
  // unconfigured case never has to be discovered by firing a request that
  // cannot succeed.
  const clientConfigCode: GitHubConfigErrorCode | null = configLoading || configError
    ? null
    : !ownerRepo
      ? "GITHUB_REPO_NOT_CONFIGURED"
      : !tokenSet
        ? "GITHUB_PAT_NOT_CONFIGURED"
        : null;
  // The server stays authoritative: it can disagree with the reads above when
  // the configuration changes mid-session.
  const configCode = clientConfigCode ?? serverConfigCode;

  // The page used to own its own stack: an id scheme, a flat 4 s expiry that
  // ran even on a failure the user had not read yet, and a bottom-right box
  // with no dismiss button and no role. `useToastStack` keeps the list, and
  // `ToastStack` owns the expiry, the pause on hover and focus, the ceiling and
  // the portal.
  const { toasts, raise: showToast, dismiss: dismissToast } = useToastStack();

  const issuesUrl = useMemo(() => {
    const query = new URLSearchParams();
    if (labelFilter.trim()) query.set("label", labelFilter.trim());
    if (milestoneFilter.trim()) query.set("milestone", milestoneFilter.trim());
    return `/api/projects/${projectId}/github/issues/triage?${query.toString()}`;
  }, [projectId, labelFilter, milestoneFilter]);
  const activeIssuesUrl = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  const canLoadIssues = !configLoading && !configError && !clientConfigCode;
  const loading = configLoading || (canLoadIssues && (loadingIssues || settledUrl !== issuesUrl));
  const readIssues = useCallback(() => {
    if (activeIssuesUrl.current !== issuesUrl) return Promise.resolve();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    return requestJson<GitHubIssueRow[]>(issuesUrl, {
      signal, errorMessage: t("list.loadFailed"), validateData: Array.isArray,
    }).then((result) => {
      if (signal.aborted) return;
      setLoading(false);
      setSettledUrl(issuesUrl);
      if (result.error !== null) {
        const code = asConfigErrorCode(result.code);
        setServerConfigCode(code);
        setError(code ? null : result.error);
      } else {
        setServerConfigCode(null);
        setError(null);
        setIssues(result.data);
        setLoadedUrl(issuesUrl);
      }
    });
  }, [issuesUrl, t]);
  const loadIssues = useCallback(() => {
    if (activeIssuesUrl.current !== issuesUrl) return Promise.resolve();
    setLoading(true);
    setError(null);
    return readIssues();
  }, [issuesUrl, readIssues]);
  const latestLoadIssues = useRef(loadIssues);
  useEffect(() => { latestLoadIssues.current = loadIssues; }, [loadIssues]);

  useEffect(() => {
    activeIssuesUrl.current = canLoadIssues ? issuesUrl : null;
    if (canLoadIssues) void readIssues();
    return () => {
      activeIssuesUrl.current = null;
      request.current?.abort();
    };
  }, [canLoadIssues, readIssues, issuesUrl]);

  async function saveMappingConfig() {
    if (mappingPending.current || !mapping.data) return;
    mappingPending.current = true;
    setSavingMapping(true);
    const result = await requestJson<LabelMapping>(`/api/projects/${projectId}/github/label-mapping`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        featureLabels: featureLabels.split(",").map((value) => value.trim()).filter(Boolean),
        bugLabels: bugLabels.split(",").map((value) => value.trim()).filter(Boolean),
      }),
      errorMessage: t("mapping.saveFailed"), validateData: isLabelMapping,
    });
    mappingPending.current = false;
    setSavingMapping(false);
    if (result.error !== null) showToast("error", result.error);
    else {
      mapping.updateData(result.data);
      showToast("success", t("mapping.savedToast"));
    }
  }

  async function syncNow() {
    if (operationPending.current || configLoading || configError || configCode) return;
    operationPending.current = true;
    setSyncing(true);
    const result = await requestJson(`/api/projects/${projectId}/github/issues/sync`, {
      method: "POST", errorMessage: t("sync.failed"),
    });
    if (result.error !== null) {
      const code = asConfigErrorCode(result.code);
      if (code) setServerConfigCode(code);
      else showToast("error", result.error);
    } else {
      setServerConfigCode(null);
      await latestLoadIssues.current();
      showToast("success", t("sync.done"));
    }
    operationPending.current = false;
    setSyncing(false);
  }

  async function importSelected() {
    if (selected.size === 0 || operationPending.current || configLoading || configError || configCode) return;
    const submitted = new Set(selected);
    operationPending.current = true;
    setImporting(true);
    setError(null);
    const result = await requestJson<{ imported: unknown[] }>(`/api/projects/${projectId}/github/issues/import`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueNumbers: Array.from(submitted) }), errorMessage: t("import.failed"),
    });
    if (result.error !== null) {
      setError(result.error);
      showToast("error", result.error);
    } else {
      setSelected((current) => new Set([...current].filter((id) => !submitted.has(id))));
      await latestLoadIssues.current();
      showToast("success", t("import.done", { count: Array.isArray(result.data.imported) ? result.data.imported.length : submitted.size }));
    }
    operationPending.current = false;
    setImporting(false);
  }

  const visible = canLoadIssues && loadedUrl === issuesUrl ? issues : [];
  const notImported = visible.filter((issue) => !issue.importedEpicId).length;

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
            onClick={syncNow}
            disabled={syncing || importing || configLoading || configError || Boolean(configCode)}
          >
            {syncing ? (
              <Loader2 className="h-[14px] w-[14px] animate-spin" />
            ) : (
              <RefreshCw className="h-[14px] w-[14px]" />
            )}
            {t("header.sync")}
          </PillButton>
          <PillButton
            variant="filled"
            size="md"
            onClick={importSelected}
            disabled={importing || syncing || configLoading || configError || Boolean(configCode) || selected.size === 0}
          >
            {importing ? (
              <Loader2 className="h-[14px] w-[14px] animate-spin" />
            ) : (
              <Download className="h-[14px] w-[14px]" />
            )}
            {t("header.importSelected", { count: selected.size })}
          </PillButton>
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-[10px] px-[26px] pb-[16px]">
        <span className="inline-flex items-center gap-[8px] text-[12.5px] text-muted-foreground">
          <Github className="h-[14px] w-[14px]" />
          {ownerRepo || (configLoading || configError ? "—" : t("filters.notConnected"))}
        </span>
        <span className="h-4 w-px bg-border" />
        <Input
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
          placeholder={t("filters.label")}
          aria-label={t("filters.label")}
          className="h-[26px] w-[160px] rounded-full px-[11px] text-[12.5px]"
        />
        <Input
          value={milestoneFilter}
          onChange={(e) => setMilestoneFilter(e.target.value)}
          placeholder={t("filters.milestone")}
          aria-label={t("filters.milestone")}
          className="h-[26px] w-[160px] rounded-full px-[11px] font-mono text-[12px]"
        />
        <span className="ml-auto text-[12.5px] text-muted-foreground">
          {t("filters.summary", { count: visible.length, notImported })}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-[22px] px-[26px] pb-[26px]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border bg-card">
          <div
            className={cn(
              "grid flex-none gap-[14px] border-b border-border px-[22px] py-[12px]",
              GRID
            )}
          >
            <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
              #
            </span>
            <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
              {t("columns.title")}
            </span>
            <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
              {t("columns.labels")}
            </span>
            <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
              {t("columns.milestone")}
            </span>
            <span />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {configError ? (
              <div role="alert" className="flex items-center gap-3 px-[22px] py-[14px] text-sm text-destructive">
                {t("config.readFailed")}
                <PillButton variant="outline" size="sm" onClick={refreshConfig}>{t("list.retry")}</PillButton>
              </div>
            ) : configCode ? (
              <div className="flex flex-col items-center gap-[8px] px-[22px] py-[44px] text-center">
                <Github className="h-[20px] w-[20px] text-meta" />
                <p className="text-[13.5px] font-medium">
                  {tKey(CONFIG_EMPTY_STATE[configCode].titleKey)}
                </p>
                <p className="max-w-[420px] text-[12.5px] leading-[1.5] text-muted-foreground">
                  {tKey(CONFIG_EMPTY_STATE[configCode].detailKey)}
                </p>
              </div>
            ) : (
              <>
                {error && (
                  <p role="alert" className="px-[22px] py-[14px] text-[13px] text-destructive">
                    {error}
                    <PillButton variant="outline" size="sm" className="ml-3" onClick={loadIssues}>{t("list.retry")}</PillButton>
                  </p>
                )}
                {loading || configLoading ? (
                  <p className="px-[22px] py-[14px] text-[13px] text-muted-foreground">
                    {t("list.loading")}
                  </p>
                ) : error && visible.length === 0 ? null : visible.length === 0 ? (
                  <p className="px-[22px] py-[14px] text-[13px] text-muted-foreground">
                    {t("list.empty")}
                  </p>
                ) : (
                  visible.map((issue) => {
                    const checked = selected.has(issue.issueNumber);
                    const imported = Boolean(issue.importedEpicId);
                    return (
                      <div
                        key={issue.id}
                        className={cn(
                          "grid items-center gap-[14px] border-b border-border-soft px-[22px] py-[14px] transition-colors hover:bg-band",
                          GRID
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-[6px]">
                          <Checkbox
                            checked={checked}
                            aria-label={t("list.select", {
                              number: issue.issueNumber,
                            })}
                            onCheckedChange={(value) => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (value) next.add(issue.issueNumber);
                                else next.delete(issue.issueNumber);
                                return next;
                              });
                            }}
                            disabled={imported}
                          />
                          <span className="truncate font-mono text-[11.5px] text-meta">
                            #{issue.issueNumber}
                          </span>
                        </span>
                        <a
                          href={issue.githubUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-[13.5px] leading-[1.4] hover:underline"
                        >
                          {issue.title}
                        </a>
                        <span className="flex flex-wrap gap-[6px]">
                          {issue.labels.map((label) => (
                            <span
                              key={label}
                              className="rounded-full bg-band px-[8px] py-[2px] text-[11px] text-muted-foreground"
                            >
                              {label}
                            </span>
                          ))}
                        </span>
                        <span className="truncate font-mono text-[11.5px] text-meta">
                          {issue.milestone || ""}
                        </span>
                        <span
                          className={cn(
                            "justify-self-end text-[12px]",
                            imported ? "text-agent" : "text-primary"
                          )}
                        >
                          {imported ? t("list.imported") : t("list.toImport")}
                        </span>
                      </div>
                    );
                  })
                )}
              </>
            )}
          </div>
        </div>

        <aside className="hidden w-[330px] flex-none flex-col gap-[16px] lg:flex">
          <div className="flex flex-col gap-[12px] rounded-[12px] border border-border p-[18px]">
            <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
              {t("mapping.title")}
            </span>
            <div className="flex flex-col gap-[6px]">
              <label
                htmlFor="label-mapping-feature"
                className="text-[12.5px] text-muted-foreground"
              >
                {t("mapping.feature")}
              </label>
              {/*
                The two placeholders are SAMPLE label names, authored here
                rather than read from the repository — so they are copy, and a
                team whose labels are French should see French examples. The
                labels the rows actually draw stay values, never keys.
              */}
              <Input
                id="label-mapping-feature"
                disabled={!mapping.data}
                value={featureLabels}
                onChange={(e) => setFeatureLabels(e.target.value)}
                placeholder={t("mapping.featurePlaceholder")}
                className="h-[34px] rounded-[8px] font-mono text-[12.5px]"
                aria-describedby="label-mapping-hint"
              />
            </div>
            <div className="flex flex-col gap-[6px]">
              <label
                htmlFor="label-mapping-bug"
                className="text-[12.5px] text-muted-foreground"
              >
                {t("mapping.bug")}
              </label>
              <Input
                id="label-mapping-bug"
                disabled={!mapping.data}
                value={bugLabels}
                onChange={(e) => setBugLabels(e.target.value)}
                placeholder={t("mapping.bugPlaceholder")}
                className="h-[34px] rounded-[8px] font-mono text-[12.5px]"
                aria-describedby="label-mapping-hint"
              />
            </div>
            <p
              id="label-mapping-hint"
              className="text-[12.5px] leading-[1.5] text-muted-foreground"
            >
              {t("mapping.hint")}
            </p>
            {mapping.error && <div role="alert" className="text-sm text-destructive">
              {mapping.error}
              <PillButton variant="outline" size="sm" className="mt-2" onClick={() => void mapping.refresh()}>{t("list.retry")}</PillButton>
            </div>}
            <PillButton
              variant="outline"
              size="md"
              className="w-fit"
              onClick={saveMappingConfig}
              disabled={savingMapping || !mapping.data}
            >
              {savingMapping ? (
                <Loader2 className="h-[13px] w-[13px] animate-spin" />
              ) : null}
              {t("mapping.save")}
            </PillButton>
          </div>
        </aside>
      </div>

      <ToastStack
        items={toasts}
        onDismiss={dismissToast}
        testId="github-issues-toast"
      />
    </div>
  );
}
