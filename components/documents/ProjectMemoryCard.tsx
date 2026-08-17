"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Brain } from "lucide-react";
import { PROJECT_MEMORY_MAX_CHARS } from "@/lib/documents/memory-constants";

interface ProjectMemoryCardProps {
  projectId: string;
}

/**
 * Docs-tab editor for the learned project memory (documents row with
 * kind 'memory'). The content is injected into every agent prompt for the
 * project, so the card is deliberately explicit about that and about the
 * hard character cap.
 */
export function ProjectMemoryCard({ projectId }: ProjectMemoryCardProps) {
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/projects/${projectId}/memory`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setContent(data.data?.content ?? "");
        setUpdatedAt(data.data?.updatedAt ?? null);
        setDirty(false);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load project memory.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const overCap = content.length > PROJECT_MEMORY_MAX_CHARS;

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memory`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to save project memory.");
        return;
      }
      setUpdatedAt(data.data?.updatedAt ?? null);
      setDirty(false);
      setMessage("Project memory saved.");
    } catch {
      setError("Failed to save project memory.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium text-sm">Project memory</h3>
        </div>
        <span
          className={`text-xs ${overCap ? "text-destructive" : "text-muted-foreground"}`}
        >
          {content.length} / {PROJECT_MEMORY_MAX_CHARS}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        Conventions learned from previous sessions. Injected into every agent
        prompt for this project. Use the &quot;Distill learnings&quot; action on
        a completed session to let an agent update it.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground mt-3">Loading...</p>
      ) : (
        <>
          <Textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setDirty(true);
              setMessage(null);
            }}
            placeholder="No project memory yet. Write durable conventions here, or distill them from a completed session."
            className="mt-3 min-h-[160px] font-mono text-xs"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {updatedAt
                ? `Last updated ${new Date(updatedAt).toLocaleString()}`
                : "Never updated"}
            </span>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || overCap || !dirty}
            >
              {saving ? "Saving..." : "Save memory"}
            </Button>
          </div>
        </>
      )}
      {overCap && (
        <p className="text-xs text-destructive mt-2">
          Over the {PROJECT_MEMORY_MAX_CHARS}-character cap. Trim the content to
          save.
        </p>
      )}
      {message && <p className="text-xs text-green-500 mt-2">{message}</p>}
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  );
}
