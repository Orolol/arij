import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/route-helpers";
import { refreshCodexUsageSnapshot } from "@/lib/usage/codex-snapshot";
import { getUsageReport } from "@/lib/usage/aggregate";
import {
  getClaudeQuotaCached,
  getCodexQuotaCached,
} from "@/lib/usage/quota-cache";

/**
 * GET /api/usage — one fat response. Single query param: `?fresh=1` bypasses
 * the quota cache TTL (the header Refresh button); a plain GET respects it.
 *
 * The two live pollers run in parallel and NEVER reject — null data means
 * "CLI unavailable / poll failed" and the report falls back to the existing
 * sources (rollout snapshot for codex, metered-via-Arij for claude), so a
 * poller failure is invisible except for the card falling back. Cold-cache
 * latency is bounded by the pollers' own 10s hard timeout; no shorter
 * route-level timeout is layered on top — that would orphan the shared
 * in-flight promise other requests may be joining.
 *
 * The codex rollout refresh stays a refresh-on-read, not a lifecycle hook:
 * Arij's own session logs never carry `rate_limits`, so the filesystem scan
 * remains the live poll's fallback source. Best-effort, never throws — a
 * missing `~/.codex` tree cannot break the page.
 */
export async function GET(request: Request) {
  try {
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const [claudeLive, codexLive] = await Promise.all([
      getClaudeQuotaCached(fresh), // never rejects; null data = fallback
      getCodexQuotaCached(fresh),
    ]);
    refreshCodexUsageSnapshot(); // best-effort, never throws
    return NextResponse.json({ data: getUsageReport({ claudeLive, codexLive }) });
  } catch (error) {
    return errorResponse(error, "Failed to load usage report");
  }
}
