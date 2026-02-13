"use client";

import { useState } from "react";
import { useNamedAgents, type NamedAgent } from "@/hooks/useAgentConfig";
import {
  PROVIDER_OPTIONS,
  type AgentProvider,
} from "@/lib/agent-config/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";

const PROVIDER_LABELS: Record<AgentProvider, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
};

const MODEL_PLACEHOLDERS: Record<AgentProvider, string> = {
  "claude-code": "e.g. claude-sonnet-4-5-20250929",
  codex: "e.g. gpt-4.1",
  "gemini-cli": "e.g. gemini-2.5-pro",
};

interface AgentFormState {
  name: string;
  provider: AgentProvider;
  model: string;
}

const INITIAL_FORM: AgentFormState = {
  name: "",
  provider: "claude-code",
  model: "",
};

export function NamedAgentsTab() {
  const {
    data: agents,
    loading,
    createNamedAgent,
    updateNamedAgent,
    deleteNamedAgent,
  } = useNamedAgents();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  function openCreate() {
    setEditingId(null);
    setForm(INITIAL_FORM);
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(agent: NamedAgent) {
    setEditingId(agent.id);
    setForm({
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
    });
    setError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    if (!form.model.trim()) {
      setError("Model is required");
      return;
    }

    setSaving(true);
    setError(null);

    if (editingId) {
      const result = await updateNamedAgent(editingId, form);
      if (!result.ok) {
        setError(result.error || "Failed to update agent");
        setSaving(false);
        return;
      }
    } else {
      const result = await createNamedAgent(form);
      if (!result.ok) {
        setError(result.error || "Failed to create agent");
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setDialogOpen(false);
  }

  async function handleDelete(id: string) {
    await deleteNamedAgent(id);
    setDeleteConfirmId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="space-y-2 p-1">
          <div className="flex items-center justify-between pb-1">
            <p className="text-xs text-muted-foreground">
              Named agents combine a CLI provider with a specific model.
            </p>
            <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New Agent
            </Button>
          </div>

          {agents.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No named agents yet. Create one to get started.
            </div>
          )}

          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{agent.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {PROVIDER_LABELS[agent.provider]} &middot; {agent.model}
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                onClick={() => openEdit(agent)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {deleteConfirmId === agent.id ? (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs"
                    onClick={() => handleDelete(agent.id)}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setDeleteConfirmId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteConfirmId(agent.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Agent" : "New Agent"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="e.g. CC Opus 4.6"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Provider</label>
              <Select
                value={form.provider}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    provider: v as AgentProvider,
                    model: "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Model</label>
              <Input
                placeholder={MODEL_PLACEHOLDERS[form.provider]}
                value={form.model}
                onChange={(e) =>
                  setForm((f) => ({ ...f, model: e.target.value }))
                }
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
