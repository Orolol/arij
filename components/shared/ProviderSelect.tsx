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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PROVIDER_LABELS,
  PROVIDER_TIERS,
  type AgentProvider,
} from "@/lib/agent-config/constants";

export type ProviderType = AgentProvider;

interface ProviderSelectProps {
  value: ProviderType;
  onChange: (value: ProviderType) => void;
  /** Per-provider availability map. */
  providers?: Record<AgentProvider, boolean>;
  /** @deprecated Use providers map instead. */
  codexAvailable?: boolean;
  /** @deprecated Use providers map instead. */
  codexInstalled?: boolean;
  /** @deprecated Use providers map instead. */
  geminiAvailable?: boolean;
  /** @deprecated Use providers map instead. */
  geminiInstalled?: boolean;
  disabled?: boolean;
  className?: string;
}

export function ProviderSelect({
  value,
  onChange,
  providers,
  codexAvailable,
  codexInstalled = false,
  geminiAvailable = false,
  disabled = false,
  className,
}: ProviderSelectProps) {
  // Build availability from the providers map or legacy props
  const availability: Record<string, boolean> = providers
    ? { ...providers }
    : {
        "claude-code": true,
        codex: codexAvailable ?? false,
        "gemini-cli": geminiAvailable,
        "mistral-vibe": false,
        "qwen-code": false,
        opencode: false,
        deepseek: false,
        kimi: false,
        zai: false,
      };

  // Legacy: codexInstalled but not available means not logged in
  const codexNotLoggedIn = codexInstalled && !availability.codex;

  function getTooltip(provider: AgentProvider): string {
    if (provider === "codex" && codexNotLoggedIn) {
      return "Codex CLI not authenticated. Run: codex login";
    }
    return `${PROVIDER_LABELS[provider]} CLI not found.`;
  }

  return (
    <TooltipProvider>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as ProviderType)}
        disabled={disabled}
      >
        <SelectTrigger className={className ?? "w-40 h-7 text-xs"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROVIDER_TIERS.map((tier) => (
            <SelectGroup key={tier.label}>
              <SelectLabel className="text-xs text-muted-foreground">
                {tier.label}
              </SelectLabel>
              {tier.providers.map((provider) => {
                const isAvailable = availability[provider];
                const label = PROVIDER_LABELS[provider];

                if (isAvailable) {
                  return (
                    <SelectItem key={provider} value={provider}>
                      {label}
                    </SelectItem>
                  );
                }

                return (
                  <Tooltip key={provider}>
                    <TooltipTrigger asChild>
                      <div>
                        <SelectItem value={provider} disabled={false}>
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                            {label}
                          </span>
                        </SelectItem>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{getTooltip(provider)}</TooltipContent>
                  </Tooltip>
                );
              })}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </TooltipProvider>
  );
}
