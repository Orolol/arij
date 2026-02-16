export const AGENT_TYPES = [
  "build",
  "review_security",
  "review_code",
  "review_compliance",
  "review_feature",
  "chat",
  "spec_generation",
  "team_build",
  "ticket_build",
  "merge",
  "tech_check",
  "e2e_test",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export const BUILTIN_REVIEW_TYPES = [
  "security",
  "code_review",
  "compliance",
  "feature_review",
] as const;

export type BuiltinReviewType = (typeof BUILTIN_REVIEW_TYPES)[number];

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  build: "Build",
  review_security: "Review: Security",
  review_code: "Review: Code",
  review_compliance: "Review: Compliance",
  review_feature: "Review: Feature",
  chat: "Chat",
  spec_generation: "Spec Generation",
  team_build: "Team Build",
  ticket_build: "Ticket Build",
  merge: "Merge",
  tech_check: "Tech Check",
  e2e_test: "E2E Test",
};

export function isAgentType(value: string): value is AgentType {
  return AGENT_TYPES.includes(value as AgentType);
}

export const REVIEW_TYPE_TO_AGENT_TYPE: Record<BuiltinReviewType, AgentType> = {
  security: "review_security",
  code_review: "review_code",
  compliance: "review_compliance",
  feature_review: "review_feature",
};

export const BUILTIN_AGENT_PROMPTS: Record<AgentType, string> = {
  build: "",
  review_security: "",
  review_code: "",
  review_compliance: "",
  review_feature: "",
  chat: "",
  spec_generation: "",
  team_build: "",
  ticket_build: "",
  merge: "",
  tech_check: "",
  e2e_test: "",
};

export type AgentProvider =
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "mistral-vibe"
  | "qwen-code"
  | "opencode"
  | "deepseek"
  | "kimi"
  | "zai";

export const PROVIDER_OPTIONS: AgentProvider[] = [
  "claude-code",
  "codex",
  "gemini-cli",
  "mistral-vibe",
  "qwen-code",
  "opencode",
  "deepseek",
  "kimi",
  "zai",
];

export const PROVIDER_LABELS: Record<AgentProvider, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  "mistral-vibe": "Mistral Vibe",
  "qwen-code": "Qwen Code",
  opencode: "OpenCode",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  zai: "Zai",
};

/** Providers grouped by tier for UI display. */
export const PROVIDER_TIERS: { label: string; providers: AgentProvider[] }[] = [
  { label: "Tier 1", providers: ["claude-code", "gemini-cli", "codex"] },
  { label: "Tier 2", providers: ["mistral-vibe", "qwen-code", "opencode"] },
  { label: "Tier 3", providers: ["deepseek", "kimi", "zai"] },
];

export function isAgentProvider(value: string): value is AgentProvider {
  return (PROVIDER_OPTIONS as readonly string[]).includes(value);
}
