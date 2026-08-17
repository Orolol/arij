"use client";

import { useEffect, useState } from "react";
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
import { useProvidersAvailable } from "@/hooks/useProvidersAvailable";
import { REVIEW_PROVIDER_SEGREGATION_SETTING_KEY } from "@/lib/agent-config/review-segregation-constants";
import {
  AGENT_MAX_CONCURRENT_GLOBAL_SETTING_KEY,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  agentMaxConcurrentSettingKey,
  parseMaxConcurrentSetting,
} from "@/lib/agents/scheduler-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  // null = not loaded yet
  const [segregation, setSegregation] = useState<boolean | null>(null);
  const [savingSegregation, setSavingSegregation] = useState(false);
  // Explicit values stored per settings key (null = key unset / inherits).
  const [maxConcurrent, setMaxConcurrent] = useState<{
    global: number | null;
    project: number | null;
  } | null>(null);
  const [maxConcurrentInput, setMaxConcurrentInput] = useState("");
  const [savingMaxConcurrent, setSavingMaxConcurrent] = useState(false);

  const projectScoped = scope === "project" && !!projectId;
  const maxConcurrentKey = projectScoped
    ? agentMaxConcurrentSettingKey(projectId!)
    : AGENT_MAX_CONCURRENT_GLOBAL_SETTING_KEY;
  const savedMaxConcurrent = maxConcurrent
    ? projectScoped
      ? maxConcurrent.project
      : maxConcurrent.global
    : null;
  const inheritedMaxConcurrent = projectScoped
    ? maxConcurrent?.global ?? DEFAULT_MAX_CONCURRENT_AGENTS
    : DEFAULT_MAX_CONCURRENT_AGENTS;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const value = json?.data?.[REVIEW_PROVIDER_SEGREGATION_SETTING_KEY];
        setSegregation(value === true || value === "true");

        const global = parseMaxConcurrentSetting(
          json?.data?.[AGENT_MAX_CONCURRENT_GLOBAL_SETTING_KEY]
        );
        const project = projectId
          ? parseMaxConcurrentSetting(
              json?.data?.[agentMaxConcurrentSettingKey(projectId)]
            )
          : null;
        setMaxConcurrent({ global, project });
      })
      .catch(() => {
        if (!cancelled) {
          setSegregation(false);
          setMaxConcurrent({ global: null, project: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Re-seed the input whenever the loaded values or the scope change.
  useEffect(() => {
    setMaxConcurrentInput(savedMaxConcurrent === null ? "" : String(savedMaxConcurrent));
  }, [savedMaxConcurrent, maxConcurrentKey]);

  async function toggleSegregation(next: boolean) {
    const previous = segregation;
    setSegregation(next);
    setSavingSegregation(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [REVIEW_PROVIDER_SEGREGATION_SETTING_KEY]: next ? "true" : "false",
        }),
      });
      if (!res.ok) setSegregation(previous);
    } catch {
      setSegregation(previous);
    }
    setSavingSegregation(false);
  }

  const trimmedMaxConcurrentInput = maxConcurrentInput.trim();
  const parsedMaxConcurrentInput =
    trimmedMaxConcurrentInput === ""
      ? null
      : parseMaxConcurrentSetting(trimmedMaxConcurrentInput);
  const maxConcurrentInputValid =
    trimmedMaxConcurrentInput === "" || parsedMaxConcurrentInput !== null;
  const maxConcurrentDirty =
    maxConcurrent !== null && parsedMaxConcurrentInput !== savedMaxConcurrent;

  async function saveMaxConcurrent() {
    if (!maxConcurrent || !maxConcurrentInputValid) return;
    setSavingMaxConcurrent(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // null clears the key so the scope falls back to its inherited value.
        body: JSON.stringify({ [maxConcurrentKey]: parsedMaxConcurrentInput }),
      });
      if (res.ok) {
        setMaxConcurrent((prev) =>
          prev
            ? {
                ...prev,
                [projectScoped ? "project" : "global"]: parsedMaxConcurrentInput,
              }
            : prev
        );
      }
    } catch {
      // keep the dirty input; the user can retry
    }
    setSavingMaxConcurrent(false);
  }

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
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border">
          <Checkbox
            id="review-provider-segregation"
            checked={segregation === true}
            disabled={segregation === null || savingSegregation}
            onCheckedChange={(checked) => toggleSegregation(checked === true)}
          />
          <div className="space-y-1">
            <label
              htmlFor="review-provider-segregation"
              className="text-sm font-medium leading-none cursor-pointer"
            >
              Reviewer must differ from builder
            </label>
            <p className="text-xs text-muted-foreground">
              When enabled, review agents avoid the provider that built the
              ticket, when another CLI is available. An explicitly picked named
              agent always wins. Applies globally.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border">
          <div className="flex-1 space-y-1">
            <label
              htmlFor="agent-max-concurrent"
              className="text-sm font-medium leading-none cursor-pointer"
            >
              Max concurrent agents
            </label>
            <p className="text-xs text-muted-foreground">
              {projectScoped
                ? `How many batch agents (builds, reviews, merges, QA) may run at once for this project. Extra launches wait in a queue. Leave empty to inherit the global default (${inheritedMaxConcurrent}).`
                : `Default cap on batch agents (builds, reviews, merges, QA) running at once per project. Extra launches wait in a queue. Leave empty for the built-in default (${DEFAULT_MAX_CONCURRENT_AGENTS}).`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              id="agent-max-concurrent"
              type="number"
              min={1}
              step={1}
              value={maxConcurrentInput}
              onChange={(e) => setMaxConcurrentInput(e.target.value)}
              placeholder={String(inheritedMaxConcurrent)}
              disabled={maxConcurrent === null || savingMaxConcurrent}
              className="w-20 bg-transparent border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:border-primary"
            />
            <Button
              size="sm"
              onClick={saveMaxConcurrent}
              disabled={
                savingMaxConcurrent ||
                !maxConcurrentDirty ||
                !maxConcurrentInputValid
              }
            >
              {savingMaxConcurrent ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : null}
              Save
            </Button>
          </div>
        </div>
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
