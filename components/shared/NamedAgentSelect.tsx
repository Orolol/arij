"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNamedAgentsList } from "@/hooks/useNamedAgentsList";

interface NamedAgentSelectProps {
  value: string | null;
  onChange: (namedAgentId: string) => void;
  disabled?: boolean;
  className?: string;
  /**
   * Accessible name for the trigger. A visible label sitting next to the
   * control is not programmatically associated with it (the trigger is a
   * button, not an input), so screen readers otherwise announce it as an
   * unlabeled combobox — worth passing wherever several of these sit in one
   * form.
   */
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function NamedAgentSelect({
  value,
  onChange,
  disabled = false,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: NamedAgentSelectProps) {
  const { agents, loading } = useNamedAgentsList();
  const labelProps = {
    ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
    ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
  };

  if (loading) {
    return (
      <Select disabled>
        <SelectTrigger {...labelProps} className={className ?? "w-44 h-7 text-xs"}>
          <SelectValue placeholder="Loading..." />
        </SelectTrigger>
      </Select>
    );
  }

  if (agents.length === 0) {
    return (
      <Select disabled>
        <SelectTrigger {...labelProps} className={className ?? "w-44 h-7 text-xs"}>
          <SelectValue placeholder="No agents configured" />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger {...labelProps} className={className ?? "w-44 h-7 text-xs"}>
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent>
        {agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id}>
            {agent.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
