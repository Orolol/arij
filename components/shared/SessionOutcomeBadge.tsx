import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { OUTCOME_LABEL_KEYS } from "@/components/session-live/labels";
import type { SessionOutcome } from "@/lib/agent-sessions/lifecycle";

/**
 * Visual config for each delivery verdict: the COLOUR this badge paints.
 *
 * The label keys are not here. They live in `components/session-live/labels.ts`
 * (`OUTCOME_LABEL_KEYS`), which names the same five verdicts for the live
 * screen — one vocabulary, resolved at render with the namespace-less
 * translator (`lib/i18n/catalogue.ts`, pattern 3). Colour, which is this
 * component's own decision, stays local.
 */
const OUTCOME_COLOR_CLASS: Record<SessionOutcome, string> = {
  answered: "text-agent border-agent-border bg-agent-bg",
  asked_question:
    "text-priority-yellow border-priority-yellow/30 bg-priority-yellow/10",
  silent: "text-meta border-border bg-band",
  error: "text-destructive border-destructive/30 bg-destructive/10",
  transition_refused:
    "text-priority-yellow border-priority-yellow/30 bg-priority-yellow/10",
};

function isKnownOutcome(value: string): value is SessionOutcome {
  return value in OUTCOME_COLOR_CLASS;
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
  // The shared table holds full dotted paths, so it resolves through the
  // namespace-less translator.
  const t = useTranslations();
  if (!outcome || !isKnownOutcome(outcome)) return null;

  return (
    <Badge
      variant="outline"
      className={`rounded-full px-[8px] py-[1px] text-[11px] font-normal ${OUTCOME_COLOR_CLASS[outcome]}`}
      data-testid={`session-outcome-${outcome}`}
    >
      {t(OUTCOME_LABEL_KEYS[outcome])}
    </Badge>
  );
}
