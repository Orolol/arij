/**
 * Shared API contract for the usage observatory.
 * Server: lib/usage/aggregate.ts + app/api/usage/route.ts.
 * Client: hooks/useUsage.ts + app/usage/page.tsx via `import type` ONLY
 * (type-only imports erase at runtime, keeping the builders decoupled).
 *
 * Number-or-null semantics: null means "provider never reported this"
 * (e.g. codex token/cost columns) — render an em-dash, never 0.
 */

export interface UsageTotals {
  sessions: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface AgentUsageRow {
  namedAgentId: string | null;
  name: string | null;          // null = sessions with no named agent
  provider: string;
  sessions: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  lastActiveAt: string | null;  // ISO UTC
}

export interface ProviderUsageRow {
  provider: string;
  sessions: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface ProjectUsageRow {
  projectId: string;
  projectName: string | null;
  sessions: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface DayUsageRow {
  date: string;                 // local calendar date, "YYYY-MM-DD"
  sessions: number;
  costUsd: number | null;
}

export interface WindowUsage {
  sessions: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface SubscriptionWindowStatus {
  usedPercent: number | null;
  windowMinutes: number | null;
  resetsAt: number | null;      // unix SECONDS (provider-emitted)
}

export interface SubscriptionStatus {
  provider: string;             // "codex" | "claude-code"
  source: "provider-reported" | "metered-via-arij";
  plan: string | null;
  capturedAt: string | null;    // ISO; provider-reported only, null = no snapshot
  primary: SubscriptionWindowStatus | null;
  secondary: SubscriptionWindowStatus | null;
  metered: {
    last5h: WindowUsage;
    last7d: WindowUsage;
    budgetUsdWeek: number | null;
    budgetUsedPercent: number | null; // unclamped, integer-rounded; null without budget
  } | null;                     // metered-via-arij only
}

export interface UsageReport {
  totals: UsageTotals;
  byAgent: AgentUsageRow[];     // sorted cost desc, nulls last, then sessions desc
  byProvider: ProviderUsageRow[];
  byProject: ProjectUsageRow[];
  byDay: DayUsageRow[];         // EXACTLY 30 entries, oldest first, zero-filled
  windows: { last5h: WindowUsage; last7d: WindowUsage };
  subscriptions: SubscriptionStatus[];
  generatedAt: string;          // ISO UTC
}

/** Global settings key (no project suffix): optional weekly Claude budget in USD. */
export const CLAUDE_WEEKLY_BUDGET_SETTING_KEY = "usage_budget_usd_7d_claude";
