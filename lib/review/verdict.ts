/**
 * The structured review verdict vocabulary, verbatim.
 *
 * This is the canonical TypeScript vocabulary consumed by the
 * submit_findings route and every verdict reader. The standalone MCP shim
 * mirrors it in its JSON tool schema. Sibling of lib/review/finding-severity.ts and
 * client-safe for the same reason: the board, the pipeline and the workflow
 * engine all have to agree on what a reviewer said, and `lib/workflow/*`
 * must not reach into `lib/pipeline/*` to find out.
 */

export const STRUCTURED_REVIEW_VERDICTS = [
  "approved",
  "approved_with_minor_issues",
  "changes_requested",
] as const;

export type StructuredReviewVerdict =
  (typeof STRUCTURED_REVIEW_VERDICTS)[number];

/** The only verdict that blocks on its own. */
export const NEGATIVE_STRUCTURED_VERDICT: StructuredReviewVerdict =
  "changes_requested";

/**
 * The column is free text, so an unrecognised value is treated as absent
 * rather than trusted — a verdict the decision table has no rule for must
 * not silently pass as an approval.
 */
export function isStructuredReviewVerdict(
  value: string | null | undefined
): value is StructuredReviewVerdict {
  return (
    typeof value === "string" &&
    (STRUCTURED_REVIEW_VERDICTS as readonly string[]).includes(value)
  );
}

/** Last explicit Overall Verdict line; mentions in prose are not verdicts. */
export function parseProseVerdict(report: string | null | undefined): StructuredReviewVerdict | null {
  const lines = (report ?? "").split(/\r?\n/);
  let verdict: StructuredReviewVerdict | null = null;
  let fence: string | null = null;
  for (const line of lines) {
    const delimiter = line.trim().match(/^(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const match = line.trim().match(/^(?:\*\*)?Overall Verdict:\s*(Approved with Minor Issues|Approved|Changes Requested|Feature Complete|Bug Fixed|Partially Complete|Not Complete)(?:\*\*)?\s*$/i);
    if (!match) continue;
    const label = match[1].toLowerCase();
    verdict = label === "approved with minor issues" ? "approved_with_minor_issues"
      : ["changes requested", "partially complete", "not complete"].includes(label) ? "changes_requested" : "approved";
  }
  return verdict;
}
