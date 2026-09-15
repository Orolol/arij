/** Providers with a shipped, cancellation-aware Task delegation implementation. */
export function supportsTeamDelegation(provider: string): boolean {
  return provider === "claude-code" || provider === "pi";
}
