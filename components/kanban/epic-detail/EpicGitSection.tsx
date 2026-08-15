"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitSyncBadge } from "@/components/kanban/GitSyncBadge";
import { PrBadge } from "@/components/github/PrBadge";
import {
  Loader2,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Wrench,
  ArrowUp,
  ArrowDown,
  Upload,
  RefreshCw,
} from "lucide-react";

interface EpicGitSectionProps {
  projectId: string;
  branchName: string;
  epicStatus: string;
  githubConfigured: boolean;
  isRunning: boolean;
  ahead: number;
  behind: number;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  onRefreshGitStatus: () => void;
  onPush: () => void;
  pushing: boolean;
  pr: {
    status: "draft" | "open" | "closed" | "merged";
    number: number;
    url: string;
  } | null;
  prLoading: boolean;
  prError: string | null;
  onCreatePr: () => void;
  onSyncPr: () => void;
  merging: boolean;
  mergeError: string | null;
  onMerge: () => void;
  resolvingMerge: boolean;
  onOpenResolveMerge: () => void;
}

/**
 * Branch / git-sync / PR / merge UI for an epic. Pure presentation — all
 * fetch state is owned by hooks in the parent and passed down as props.
 */
export function EpicGitSection({
  projectId,
  branchName,
  epicStatus,
  githubConfigured,
  isRunning,
  ahead,
  behind,
  gitStatusLoading,
  gitStatusError,
  onRefreshGitStatus,
  onPush,
  pushing,
  pr,
  prLoading,
  prError,
  onCreatePr,
  onSyncPr,
  merging,
  mergeError,
  onMerge,
  resolvingMerge,
  onOpenResolveMerge,
}: EpicGitSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
        <GitBranch className="h-3 w-3" />
        <span className="flex-1 truncate">{branchName}</span>
        {githubConfigured && (
          <GitSyncBadge
            projectId={projectId}
            branchName={branchName}
            disabled={isRunning}
          />
        )}
      </div>

      {/* Git sync status — only shown when GitHub is configured */}
      {githubConfigured && (
        <div className="flex items-center gap-2 flex-wrap">
          {gitStatusLoading ? (
            <Badge variant="outline" className="gap-1 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking...
            </Badge>
          ) : (
            <>
              <Badge variant="outline" className="gap-1 text-xs">
                <ArrowUp className="h-3 w-3" />
                {ahead}
              </Badge>
              <Badge variant="outline" className="gap-1 text-xs">
                <ArrowDown className="h-3 w-3" />
                {behind}
              </Badge>
            </>
          )}

          {gitStatusError && (
            <span className="text-xs text-destructive">{gitStatusError}</span>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={onRefreshGitStatus}
            disabled={gitStatusLoading}
            className="h-6 w-6 p-0"
          >
            <RefreshCw className={`h-3 w-3 ${gitStatusLoading ? "animate-spin" : ""}`} />
          </Button>

          {ahead > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={onPush}
              disabled={pushing || gitStatusLoading}
              className="h-7 text-xs"
            >
              {pushing ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Upload className="h-3 w-3 mr-1" />
              )}
              Push
            </Button>
          )}
        </div>
      )}

      {/* PR Section */}
      {githubConfigured && (
        <div className="space-y-2">
          {pr ? (
            <div className="flex items-center gap-2 flex-wrap">
              <PrBadge
                status={pr.status}
                number={pr.number}
                url={pr.url}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={onSyncPr}
                disabled={prLoading}
                className="h-6 text-xs px-2"
              >
                {prLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                <span className="ml-1">Sync</span>
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onCreatePr}
              disabled={prLoading}
              className="h-7 text-xs"
            >
              {prLoading ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <GitPullRequest className="h-3 w-3 mr-1" />
              )}
              Create PR
            </Button>
          )}
          {prError && (
            <p className="text-xs text-destructive">{prError}</p>
          )}
        </div>
      )}

      {(epicStatus === "review" || epicStatus === "done") && (
        <Button
          size="sm"
          variant="outline"
          onClick={onMerge}
          disabled={merging}
          className="h-7 text-xs"
        >
          {merging ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <GitMerge className="h-3 w-3 mr-1" />
          )}
          Merge into main
        </Button>
      )}
      {mergeError && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-destructive flex-1">{mergeError}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenResolveMerge}
            disabled={resolvingMerge || isRunning}
            className="h-7 text-xs shrink-0"
          >
            {resolvingMerge ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Wrench className="h-3 w-3 mr-1" />
            )}
            Resolve with Agent
          </Button>
        </div>
      )}
    </div>
  );
}
