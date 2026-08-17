"use client";

import Link from "next/link";
import { AlertCircle, FolderDown, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/hooks/useProjects";
import { useInbox } from "@/hooks/useInbox";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";
import { PROVIDER_LABELS, isAgentProvider } from "@/lib/agent-config/constants";
import { formatElapsed } from "@/lib/utils/format-elapsed";
import { cn } from "@/lib/utils";
import type { ProjectFilter } from "@/lib/types/dashboard";
import { NewProjectCard, ProjectCard } from "./ProjectCard";

const FILTERS: { value: ProjectFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

function providerLabel(provider: string | null): string {
  if (!provider) return "Agent";
  return isAgentProvider(provider) ? PROVIDER_LABELS[provider] : provider;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function BandCell({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col justify-center gap-[5px] px-[22px]",
        !last && "border-r border-border"
      )}
    >
      <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
        {label}
      </span>
      <span className="text-[13.5px]">{value}</span>
    </div>
  );
}

export function ProjectGrid() {
  const { projects, loading, error, filter, setFilter, refresh } = useProjects();
  const { items: inboxItems } = useInbox();
  const { runningSessions, nightRunsLastNight, yesterday } = useDashboardSummary();

  const awaiting = inboxItems.filter((item) => item.awaitingReply);
  const withAgents = projects.filter((p) => p.activeAgents > 0).length;

  return (
    <div data-testid="project-grid" className="flex h-full min-h-0 flex-col">
      <header className="flex h-[54px] flex-none items-center gap-[18px] border-b border-border px-[22px]">
        <h1 className="text-[19px] font-semibold tracking-[-0.01em]">
          All projects
        </h1>
        <span className="text-[12.5px] text-muted-foreground">
          {plural(projects.length, "project")} · {withAgents} with active agents
        </span>
        <div className="flex items-center gap-[6px]">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full px-[11px] py-[3px] text-[12.5px] transition-colors",
                filter === f.value
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:bg-band"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-[9px]">
          <Link href="/projects/new">
            <Button className="h-[31px] rounded-[8px] px-[13px] text-[13px]">
              <Plus className="h-[14px] w-[14px]" />
              New Project
            </Button>
          </Link>
          <Link href="/projects/import">
            <Button
              variant="outline"
              className="h-[31px] rounded-[8px] px-[12px] text-[13px]"
            >
              <FolderDown className="h-[14px] w-[14px]" />
              Import
            </Button>
          </Link>
        </div>
      </header>

      <div
        data-testid="dashboard-band"
        className="flex h-[72px] flex-none border-b border-border bg-band"
      >
        <BandCell
          label="AGENTS WORKING"
          value={plural(runningSessions.length, "session")}
        />
        <BandCell
          label="AWAITING MY REPLY"
          value={plural(awaiting.length, "question")}
        />
        <BandCell
          label="NIGHT RUNS LAST NIGHT"
          value={`${plural(nightRunsLastNight.projects, "project")} · $${nightRunsLastNight.totalCostUsd.toFixed(2)}`}
        />
        <BandCell label="DONE YESTERDAY" value={`${yesterday.completed}`} last />
      </div>

      <div className="flex min-h-0 flex-1 gap-[22px] overflow-hidden px-[22px] py-[24px]">
        <div className="min-w-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-wrap content-start gap-[18px]">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-[150px] w-[334px] max-w-full animate-pulse rounded-[13px] border border-border bg-card motion-reduce:animate-none"
                />
              ))}
            </div>
          ) : error ? (
            <div className="py-16 text-center">
              <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
              <p className="mb-4 text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw className="mr-1 h-4 w-4" />
                Retry
              </Button>
            </div>
          ) : projects.length === 0 ? (
            <div className="py-16 text-center">
              <p className="mb-4 text-muted-foreground">No projects yet</p>
              <div className="flex justify-center gap-2">
                <Link href="/projects/import">
                  <Button variant="outline">
                    <FolderDown className="mr-1 h-4 w-4" />
                    Import Existing
                  </Button>
                </Link>
                <Link href="/projects/new">
                  <Button>
                    <Plus className="mr-1 h-4 w-4" />
                    Create New
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap content-start gap-[18px]">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
              <NewProjectCard />
            </div>
          )}
        </div>

        <aside className="hidden w-[400px] flex-none flex-col gap-[14px] overflow-y-auto rounded-[13px] border border-border bg-card p-[20px] lg:flex">
          <span
            data-testid="dashboard-awaiting"
            className="text-[11.5px] uppercase tracking-[.08em] text-meta"
          >
            AWAITING MY REPLY
          </span>
          {awaiting.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">All clear.</p>
          ) : (
            awaiting.map((item) => (
              <div
                key={item.epicId}
                className="flex flex-col gap-[6px] rounded-[11px] bg-band p-[14px]"
              >
                <div className="flex items-center gap-[8px]">
                  <span className="text-[12.5px] font-medium">
                    {item.projectName}
                  </span>
                  {item.readableId && (
                    <span className="font-mono text-[11px] text-meta">
                      {item.readableId}
                    </span>
                  )}
                </div>
                <span className="text-[13.5px] leading-[1.5] text-primary">
                  « {item.latestCommentExcerpt || item.title} »
                </span>
                <Link
                  href={`/projects/${item.projectId}?ticket=${item.epicId}`}
                  className="w-fit text-[12.5px] text-muted-foreground hover:text-foreground"
                >
                  Reply
                </Link>
              </div>
            ))
          )}

          <span
            data-testid="dashboard-running"
            className="mt-[6px] text-[11.5px] uppercase tracking-[.08em] text-meta"
          >
            RUNNING SESSIONS
          </span>
          {runningSessions.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">None right now.</p>
          ) : (
            <div className="flex flex-col">
              {runningSessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="flex items-center gap-[10px] border-t border-border-soft py-[9px]"
                >
                  <span
                    className="breathing-dot h-[7px] w-[7px] flex-none"
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px]">
                      {providerLabel(session.provider)}
                      {session.agentType ? ` · ${session.agentType}` : ""}
                      {session.epicReadableId
                        ? ` ${session.epicReadableId}`
                        : ""}
                    </span>
                    <span className="truncate font-mono text-[11px] text-meta">
                      {session.projectName || session.projectId}
                    </span>
                  </div>
                  {session.startedAt && (
                    <span className="flex-none font-mono text-[11.5px] text-muted-foreground">
                      {formatElapsed(session.startedAt)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
