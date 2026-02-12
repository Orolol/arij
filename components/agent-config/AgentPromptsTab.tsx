"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, ChevronRight, X, Check } from "lucide-react";
import type { AgentPromptEntry } from "@/hooks/useAgentConfig";
import type { AgentType } from "@/lib/types/agent-config";

interface AgentPromptsTabProps {
  prompts: AgentPromptEntry[];
  loading: boolean;
  projectId?: string;
  onSave: (agentType: AgentType, systemPrompt: string) => Promise<void>;
  onDeleteProjectOverride: (agentType: AgentType) => Promise<void>;
}

export function AgentPromptsTab({
  prompts,
  loading,
  projectId,
  onSave,
  onDeleteProjectOverride,
}: AgentPromptsTabProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const toggleExpand = (agentType: string) => {
    setExpanded((prev) => (prev === agentType ? null : agentType));
  };

  const handleSave = async (agentType: AgentType) => {
    const draft = drafts[agentType];
    if (!draft || draft.trim().length === 0) return;

    setSaving(agentType);
    try {
      await onSave(agentType, draft.trim());
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[agentType];
        return next;
      });
    } catch {
      // error handled by parent
    } finally {
      setSaving(null);
    }
  };

  const handleReset = async (agentType: AgentType) => {
    if (!projectId) return;
    setSaving(agentType);
    try {
      await onDeleteProjectOverride(agentType);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-1 pt-2">
      <p className="text-xs text-muted-foreground mb-3">
        Customize the system prompt injected into each agent type.
        {projectId && " Project overrides take precedence over global prompts."}
      </p>

      {prompts.map((entry) => {
        const isExpanded = expanded === entry.agentType;
        const draft = drafts[entry.agentType];
        const currentValue = draft ?? entry.systemPrompt ?? "";
        const hasChanges = draft !== undefined && draft !== (entry.systemPrompt ?? "");
        const isSaving = saving === entry.agentType;

        return (
          <div
            key={entry.agentType}
            className="border border-border rounded-md"
          >
            <button
              onClick={() => toggleExpand(entry.agentType)}
              className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors rounded-md"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-medium flex-1">
                {entry.label}
              </span>
              {entry.source === "project" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Project
                </Badge>
              )}
              {entry.isCustom && entry.source !== "project" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  Custom
                </Badge>
              )}
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 space-y-2">
                <Textarea
                  value={currentValue}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [entry.agentType]: e.target.value,
                    }))
                  }
                  placeholder="Enter custom system prompt... Leave empty to use built-in default."
                  className="min-h-[120px] text-xs font-mono"
                  disabled={isSaving}
                />

                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    onClick={() => handleSave(entry.agentType as AgentType)}
                    disabled={isSaving || !hasChanges || currentValue.trim().length === 0}
                  >
                    {isSaving ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Check className="h-3 w-3 mr-1" />
                    )}
                    Save
                  </Button>

                  {projectId && entry.source === "project" && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => handleReset(entry.agentType as AgentType)}
                      disabled={isSaving}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Reset to Global
                    </Button>
                  )}
                </div>

                {projectId && entry.globalPrompt && entry.source === "project" && (
                  <p className="text-[10px] text-muted-foreground">
                    Global prompt: {entry.globalPrompt.slice(0, 100)}
                    {(entry.globalPrompt.length ?? 0) > 100 ? "..." : ""}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
