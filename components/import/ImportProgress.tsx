"use client";

import { Loader2 } from "lucide-react";

export function ImportProgress() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-lg font-medium">Analyzing project...</p>
      <p className="text-sm text-muted-foreground">
        Claude Code is scanning the codebase and generating epics
      </p>
    </div>
  );
}
