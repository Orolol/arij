"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNamedAgentsList } from "@/hooks/useNamedAgentsList";
import {
  OPENAI_COMPATIBLE_PROVIDER,
  PROVIDER_LABELS,
  PROVIDER_OPTIONS,
  type AgentProvider,
  type ChatModeProvider,
} from "@/lib/agent-config/constants";
import type { Conversation } from "@/hooks/useConversations";

export interface ChatAgentSelection {
  namedAgentId: string | null;
  provider: ChatModeProvider;
}

interface ChatProviderSelectProps {
  activeConversation: Conversation | null;
  activeProvider: string;
  onSelect: (selection: ChatAgentSelection) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Single unified chat agent and provider selector:
 * Offers Direct API (OpenAI-compatible fast mode), configured Named Agents,
 * and raw CLI Providers.
 */
export function ChatProviderSelect({
  activeConversation,
  activeProvider,
  onSelect,
  disabled = false,
  className,
}: ChatProviderSelectProps) {
  const { agents, loading } = useNamedAgentsList();
  const safeAgents = Array.isArray(agents) ? agents : [];

  if (loading) {
    return (
      <Select disabled>
        <SelectTrigger
          data-testid="chat-agent-select"
          className={
            className ??
            "h-[26px] w-44 border-0 bg-transparent text-[12.5px] text-muted-foreground shadow-none"
          }
        >
          <SelectValue placeholder="Loading..." />
        </SelectTrigger>
      </Select>
    );
  }

  // Determine selected value:
  // 1. Direct API (OpenAI-compatible)
  // 2. Named Agent ID
  // 3. Raw CLI Provider string
  let selectedValue = "";
  if (activeConversation) {
    if (activeConversation.namedAgentId) {
      selectedValue = activeConversation.namedAgentId;
    } else if (activeConversation.provider === OPENAI_COMPATIBLE_PROVIDER) {
      selectedValue = OPENAI_COMPATIBLE_PROVIDER;
    } else if (activeConversation.provider) {
      selectedValue = activeConversation.provider;
    }
  } else if (activeProvider === OPENAI_COMPATIBLE_PROVIDER) {
    selectedValue = OPENAI_COMPATIBLE_PROVIDER;
  } else if (activeProvider) {
    selectedValue = activeProvider;
  }

  function handleValueChange(nextValue: string) {
    if (nextValue === OPENAI_COMPATIBLE_PROVIDER) {
      onSelect({
        namedAgentId: null,
        provider: OPENAI_COMPATIBLE_PROVIDER,
      });
    } else {
      const selectedAgent = safeAgents.find((a) => a.id === nextValue);
      if (selectedAgent) {
        onSelect({
          namedAgentId: selectedAgent.id,
          provider: selectedAgent.provider,
        });
      } else if (PROVIDER_OPTIONS.includes(nextValue as AgentProvider)) {
        onSelect({
          namedAgentId: null,
          provider: nextValue as AgentProvider,
        });
      }
    }
  }

  return (
    <Select
      value={selectedValue || ""}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        data-testid="chat-agent-select"
        className={
          className ??
          "h-[26px] w-44 border-0 bg-transparent text-[12.5px] text-muted-foreground shadow-none"
        }
      >
        <SelectValue placeholder="Select provider" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel className="text-[11px] font-semibold text-muted-foreground px-2 py-1">
            Direct API
          </SelectLabel>
          <SelectItem
            value={OPENAI_COMPATIBLE_PROVIDER}
            data-testid="chat-option-openai-compatible"
          >
            {PROVIDER_LABELS[OPENAI_COMPATIBLE_PROVIDER]}
          </SelectItem>
        </SelectGroup>
        {safeAgents.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[11px] font-semibold text-muted-foreground px-2 py-1">
              Named Agents
            </SelectLabel>
            {safeAgents.map((agent) => (
              <SelectItem
                key={agent.id}
                value={agent.id}
                data-testid={`chat-option-agent-${agent.id}`}
              >
                {agent.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel className="text-[11px] font-semibold text-muted-foreground px-2 py-1">
            CLI Providers
          </SelectLabel>
          {PROVIDER_OPTIONS.map((provider) => (
            <SelectItem
              key={provider}
              value={provider}
              data-testid={`chat-option-provider-${provider}`}
            >
              {`${PROVIDER_LABELS[provider]} (CLI)`}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
