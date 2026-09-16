import { expect, it } from "vitest";
import { parseProseVerdict } from "@/lib/review/verdict";
it.each([['Approved','approved'],['Approved with Minor Issues','approved_with_minor_issues'],['Changes Requested','changes_requested'],['Feature Complete','approved'],['Bug Fixed','approved'],['Not Complete','changes_requested'],['Partially Complete','changes_requested']])("reads %s", (text, verdict) => {
  expect(parseProseVerdict(`**Overall Verdict: ${text}**`)).toBe(verdict);
});
it("uses the final declared verdict, not quoted historical prose", () => {
  expect(parseProseVerdict('Changes requested in the old review.\n**Overall Verdict: Changes Requested**\n**Overall Verdict: Approved**')).toBe('approved');
  expect(parseProseVerdict('No changes requested.')).toBeNull();
});
