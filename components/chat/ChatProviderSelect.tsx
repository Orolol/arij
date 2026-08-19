"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OPENAI_COMPATIBLE_PROVIDER,
  PROVIDER_LABELS,
  PROVIDER_OPTIONS,
  type ChatModeProvider,
} from "@/lib/agent-config/constants";
import { isOpenAiIneligibleConversationAgentType } from "@/lib/chat/conversation-agent";

interface ChatProviderSelectProps {
  /** Provider stored on the active conversation. */
  value: string;
  onChange: (provider: string) => void;
  disabled?: boolean;
  /**
   * Active conversation type. The OpenAI-compatible option is hidden for
   * agent-only types (epic creation, brainstorm), which must run on a real
   * coding agent.
   */
  conversationType: string | null;
  className?: string;
}

/**
 * Per-conversation provider picker: the CLI providers plus the
 * OpenAI-compatible fast mode. A named agent on the conversation takes
 * precedence (the select is disabled in that case).
 */
export function ChatProviderSelect({
  value,
  onChange,
  disabled = false,
  conversationType,
  className,
}: ChatProviderSelectProps) {
  const options: ChatModeProvider[] = PROVIDER_OPTIONS.slice();
  if (!isOpenAiIneligibleConversationAgentType(conversationType)) {
    options.push(OPENAI_COMPATIBLE_PROVIDER);
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        data-testid="chat-provider-select"
        className={
          className ??
          "h-[26px] w-44 border-0 bg-transparent text-[12.5px] text-muted-foreground shadow-none"
        }
      >
        <SelectValue placeholder="Provider" />
      </SelectTrigger>
      <SelectContent>
        {options.map((provider) => (
          <SelectItem key={provider} value={provider}>
            {PROVIDER_LABELS[provider]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
