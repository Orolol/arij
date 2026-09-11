/**
 * Which keys `PATCH /api/settings` is allowed to write.
 *
 * WHY THIS EXISTS. The route used to type-check four known keys and store
 * everything else verbatim, so a settings write was a code-execution
 * primitive: `verify_commands` is executed with `shell: true` by the
 * deterministic verification stage, and `global_prompt` is prepended to every
 * agent prompt. Combined with an unauthenticated `/api/*` on `0.0.0.0`, one
 * request from the LAN was one shell (B-arij-247).
 *
 * TWO SHAPES, because the settings table has two. A GLOBAL key is bare
 * (`verify_commands`); a per-scope override is `<base>:<scope>` — the project
 * id for most, the agent type for the watchdog. The scoped list is
 * deliberately a SUBSET: only bases that actually have a `…SettingKey(scope)`
 * builder are scopable, so `global_prompt:anything` is refused rather than
 * silently stored where nothing will ever read it.
 *
 * `__tests__/settings-writable-keys-coverage.test.ts` walks every
 * `*_SETTING_KEY` constant declared under `lib/` and fails when one appears in
 * neither list — the drift guard, because these are copies of constants that
 * live elsewhere and a new setting would otherwise be silently unwritable
 * (or, worse, the allowlist would be quietly widened by nobody).
 */

/**
 * Global keys a client may write.
 *
 * Sorted, and one per line on purpose: this list is read in code review far
 * more often than it is edited, and a key hiding in a wrapped line is exactly
 * how a dangerous one gets waved through.
 */
export const WRITABLE_SETTING_KEYS: readonly string[] = [
  "agent_max_concurrent",
  "auto_mode_build_agent",
  "auto_mode_build_concurrency",
  "auto_mode_enabled",
  "auto_mode_review_agent",
  "auto_mode_review_concurrency",
  "auto_mode_smart_dispatch",
  "bug_regression_check",
  "bug_regression_command",
  "bug_regression_timeout_ms",
  // Persistent-chat tuning knobs. No UI writes them today; they are here
  // because this route is their only write path, and a numeric timeout that
  // cannot be set at all is a worse answer than one that can.
  "chat_persistent_idle_timeout_ms",
  "chat_persistent_max_conversations",
  "chat_persistent_turn_stall_ms",
  "ci_autofix_enabled",
  "clone_timeout_ms",
  "default_composite_agent",
  "dreaming_after_night_run",
  "full_auto_second_opinion",
  "github_oauth_meta",
  "github_pat",
  "global_prompt",
  "mcp_tools_enabled",
  "mcp_user_global_sync",
  "memory_auto_distill",
  "night_circuit_breaker",
  "night_cost_cap_usd",
  "openai_api_key",
  "openai_base_url",
  "openai_model",
  "openai_reasoning_effort",
  "pipeline_enabled",
  "pipeline_grader_enabled",
  "pipeline_max_attempts",
  "pipeline_max_fix_cycles",
  "projects_root",
  "prompt_token_budget",
  "review_provider_segregation",
  "session_chunk_retention_days",
  "spec_auto_rewrite",
  "test_file_patterns",
  "ui_locale",
  "usage_budget_usd_7d_claude",
  "usage_budget_usd_month",
  "verify_commands",
  "verify_timeout_ms",
  "visual_proof_enabled",
  "watchdog_threshold_minutes",
];

/**
 * Bases that also accept a `:<scope>` suffix — the per-project (and, for the
 * watchdog, per-agent-type) overrides written by the Full Auto popover, the
 * project settings page and the agents workshop.
 */
export const WRITABLE_SCOPED_SETTING_KEYS: readonly string[] = [
  "agent_max_concurrent",
  "auto_mode_build_agent",
  "auto_mode_build_concurrency",
  "auto_mode_enabled",
  "auto_mode_review_agent",
  "auto_mode_review_concurrency",
  "auto_mode_smart_dispatch",
  "ci_autofix_enabled",
  "full_auto_second_opinion",
  "night_circuit_breaker",
  "night_cost_cap_usd",
  "pipeline_enabled",
  "pipeline_grader_enabled",
  "pipeline_max_attempts",
  "pipeline_max_fix_cycles",
  "prompt_token_budget",
  "session_chunk_retention_days",
  "verify_commands",
  "verify_timeout_ms",
  "watchdog_threshold_minutes",
];

/**
 * Keys Arij defines but this route deliberately refuses, each for a reason
 * that is not "we forgot". Named rather than merely absent, so the coverage
 * test can tell an exclusion from an oversight.
 */
export const SERVER_MANAGED_SETTING_KEYS: readonly string[] = [
  // Bookkeeping written by the dreaming pass itself. A client that can move
  // the cutoff can make Dreaming re-read or skip an entire window.
  "dreaming_last_cutoff",
  // Who wrote the memory document last — a display record for the memory
  // panel, stamped by every write path. (A manual edit made mid-dream is
  // caught by the writers' `expectedPrevious` guard, not by this row.)
  "memory_provenance",
  // Marks of the one-shot trim of pre-cap history at boot
  // (lib/agent-sessions/raw-stream-backfill.ts): its completion, and the
  // single VACUUM it still owes. Clearing the first re-runs a full walk of
  // every raw stream; that is an operator's call, not a client's.
  "raw_stream_backfill_trimmed_at",
  "raw_stream_backfill_vacuum_due_at",
  // Capability credentials with their own guarded route
  // (`PUT /api/settings/webhooks`); `GET /api/settings` masks them.
  "webhook_url",
];

const WRITABLE = new Set(WRITABLE_SETTING_KEYS);
const SCOPABLE = new Set(WRITABLE_SCOPED_SETTING_KEYS);

/**
 * The only question the route asks. Exact matches on the bare list, or a
 * `<scopable base>:<non-empty scope>`.
 *
 * A `Set` lookup, not an object index, so `__proto__` and friends are ordinary
 * strings that are simply not in the list.
 */
export function isWritableSettingKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0) return false;
  if (WRITABLE.has(key)) return true;

  const separator = key.indexOf(":");
  if (separator <= 0) return false;

  const base = key.slice(0, separator);
  const scope = key.slice(separator + 1);
  return scope.length > 0 && SCOPABLE.has(base);
}
