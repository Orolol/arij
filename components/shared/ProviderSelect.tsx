"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ProviderType = "claude-code" | "codex";

interface ProviderSelectProps {
  value: ProviderType;
  onChange: (value: ProviderType) => void;
  codexAvailable: boolean;
  disabled?: boolean;
  className?: string;
}

export function ProviderSelect({
  value,
  onChange,
  codexAvailable,
  disabled = false,
  className,
}: ProviderSelectProps) {
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
          <SelectItem value="claude-code">Claude Code</SelectItem>
          {codexAvailable ? (
            <SelectItem value="codex">Codex</SelectItem>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <SelectItem value="codex" disabled>
                    Codex
                  </SelectItem>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                Configure Codex API key in Settings
              </TooltipContent>
            </Tooltip>
          )}
        </SelectContent>
      </Select>
    </TooltipProvider>
  );
}
