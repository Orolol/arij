"use client";

import { useAgentProviders, useNamedAgents } from "@/hooks/useAgentConfig";
import {
  AGENT_TYPES,
  AGENT_TYPE_LABELS,
  PROVIDER_OPTIONS,
  type AgentType,
  type AgentProvider,
} from "@/lib/agent-config/constants";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

interface ProviderDefaultsTabProps {
  scope: "global" | "project";
  projectId?: string;
}

const PROVIDER_LABELS: Record<AgentProvider, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
};

/** Prefix for named agent values in the combined select */
const NAMED_PREFIX = "named:";

function sourceBadgeVariant(source: string) {
  switch (source) {
    case "project":
      return "default" as const;
    case "global":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function ProviderDefaultsTab({
  scope,
  projectId,
}: ProviderDefaultsTabProps) {
  const { data, loading, updateProvider, assignNamedAgent } = useAgentProviders(scope, projectId);
  const { data: agents, loading: agentsLoading } = useNamedAgents();

  if (loading || agentsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const providerMap = new Map(data.map((p) => [p.agentType, p]));

  function handleChange(agentType: AgentType, value: string) {
    if (value.startsWith(NAMED_PREFIX)) {
      const namedAgentId = value.slice(NAMED_PREFIX.length);
      assignNamedAgent(agentType, namedAgentId);
    } else {
      updateProvider(agentType, value as AgentProvider);
    }
  }

  function currentValue(agentType: AgentType): string {
    const entry = providerMap.get(agentType);
    if (entry?.namedAgentId) {
      return NAMED_PREFIX + entry.namedAgentId;
    }
    return entry?.provider ?? "claude-code";
  }

  function displayLabel(agentType: AgentType): string {
    const entry = providerMap.get(agentType);
    if (entry?.namedAgentName) {
      return entry.namedAgentName;
    }
    return PROVIDER_LABELS[entry?.provider ?? "claude-code"];
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-1">
        {agents.length > 0 && (
          <p className="text-xs text-muted-foreground pb-1">
            Assign a named agent or raw provider to each task type.
          </p>
        )}

        {AGENT_TYPES.map((agentType) => {
          const entry = providerMap.get(agentType);
          const source = entry?.source ?? "builtin";

          return (
            <div
              key={agentType}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border"
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">
                  {AGENT_TYPE_LABELS[agentType as AgentType]}
                </span>
                {entry?.namedAgentName && entry.namedAgentModel && (
                  <div className="text-xs text-muted-foreground truncate">
                    {PROVIDER_LABELS[entry.provider]} &middot; {entry.namedAgentModel}
                  </div>
                )}
              </div>
              <Badge
                variant={sourceBadgeVariant(source)}
                className="text-xs shrink-0"
              >
                {source}
              </Badge>
              <Select
                value={currentValue(agentType)}
                onValueChange={(value) => handleChange(agentType, value)}
              >
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue>{displayLabel(agentType)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {agents.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Named Agents</SelectLabel>
                      {agents.map((agent) => (
                        <SelectItem
                          key={agent.id}
                          value={NAMED_PREFIX + agent.id}
                        >
                          <span>{agent.name}</span>
                          <span className="ml-1.5 text-muted-foreground text-xs">
                            {PROVIDER_LABELS[agent.provider]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>Raw Providers</SelectLabel>
                    {PROVIDER_OPTIONS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {PROVIDER_LABELS[provider]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
