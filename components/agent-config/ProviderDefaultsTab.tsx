"use client";

import { useAgentProviders, useNamedAgents } from "@/hooks/useAgentConfig";
import {
  AGENT_TYPES,
  AGENT_TYPE_LABELS,
  PROVIDER_OPTIONS,
  PROVIDER_LABELS,
  PROVIDER_TIERS,
  type AgentType,
  type AgentProvider,
} from "@/lib/agent-config/constants";
import { useProvidersAvailable } from "@/hooks/useCodexAvailable";
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
  const { data, loading, updateProvider } = useAgentProviders(scope, projectId);
  const { data: namedAgents } = useNamedAgents();
  const { providers: providerAvailability } = useProvidersAvailable();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const providerMap = new Map(data.map((p) => [p.agentType, p]));

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-1">
        {AGENT_TYPES.map((agentType) => {
          const entry = providerMap.get(agentType);
          const currentProvider = entry?.provider ?? "claude-code";
          const source = entry?.source ?? "builtin";
          const currentNamedAgentId = entry?.namedAgentId ?? null;

          return (
            <div
              key={agentType}
              className="grid grid-cols-1 lg:grid-cols-[1fr_auto_160px_220px] items-center gap-3 px-4 py-3 rounded-lg border border-border"
            >
              <span className="flex-1 text-sm font-medium">
                {AGENT_TYPE_LABELS[agentType as AgentType]}
              </span>
              <Badge
                variant={sourceBadgeVariant(source)}
                className="text-xs shrink-0"
              >
                {source}
              </Badge>
              <Select
                value={currentProvider}
                onValueChange={(value) =>
                  updateProvider(agentType, value as AgentProvider, null)
                }
              >
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_TIERS.map((tier) => (
                    <SelectGroup key={tier.label}>
                      <SelectLabel className="text-xs text-muted-foreground">
                        {tier.label}
                      </SelectLabel>
                      {tier.providers.map((provider) => {
                        const isAvailable = providerAvailability[provider];
                        return (
                          <SelectItem key={provider} value={provider}>
                            <span className="flex items-center gap-1.5">
                              <span
                                className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                                  isAvailable ? "bg-green-500" : "bg-red-500"
                                }`}
                              />
                              {PROVIDER_LABELS[provider]}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={currentNamedAgentId || "__none__"}
                onValueChange={(value) => {
                  if (value === "__none__") {
                    updateProvider(agentType, currentProvider, null);
                    return;
                  }

                  const selected = namedAgents.find((agent) => agent.id === value);
                  if (!selected) return;

                  updateProvider(agentType, selected.provider, selected.id);
                }}
              >
                <SelectTrigger size="sm" className="w-52">
                  <SelectValue placeholder="Named agent (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {namedAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name} ({agent.model})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
