export const ORDINARY_REVIEW_AGENT_TYPES = [
  "review_security",
  "review_code",
  "review_compliance",
  "review_feature",
] as const;

/** True for the four agent types the review gates count. */
export function isOrdinaryReviewAgentType(
  agentType: string | null | undefined
): boolean {
  return (
    typeof agentType === "string" &&
    (ORDINARY_REVIEW_AGENT_TYPES as readonly string[]).includes(agentType)
  );
}

