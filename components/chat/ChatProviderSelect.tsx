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
  type ChatModeProvider,
} from "@/lib/agent-config/constants";
import type { Conversation } from "@/hooks/useConversations";

export interface ChatAgentSelection {
  namedAgentId: string | null;
  provider: string;
}

interface ChatProviderSelectProps {
  /** Active conversation object or provider string. */
  activeConversation?: Conversation | null;
  activeProvider?: string;
  value?: string;
  onChange?: (provider: string) => void;
  onSelect?: (selection: ChatAgentSelection) => void;
  onAgentChange?: (namedAgentId: string) => void;
  onProviderChange?: (provider: string) => void;
  disabled?: boolean;
  conversationType?: string | null;
  className?: string;
}

/**
 * Single unified chat agent and provider selector:
 * Offers Direct API (OpenAI-compatible fast mode) and all configured Named Agents.
 */
export function ChatProviderSelect({
  activeConversation,
  activeProvider,
  value,
  onChange,
  onSelect,
  onAgentChange,
  onProviderChange,
  disabled = false,
  className,
}: ChatProviderSelectProps) {
  const { agents, loading } = useNamedAgentsList();

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

  // Determine selected value
  let selectedValue: string = "";
  if (value) {
    selectedValue = value;
  } else if (activeConversation) {
    if (
      activeConversation.provider === OPENAI_COMPATIBLE_PROVIDER ||
      activeProvider === OPENAI_COMPATIBLE_PROVIDER
    ) {
      selectedValue = OPENAI_COMPATIBLE_PROVIDER;
    } else if (activeConversation.namedAgentId) {
      selectedValue = activeConversation.namedAgentId;
    } else {
      const matchingAgent = agents.find(
        (a) => a.provider === (activeProvider ?? activeConversation.provider)
      );
      selectedValue = matchingAgent ? matchingAgent.id : (agents[0]?.id ?? "");
    }
  } else if (activeProvider === OPENAI_COMPATIBLE_PROVIDER) {
    selectedValue = OPENAI_COMPATIBLE_PROVIDER;
  }

  function handleValueChange(nextValue: string) {
    if (nextValue === OPENAI_COMPATIBLE_PROVIDER) {
      onSelect?.({
        namedAgentId: null,
        provider: OPENAI_COMPATIBLE_PROVIDER,
      });
      onProviderChange?.(OPENAI_COMPATIBLE_PROVIDER);
      onChange?.(OPENAI_COMPATIBLE_PROVIDER);
    } else {
      const selectedAgent = agents.find((a) => a.id === nextValue);
      const provider = selectedAgent?.provider ?? "claude-code";
      onSelect?.({
        namedAgentId: nextValue,
        provider,
      });
      onAgentChange?.(nextValue);
      onProviderChange?.(provider);
      onChange?.(provider);
    }
  }

  return (
    <Select
      value={selectedValue || undefined}
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
        {agents.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[11px] font-semibold text-muted-foreground px-2 py-1">
              Named Agents
            </SelectLabel>
            {agents.map((agent) => (
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
      </SelectContent>
    </Select>
  );
}
