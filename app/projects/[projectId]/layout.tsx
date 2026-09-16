"use client";

import { GitHubConnectBanner } from "@/components/github/GitHubConnectBanner";
import { PillButton, pillButtonVariants } from "@/components/piscine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjects } from "@/hooks/useProjects";
import { requestJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  Bug,
  ChevronDown,
  MessageSquare,
  Moon,
  PencilLine,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";


export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const projectId = params.projectId as string;
  // Layouts survive client navigation: remount all project-owned state when
  // its identity changes, including drafts in nested legacy screens.
  return <ProjectShell key={projectId} projectId={projectId}>{children}</ProjectShell>;
}

function ProjectShell({ projectId, children }: {
  projectId: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("ProjectShell");
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { allProjects, refresh: loadSummary, loading } = useProjects();
  const found = allProjects.find((project) => project.id === projectId);
  if (!loading && allProjects.length > 0 && !found) {
    notFound();
  }
  const projectSummary = found ?? { gitRepoPath: null, githubOwnerRepo: null };
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncPending = useRef(false);
  const lifecycle = useRef(0);

  useEffect(() => {
    lifecycle.current += 1;
    return () => { lifecycle.current += 1; };
  }, []);

  const syncFromJson = useCallback(async () => {
    if (syncPending.current) return;
    syncPending.current = true;
    const lifetime = lifecycle.current;
    setSyncing(true);
    setSyncError(null);
    const result = await requestJson(`/api/projects/${projectId}/sync`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import" }), errorMessage: t("actions.syncFailed"),
    });
    if (lifetime === lifecycle.current) {
      if (result.error) setSyncError(result.error);
      else {
        await loadSummary();
        if (lifetime === lifecycle.current) {
          window.dispatchEvent(new CustomEvent("arji:synced", { detail: { projectId } }));
        }
      }
    }
    syncPending.current = false;
    if (lifetime === lifecycle.current) setSyncing(false);
  }, [projectId, loadSummary, t]);

  const boardHref = `/projects/${projectId}`;
  const isBoard = pathname === boardHref;

  /**
   * Header actions never reach into the board's imperative handles: they set
   * a URL param the board page already knows how to consume.
   */
  const openBoardPanel = (query: string) => router.push(`${boardHref}?${query}`);

  return (
    <div className="flex h-full flex-col">
      <GitHubConnectBanner
        projectId={projectId}
        gitRepoPath={projectSummary.gitRepoPath}
        githubOwnerRepo={projectSummary.githubOwnerRepo}
        onConnected={() => { void loadSummary(); }}
      />

      {isBoard && (
        // A row that folds, with 38px as its floor rather than its height
        // (B-arij-jcJeNQZnT1X9). Its three pills fit a 320px screen today
        // (~243px in 292px of content); the fold is there so that a fourth
        // control cannot repeat the capture bar's defect one row up — a fixed
        // single line clips whatever it cannot hold. One line on a desktop,
        // at exactly the height it has always had.
        <div
          data-testid="project-action-row"
          className="flex min-h-[38px] shrink-0 flex-wrap items-center gap-[8px] px-[14px] py-[4px]"
        >
          <DropdownMenu>
            {/*
              The pill recipe on the trigger itself: Radix's trigger IS the
              button, so nesting a PillButton inside it would ship a button in
              a button.
            */}
            <DropdownMenuTrigger
              data-testid="header-new-button"
              className={pillButtonVariants({ variant: "filled", size: "md" })}
            >
              <Plus size={13} aria-hidden="true" />
              {t("actions.new")}
              <ChevronDown size={12} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[228px]">
              {/*
                Two epic paths, named for what they cost: the form is instant
                and agent-free, the chat is the brainstorming round-trip. The
                manual entry comes first because it is the cheaper default.
              */}
              <DropdownMenuItem
                data-testid="header-new-epic-manual"
                onSelect={() => openBoardPanel("panel=new-epic-manual")}
                className="text-[13px]"
              >
                <PencilLine className="w-[13px] h-[13px]" />
                {t("actions.newEpicManual")}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="header-new-epic-chat"
                onSelect={() => openBoardPanel("panel=new-epic")}
                className="text-[13px]"
              >
                <MessageSquare className="w-[13px] h-[13px]" />
                {t("actions.newEpicChat")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="header-new-bug"
                onSelect={() => openBoardPanel("panel=new-bug")}
                className="text-[13px]"
              >
                <Bug className="w-[13px] h-[13px]" />
                {t("actions.newBug")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <PillButton
            variant="outline"
            outlineTone="neutral"
            size="md"
            icon={Moon}
            data-testid="night-run-button"
            onClick={() => openBoardPanel("night=start")}
          >
            {t("actions.nightRun")}
          </PillButton>

          {projectSummary.gitRepoPath && (
            <PillButton
              variant="outline"
              outlineTone="neutral"
              size="md"
              iconOnly
              icon={RefreshCw}
              onClick={syncFromJson}
              disabled={syncing}
              title={t("actions.syncTitle")}
              className={cn(
                syncing &&
                  "[&_svg]:animate-spin motion-reduce:[&_svg]:animate-none",
              )}
            >
              {t("actions.sync")}
            </PillButton>
          )}
        </div>
      )}

      {syncError && <p role="alert" className="px-[14px] py-2 text-sm text-destructive">{syncError}</p>}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
