"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { GitMerge, RefreshCw } from "lucide-react";

import { BandHeader, Mono, PillButton, StrataBand } from "@/components/piscine";
import { PrBadge } from "@/components/github/PrBadge";
import { useGitHubConfig } from "@/hooks/useGitHubConfig";
import { useGitStatus } from "@/hooks/useGitStatus";
import { useWorktrees } from "@/hooks/useWorktrees";
import { usePolledResource } from "@/hooks/usePolledResource";
import { formatRelative } from "@/lib/i18n/format";

/**
 * Repository state, on Git Sync.
 *
 * This is `components/layout/RepoStatusBar` — the pre-redesign `bg-sidebar`
 * footer that used to hang under the project board — rebuilt as a stratum.
 * Its content had no other home: ahead/behind against the project's STORED
 * default branch (not whatever branch is checked out), the worktree count, the
 * open-PR pills, and the fetch/push pair.
 *
 * MISSING CONFIGURATION IS NOT AN ERROR. The old bar returned null when the
 * project had no local repository, which on a dedicated Git page reads as a
 * broken screen. It now names the missing piece instead — and the PAT gates
 * only the PR pills, exactly as before: ahead/behind, worktrees, fetch and
 * push are plain local git and must not vanish with the token.
 */

type PrStatus = "draft" | "open" | "closed" | "merged";

interface OpenPr {
  id: string;
  number: number;
  url: string;
  status: string;
}

const NO_PRS: OpenPr[] = [];
const isPrList = (value: unknown): value is OpenPr[] => Array.isArray(value);

export interface RepoStrataBandProps {
  projectId: string;
  /** From the project record; may be null. */
  ownerRepo: string | null;
  /** Local repository path from the project record; may be null. */
  gitRepoPath: string | null;
  /** Stored default branch, captured at GitHub import. "main" is the legacy
   *  fallback for rows that predate the column. */
  defaultBranch?: string | null;
  snapshot?: {
    branch: string;
    ahead: number; behind: number; lastFetchedAt: number | null;
    loading: boolean; error: string | null; refresh: () => void;
    push: () => void; pushing: boolean;
    worktreeCount: number | null; refreshWorktrees: () => void;
  };
}

export function RepoStrataBand({
  projectId,
  ownerRepo,
  gitRepoPath,
  defaultBranch,
  snapshot,
}: RepoStrataBandProps) {
  const locale = useLocale();
  const t = useTranslations("Github");
  const config = useGitHubConfig(projectId);
  const repo = ownerRepo ?? config.ownerRepo;
  const enabled = Boolean(gitRepoPath);
  const prsEnabled = enabled && config.isConfigured;
  const branch = snapshot?.branch || defaultBranch || "main";

  const fetched = useGitStatus(projectId, branch, enabled && !snapshot);
  const { ahead, behind, lastFetchedAt, loading, error, refresh, push, pushing } = snapshot ?? fetched;

  // Count only — the list and the cleanup action are the panel beside this
  // band. Null while unknown: a "0 worktrees" we cannot vouch for would be
  // worse than no counter.
  const worktrees = useWorktrees(projectId, enabled && !snapshot);
  const worktreeCount = snapshot ? snapshot.worktreeCount : worktrees.count;
  const refreshWorktrees = snapshot ? snapshot.refreshWorktrees : worktrees.refresh;

  const prErrorMessage = useCallback(() => t("repo.prsFailed"), [t]);
  const { data: prData, error: prsError, refresh: refreshPrs } = usePolledResource<OpenPr[]>(
    prsEnabled ? `/api/projects/${projectId}/prs` : null,
    null, prErrorMessage, { validateData: isPrList },
  );
  const prs = prData ?? NO_PRS;

  /* ---- no local repository: name what is missing ------------------- */

  if (!enabled) {
    return (
      <StrataBand stratum="feed" density="full" gap={8}>
        <BandHeader
          label={t("repo.label")}
          stratum="feed"
          meta={t("repo.notConnected")}
        />
        <p
          data-testid="repo-not-configured"
          className="font-sans text-[13px] leading-[1.55] text-muted-foreground"
        >
          {t("repo.noRepository")}
        </p>
      </StrataBand>
    );
  }

  const fetchedLabel = lastFetchedAt
    ? t("repo.fetched", { age: formatRelative(lastFetchedAt, { locale }) })
    : t("repo.neverFetched");

  return (
    <StrataBand stratum="feed" density="full" gap={10}>
      <BandHeader
        label={t("repo.label")}
        stratum="feed"
        meta={
          repo ?? gitRepoPath?.split("/").filter(Boolean).pop() ?? t("repo.localRepo")
        }
        right={
          <div className="flex items-center gap-2">
            <PillButton
              variant="outline"
              outlineTone="neutral"
              size="sm"
              icon={RefreshCw}
              data-testid="repo-fetch-button"
              disabled={loading}
              onClick={() => {
                refresh();
                void refreshPrs();
                void refreshWorktrees();
              }}
            >
              {t("repo.fetch")}
            </PillButton>
            <PillButton
              variant="filled"
              size="sm"
              icon={GitMerge}
              data-testid="repo-push-button"
              disabled={pushing || loading || Boolean(error) || ahead === 0}
              onClick={() => void push()}
            >
              {t("repo.push", { branch })}
            </PillButton>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-[14px] gap-y-2">
        {error ? (
          // Counters refer to the snapshot branch or the stored default branch;
          // when it cannot (branch missing locally, git unreadable) it says
          // why, rather than showing a stale zero-count.
          <span data-testid="repo-status-error" className="min-w-0">
            <Mono size={11.5} tone="danger" clamp={1}>
              {error}
            </Mono>
          </span>
        ) : (
          <>
            <Mono size={11.5} tone="muted">{`${branch} · ${fetchedLabel}`}</Mono>
            <span data-testid="repo-ahead">
              {/* The arrow is frame furniture and stays inline; only the
                  words resolve from the catalogue. */}
              <Mono size={11.5} tone="feed-deep">{`↑ ${t("repo.ahead", { count: ahead })}`}</Mono>
            </span>
            <span data-testid="repo-behind">
              <Mono size={11.5} tone="feed-deep">{`↓ ${t("repo.behind", { count: behind })}`}</Mono>
            </span>
            {worktreeCount !== null ? (
              <span data-testid="repo-worktrees">
                <Mono size={11.5} tone="muted">
                  {t("repo.worktrees", { count: worktreeCount })}
                </Mono>
              </span>
            ) : null}
          </>
        )}

        {prs.length > 0 ? (
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            {prs.map((pr) => (
              <PrBadge
                key={pr.id}
                status={pr.status as PrStatus}
                number={pr.number}
                url={pr.url}
              />
            ))}
          </div>
        ) : null}
        {prsError && <p role="alert" className="text-sm text-muted-foreground">{prsError}</p>}
      </div>
    </StrataBand>
  );
}
