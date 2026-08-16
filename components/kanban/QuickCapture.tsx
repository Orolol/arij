"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, Zap } from "lucide-react";

interface QuickCaptureProps {
  projectId: string;
  /** Called after the epic is created so the board can refresh */
  onCreated?: () => void;
  onError?: (message: string) => void;
}

/**
 * Compact one-line idea capture for the kanban header: type a title, press
 * Enter, and a draft feature epic lands in the backlog — no dialog, no LLM.
 */
export function QuickCapture({ projectId, onCreated, onError }: QuickCaptureProps) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/epics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          status: "backlog",
          type: "feature",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        // Keep the typed title so the user can retry without re-typing
        onError?.(data.error || "Failed to capture idea");
      } else {
        setTitle("");
        onCreated?.();
      }
    } catch {
      onError?.("Failed to capture idea");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex items-center">
      {submitting ? (
        <Loader2 className="absolute left-2 h-3 w-3 animate-spin text-muted-foreground pointer-events-none" />
      ) : (
        <Zap className="absolute left-2 h-3 w-3 text-muted-foreground pointer-events-none" />
      )}
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        placeholder="Quick capture — Enter adds to Backlog"
        disabled={submitting}
        className="h-7 w-64 pl-7 text-xs"
        aria-label="Quick capture idea"
        data-testid="quick-capture-input"
      />
    </div>
  );
}
