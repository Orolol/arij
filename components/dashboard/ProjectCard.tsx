"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { DashboardProject } from "@/lib/types/dashboard";

interface ProjectCardProps {
  project: DashboardProject;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const progress =
    project.epicCount > 0
      ? Math.round((project.epicsDone / project.epicCount) * 100)
      : 0;

  function relativeTime(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="p-4 hover:bg-accent/50 transition-colors cursor-pointer h-full">
        <h3 className="font-semibold mb-1 truncate">{project.name}</h3>
        {project.description && (
          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
            {project.description}
          </p>
        )}
        <div className="mt-auto space-y-2">
          <div className="flex items-center gap-2">
            <Progress value={progress} className="flex-1 h-1.5" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {project.epicsDone}/{project.epicCount}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              {project.activeAgents > 0 ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  <span>{project.activeAgents} agent{project.activeAgents > 1 ? "s" : ""}</span>
                </>
              ) : (
                <span>{project.status}</span>
              )}
            </div>
            <span>{relativeTime(project.updatedAt)}</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
