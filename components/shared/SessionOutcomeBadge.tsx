import { Badge } from "@/components/ui/badge";
import type { SessionOutcome } from "@/lib/agent-sessions/lifecycle";

/**
 * Visual config for each delivery verdict. Kept local (instead of importing
 * runtime values from the lifecycle module) so this stays a pure client
 * component with no server-only imports.
 */
const OUTCOME_CONFIG: Record<
  SessionOutcome,
  { label: string; className: string }
> = {
  answered: {
    label: "Answered",
    className: "text-green-500 border-green-500/30 bg-green-500/10",
  },
  asked_question: {
    label: "Asked a question",
    className: "text-amber-500 border-amber-500/30 bg-amber-500/10",
  },
  silent: {
    label: "Silent",
    className: "text-muted-foreground border-muted-foreground/30 bg-muted/50",
  },
  error: {
    label: "Error",
    className: "text-red-500 border-red-500/30 bg-red-500/10",
  },
};

function isKnownOutcome(value: string): value is SessionOutcome {
  return value in OUTCOME_CONFIG;
}

/**
 * Delivery-verdict badge for an agent session. Renders nothing for
 * unclassified sessions (running, cancelled, legacy rows).
 */
export function SessionOutcomeBadge({
  outcome,
}: {
  outcome?: string | null;
}) {
  if (!outcome || !isKnownOutcome(outcome)) return null;

  const config = OUTCOME_CONFIG[outcome];
  return (
    <Badge
      variant="outline"
      className={`text-[10px] ${config.className}`}
      data-testid={`session-outcome-${outcome}`}
    >
      {config.label}
    </Badge>
  );
}
