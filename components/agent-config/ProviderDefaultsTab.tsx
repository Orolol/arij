"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import type { ProviderDefaultEntry } from "@/hooks/useAgentConfig";
import type { AgentType, ProviderOption } from "@/lib/types/agent-config";

interface ProviderDefaultsTabProps {
  providers: ProviderDefaultEntry[];
  loading: boolean;
  onSave: (agentType: AgentType, provider: ProviderOption) => Promise<void>;
}

export function ProviderDefaultsTab({
  providers,
  loading,
  onSave,
}: ProviderDefaultsTabProps) {
  const [saving, setSaving] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleChange = async (
    agentType: AgentType,
    provider: ProviderOption
  ) => {
    setSaving(agentType);
    try {
      await onSave(agentType, provider);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-1 pt-2">
      <p className="text-xs text-muted-foreground mb-3">
        Set the default AI provider for each agent type. Manual selection still overrides the default.
      </p>

      {providers.map((entry) => {
        const isSaving = saving === entry.agentType;

        return (
          <div
            key={entry.agentType}
            className="flex items-center gap-3 px-3 py-2 border border-border rounded-md"
          >
            <span className="text-sm flex-1">{entry.label}</span>
            {entry.source === "project" && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0"
              >
                Project
              </Badge>
            )}
            <div className="relative">
              {isSaving && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10 rounded-md">
                  <Loader2 className="h-3 w-3 animate-spin" />
                </div>
              )}
              <Select
                value={entry.provider}
                onValueChange={(value: string) =>
                  handleChange(
                    entry.agentType as AgentType,
                    value as ProviderOption
                  )
                }
                disabled={isSaving}
              >
                <SelectTrigger className="h-7 text-xs w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-code" className="text-xs">
                    Claude Code
                  </SelectItem>
                  <SelectItem value="codex" className="text-xs">
                    Codex
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
