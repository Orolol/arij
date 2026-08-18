import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/route-helpers";
import { refreshCodexUsageSnapshot } from "@/lib/usage/codex-snapshot";
import { getUsageReport } from "@/lib/usage/aggregate";

/**
 * GET /api/usage — one fat response, no query params (single consumer).
 *
 * The codex quota refresh is a refresh-on-read, not a lifecycle hook: Arij's
 * own session logs never carry `rate_limits`, so the only source is the
 * filesystem, and scanning it here also picks up the user's INTERACTIVE codex
 * sessions instead of only Arij-spawned ones. It is best-effort and never
 * throws, so a missing `~/.codex` tree cannot break the page.
 */
export async function GET() {
  try {
    refreshCodexUsageSnapshot(); // best-effort, never throws
    return NextResponse.json({ data: getUsageReport() });
  } catch (error) {
    return errorResponse(error, "Failed to load usage report");
  }
}
