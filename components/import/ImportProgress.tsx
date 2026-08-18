"use client";

import { Loader2 } from "lucide-react";

interface ImportProgressProps {
  /**
   * Which step is running. Cloning is a separate endpoint from analysis, so
   * the UI names the two honestly instead of showing one opaque spinner —
   * a full clone of a large repository takes minutes on its own.
   */
  step?: "cloning" | "analyzing";
  /** `owner/repo` being cloned, when known. */
  target?: string | null;
}

export function ImportProgress({
  step = "analyzing",
  target,
}: ImportProgressProps) {
  const cloning = step === "cloning";

  return (
    <div
      className="flex flex-col items-center justify-center py-16 gap-4"
      role="status"
      aria-live="polite"
      data-step={step}
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-lg font-medium">
        {cloning ? "Cloning repository..." : "Analyzing project..."}
      </p>
      <p className="text-sm text-muted-foreground">
        {cloning
          ? `Fetching ${target ?? "the repository"} with its full history`
          : "Claude Code is scanning the codebase and generating epics"}
      </p>
    </div>
  );
}
