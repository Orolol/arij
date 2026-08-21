"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNamedAgentsList } from "@/hooks/useNamedAgentsList";

/**
 * Sentinel for the "no agent" row. Radix forbids an empty `SelectItem`
 * value, so the empty string only appears on the way out through
 * `onChange` — which is what the conversation PATCH route reads as
 * "clear the conversation-specific agent".
 */
const NO_AGENT_VALUE = "__none__";

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
  /**
   * Adds a "No agent" row so an already-attached agent can be detached.
   * Dispatch dialogs require an agent and leave this off; the chat header
   * turns it on, because a conversation whose agent cannot be cleared can
   * never switch provider (the provider select yields to a named agent).
   */
  allowClear?: boolean;
  /** Label of the clear row. */
  clearLabel?: string;
}

export function NamedAgentSelect({
  value,
  onChange,
  disabled = false,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  allowClear = false,
  clearLabel = "No agent",
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
      value={value ?? (allowClear ? NO_AGENT_VALUE : undefined)}
      onValueChange={(next) =>
        onChange(next === NO_AGENT_VALUE ? "" : next)
      }
      disabled={disabled}
    >
      <SelectTrigger {...labelProps} className={className ?? "w-44 h-7 text-xs"}>
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent>
        {allowClear && (
          <SelectItem value={NO_AGENT_VALUE}>{clearLabel}</SelectItem>
        )}
        {agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id}>
            {agent.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
