"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils/format-date";
import type { DashboardProject } from "@/lib/types/dashboard";

interface ProjectCardProps {
  project: DashboardProject;
}

/** Two-letter chip: initials of the first two words, else first two letters. */
function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) {
    return (words[0].slice(0, 2) || "?").replace(/^./, (c) => c.toUpperCase());
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const inProgress = project.epicsInProgress ?? 0;
  const review = project.epicsReview ?? 0;
  const released = project.epicsReleased ?? 0;

  // Distribution bar: in-flight work as a share of everything that has a
  // delivery state. Pure CSS widths, no library, no invented numbers.
  const tracked = inProgress + review + released;
  const inProgressPct = tracked > 0 ? (inProgress / tracked) * 100 : 0;
  const reviewPct = tracked > 0 ? (review / tracked) * 100 : 0;

  const counters: Array<{ value: number; label: string }> = [
    { value: inProgress, label: "in progress" },
    { value: review, label: "in review" },
    { value: released, label: "released" },
  ];

  return (
    <Link
      href={`/projects/${project.id}`}
      data-testid={`project-card-${project.id}`}
      className="flex w-[334px] max-w-full flex-col gap-[14px] rounded-[13px] border border-border bg-card p-[18px] shadow-[0_1px_2px_rgba(36,33,29,.04)] transition-colors hover:border-ring/40"
    >
      <div className="flex items-center gap-[11px]">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-band text-[12.5px] font-semibold text-muted-foreground">
          {projectInitials(project.name)}
        </span>
        <span className="truncate text-[15px] font-semibold">
          {project.name}
        </span>
        {project.activeAgents > 0 ? (
          <span className="ml-auto inline-flex flex-none items-center gap-[7px] text-[12px] text-agent">
            <span className="breathing-dot h-[7px] w-[7px]" aria-hidden />
            {plural(project.activeAgents, "agent")}
          </span>
        ) : (
          <span className="ml-auto flex-none text-[12px] text-meta">idle</span>
        )}
      </div>

      <div className="flex gap-[14px]">
        {counters.map((counter) => (
          <div key={counter.label} className="flex flex-col gap-[2px]">
            <span className="text-[17px] font-semibold leading-none">
              {counter.value}
            </span>
            <span className="text-[11.5px] text-muted-foreground">
              {counter.label}
            </span>
          </div>
        ))}
      </div>

      <div className="flex h-[3px] overflow-hidden rounded-[2px] bg-border-soft">
        <span
          className="bg-agent"
          style={{ width: `${inProgressPct}%` }}
          aria-hidden
        />
        <span
          className="bg-primary"
          style={{ width: `${reviewPct}%` }}
          aria-hidden
        />
      </div>

      <span className="font-mono text-[11px] text-meta">
        {project.lastSessionAt
          ? `last session ${timeAgo(project.lastSessionAt)}`
          : "no sessions yet"}
      </span>
    </Link>
  );
}

/** Dashed call-to-action tile that closes the project grid. */
export function NewProjectCard() {
  return (
    <Link
      href="/projects/new"
      data-testid="project-card-new"
      className={cn(
        "flex w-[334px] max-w-full flex-col justify-center gap-[8px] rounded-[13px] border border-dashed border-border p-[18px]",
        "transition-colors hover:border-primary/60"
      )}
    >
      <span className="text-[14px] font-medium text-primary">New Project</span>
      <span className="text-[12.5px] text-muted-foreground">
        From a local repo or GitHub.
      </span>
    </Link>
  );
}
