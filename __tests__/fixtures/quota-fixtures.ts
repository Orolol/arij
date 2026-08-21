/**
 * Pinned protocol transcripts for the live-quota pollers (feat/live-quota).
 *
 * Captured verbatim from live probes on 2026-08-18 (claude 2.1.221, codex-cli
 * 0.141.0). Both protocols are official-but-experimental: these fixtures pin
 * today's wire shapes so a CLI upgrade surfaces as test-visible drift instead
 * of a runtime crash. ALL poller tests run against these (or an injected
 * null-resolving runner) — vitest NEVER spawns a real CLI, by contract.
 */

/** claude 2.1.221 get_usage — success. Includes real-world noise (init line) and
 *  churn keys (seven_day_cowork, tangelo, iguana_necktie) the parser MUST ignore. */
export const CLAUDE_USAGE_OK_NDJSON = [
  '{"type":"system","subtype":"init","cwd":"/home/user","session_id":"sess-1","model":"claude-opus-4-5"}',
  '{"type":"control_response","response":{"subtype":"success","request_id":"REQ_ID","response":{"subscription_type":"max","rate_limits_available":true,"rate_limits":{"five_hour":{"utilization":34,"resets_at":"2026-08-18T16:00:00+00:00"},"seven_day":{"utilization":61,"resets_at":"2026-08-21T09:00:00+00:00"},"seven_day_opus":{"utilization":12,"resets_at":"2026-08-21T09:00:00+00:00"},"seven_day_cowork":{"utilization":0,"resets_at":"2026-08-21T09:00:00+00:00"},"tangelo":true,"iguana_necktie":{"mode":"warp"}},"extra_usage":{"is_enabled":true,"monthly_limit":100,"used_credits":12.5,"utilization":12.5},"model_scoped":[{"display_name":"Opus 4.5","utilization":12,"resets_at":"2026-08-21T09:00:00+00:00"}]}}}',
].join("\n");
// Tests: parseClaudeQuota(CLAUDE_USAGE_OK_NDJSON.replaceAll("REQ_ID", rid), rid)

/** OAuth-less / --bare-style account: everything must gate to null. */
export const CLAUDE_USAGE_UNAVAILABLE_NDJSON =
  '{"type":"control_response","response":{"subtype":"success","request_id":"REQ_ID","response":{"subscription_type":"pro","rate_limits_available":false}}}';

/** Malformed: truncated JSON mid-stream (killed CLI). Parser => null, no throw. */
export const CLAUDE_USAGE_MALFORMED_NDJSON =
  '{"type":"system","subtype":"init"}\n{"type":"control_response","response":{"subtype":"success","requ';

/** codex 0.141.0 app-server — full frame sequence, mirrors probe_out.txt (responses
 *  carry no "jsonrpc" key; a notification interleaves; secondary null; multi-bucket). */
export const CODEX_FRAMES_OK: string[] = [
  '{"id":1,"result":{"userAgent":"arij/0.141.0 (Ubuntu 26.4.0; x86_64) unknown (arij; 0.1.0)","codexHome":"/home/user/.codex","platformFamily":"unix","platformOs":"linux"}}',
  '{"method":"remoteControl/status/changed","params":{"enabled":false}}',
  '{"id":2,"result":{"rateLimits":{"limitId":"codex","limitName":null,"primary":{"usedPercent":6,"windowDurationMins":10080,"resetsAt":1787671089},"secondary":null,"credits":{"hasCredits":false,"unlimited":false,"balance":"0"},"individualLimit":null,"planType":"prolite","rateLimitReachedType":null},"rateLimitsByLimitId":{"codex":{"limitId":"codex","limitName":null,"primary":{"usedPercent":6,"windowDurationMins":10080,"resetsAt":1787671089},"secondary":null,"credits":{"hasCredits":false,"unlimited":false,"balance":"0"},"individualLimit":null,"planType":"prolite","rateLimitReachedType":null},"codex_bengalfox":{"limitId":"codex_bengalfox","limitName":"GPT-5.3-Codex-Spark","primary":{"usedPercent":2,"windowDurationMins":10080,"resetsAt":1787671089},"secondary":null,"credits":null,"individualLimit":null,"planType":"prolite","rateLimitReachedType":null}},"rateLimitResetCredits":{"availableCount":0}}}',
  '{"id":3,"result":{"summary":{"lifetimeTokens":1383498631,"peakDailyTokens":146032481,"longestRunningTurnSec":5595,"currentStreakDays":0,"longestStreakDays":8},"dailyUsageBuckets":[{"startDate":"2026-08-15","tokens":26808416},{"startDate":"2026-08-16","tokens":69212904},{"startDate":"2026-08-17","tokens":41972937},{"startDate":"2026-08-18","tokens":20928692}]}}',
];

/** Historical dual-window shape: primary 300 / secondary 10080, single bucket,
 *  no rateLimitsByLimitId map (parser must fall back to top-level rateLimits). */
export const CODEX_FRAMES_DUAL_WINDOW: string[] = [
  '{"id":1,"result":{"userAgent":"arij/0.141.0","codexHome":"/home/user/.codex","platformFamily":"unix","platformOs":"linux"}}',
  '{"id":2,"result":{"rateLimits":{"limitId":"codex","limitName":null,"primary":{"usedPercent":1,"windowDurationMins":300,"resetsAt":1778890682},"secondary":{"usedPercent":0,"windowDurationMins":10080,"resetsAt":1779477482},"credits":null,"individualLimit":null,"planType":"plus","rateLimitReachedType":null}}}',
  '{"id":3,"result":{"summary":{"lifetimeTokens":627471,"peakDailyTokens":627471,"longestRunningTurnSec":100,"currentStreakDays":1,"longestStreakDays":1},"dailyUsageBuckets":[{"startDate":"2025-09-05","tokens":627471}]}}',
];

/** Timeout/no-response: handshake succeeded, reads never answered.
 *  parseCodexLiveQuota(...) => null; also test fetch* with a runner resolving null. */
export const CODEX_FRAMES_NO_RESPONSE: string[] = [
  '{"id":1,"result":{"userAgent":"arij/0.141.0","codexHome":"/home/user/.codex","platformFamily":"unix","platformOs":"linux"}}',
];
