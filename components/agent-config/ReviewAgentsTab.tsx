"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  Plus,
  Trash2,
  Check,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { CustomReviewAgent } from "@/hooks/useAgentConfig";

const BUILT_IN_AGENTS = [
  { name: "Security Review", type: "security" },
  { name: "Code Review", type: "code_review" },
  { name: "Compliance & Accessibility Review", type: "compliance" },
];

interface ReviewAgentsTabProps {
  agents: CustomReviewAgent[];
  loading: boolean;
  projectId?: string;
  onCreate: (name: string, systemPrompt: string) => Promise<void>;
  onUpdate: (
    agentId: string,
    updates: { name?: string; systemPrompt?: string; isEnabled?: boolean }
  ) => Promise<void>;
  onDelete: (agentId: string) => Promise<void>;
}

export function ReviewAgentsTab({
  agents,
  loading,
  projectId,
  onCreate,
  onUpdate,
  onDelete,
}: ReviewAgentsTabProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editDrafts, setEditDrafts] = useState<
    Record<string, { name?: string; systemPrompt?: string }>
  >({});
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleCreate = async () => {
    if (!newName.trim() || !newPrompt.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await onCreate(newName.trim(), newPrompt.trim());
      setNewName("");
      setNewPrompt("");
      setShowCreate(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async (agentId: string) => {
    const draft = editDrafts[agentId];
    if (!draft) return;

    setSaving(agentId);
    try {
      await onUpdate(agentId, draft);
      setEditDrafts((prev) => {
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (agentId: string) => {
    setDeleting(agentId);
    try {
      await onDelete(agentId);
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleEnabled = async (agent: CustomReviewAgent) => {
    setSaving(agent.id);
    try {
      await onUpdate(agent.id, { isEnabled: !agent.isEnabled });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3 pt-2">
      <p className="text-xs text-muted-foreground">
        Built-in review agents are fixed. Create custom agents for additional review types.
      </p>

      {/* Built-in agents */}
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Built-in
        </h4>
        {BUILT_IN_AGENTS.map((agent) => (
          <div
            key={agent.type}
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-md bg-muted/30"
          >
            <span className="text-sm flex-1">{agent.name}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              Built-in
            </Badge>
          </div>
        ))}
      </div>

      <Separator />

      {/* Custom agents */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Custom
          </h4>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setShowCreate(!showCreate)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
            <Input
              placeholder="Agent name (e.g., UI Review)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 text-xs"
              disabled={creating}
            />
            <Textarea
              placeholder="System prompt for this review agent..."
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              className="min-h-[80px] text-xs font-mono"
              disabled={creating}
            />
            {createError && (
              <p className="text-xs text-destructive">{createError}</p>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                onClick={handleCreate}
                disabled={creating || !newName.trim() || !newPrompt.trim()}
              >
                {creating ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Check className="h-3 w-3 mr-1" />
                )}
                Create
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setShowCreate(false);
                  setCreateError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Existing custom agents */}
        {agents.length === 0 && !showCreate && (
          <p className="text-xs text-muted-foreground py-2 text-center">
            No custom review agents yet.
          </p>
        )}

        {agents.map((agent) => {
          const isExpanded = expanded === agent.id;
          const draft = editDrafts[agent.id];
          const isSaving = saving === agent.id;
          const isDeleting = deleting === agent.id;

          return (
            <div key={agent.id} className="border border-border rounded-md">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  onClick={() =>
                    setExpanded((prev) => (prev === agent.id ? null : agent.id))
                  }
                  className="shrink-0"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
                <span className="text-sm flex-1">{agent.name}</span>
                {agent.scope !== "global" && projectId && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                  >
                    Project
                  </Badge>
                )}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => handleToggleEnabled(agent)}
                  disabled={isSaving}
                  title={agent.isEnabled ? "Disable" : "Enable"}
                >
                  <div
                    className={`h-2 w-2 rounded-full ${
                      agent.isEnabled
                        ? "bg-green-500"
                        : "bg-muted-foreground/30"
                    }`}
                  />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => handleDelete(agent.id)}
                  disabled={isDeleting}
                  className="text-destructive hover:text-destructive"
                >
                  {isDeleting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </Button>
              </div>

              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">
                      Name
                    </label>
                    <Input
                      value={draft?.name ?? agent.name}
                      onChange={(e) =>
                        setEditDrafts((prev) => ({
                          ...prev,
                          [agent.id]: {
                            ...prev[agent.id],
                            name: e.target.value,
                          },
                        }))
                      }
                      className="h-7 text-xs"
                      disabled={isSaving}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">
                      System Prompt
                    </label>
                    <Textarea
                      value={draft?.systemPrompt ?? agent.systemPrompt}
                      onChange={(e) =>
                        setEditDrafts((prev) => ({
                          ...prev,
                          [agent.id]: {
                            ...prev[agent.id],
                            systemPrompt: e.target.value,
                          },
                        }))
                      }
                      className="min-h-[80px] text-xs font-mono"
                      disabled={isSaving}
                    />
                  </div>
                  {draft && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="xs"
                        onClick={() => handleSaveEdit(agent.id)}
                        disabled={isSaving}
                      >
                        {isSaving ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Check className="h-3 w-3 mr-1" />
                        )}
                        Save
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          setEditDrafts((prev) => {
                            const next = { ...prev };
                            delete next[agent.id];
                            return next;
                          })
                        }
                      >
                        <X className="h-3 w-3 mr-1" />
                        Discard
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
