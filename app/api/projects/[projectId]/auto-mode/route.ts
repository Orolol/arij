import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  errorResponse,
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { resolveMaxConcurrentForProject } from "@/lib/agents/scheduler";
import {
  autoModeBuildAgentSettingKey,
  autoModeBuildConcurrencySettingKey,
  autoModeEnabledSettingKey,
  autoModeReviewAgentSettingKey,
  autoModeReviewConcurrencySettingKey,
  parseAutoModeAgent,
  parseAutoModeConcurrency,
  parseAutoModeEnabled,
} from "@/lib/auto-mode/constants";
import { resolveAutoModeConfigForProject } from "@/lib/auto-mode/config";
import { autoModeRegistry } from "@/lib/auto-mode/registry";
import { kickAutoMode } from "@/lib/auto-mode/engine";
import {
  loadAutoModeBoard,
  selectBuildCandidates,
  selectMergeCandidates,
  selectReviewCandidates,
} from "@/lib/auto-mode/select";
import type { AutoModeStatus } from "@/lib/auto-mode/status";

/**
 * GET/PUT /api/projects/[projectId]/auto-mode
 *
 * The dialog's whole contract: the five persisted settings, the scheduler
 * budget they have to live inside, and a live picture of what the supervisor
 * is doing (in-flight counts, candidate counts, parked tickets, recent
 * dispatches).
 *
 * PUT writes the settings and kicks an immediate sweep — enabling the mode
 * must not feel like it did nothing for up to 15 seconds.
 */

/** Builds the response payload shared by GET and PUT. */
function buildStatus(projectId: string): AutoModeStatus {
  const config = resolveAutoModeConfigForProject(projectId);
  const snapshot = autoModeRegistry.snapshot(projectId);

  // Candidate counts are informational; a broken board read must not 500 the
  // dialog, so they degrade to zero rather than throw.
  let candidates = { build: 0, review: 0, merge: 0 };
  try {
    const board = loadAutoModeBoard(projectId);
    candidates = {
      build: selectBuildCandidates(projectId, board).length,
      review: selectReviewCandidates(projectId, board).length,
      merge: selectMergeCandidates(projectId, board).length,
    };
  } catch (error) {
    console.warn(
      "[auto-mode/route] Failed to count candidates:",
      error instanceof Error ? error.message : error
    );
  }

  return {
    enabled: config.enabled,
    buildAgent: config.buildAgent,
    buildConcurrency: config.buildConcurrency,
    reviewAgent: config.reviewAgent,
    reviewConcurrency: config.reviewConcurrency,
    effectiveSchedulerBudget: resolveMaxConcurrentForProject(projectId),
    running: snapshot.enabled,
    lastSweepAt: snapshot.lastSweepAt,
    inFlight: snapshot.inFlight,
    candidates,
    parked: snapshot.parked,
    recentDispatches: snapshot.recentDispatches,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  try {
    return NextResponse.json({ data: buildStatus(projectId) });
  } catch (error) {
    return errorResponse(error, "Failed to read auto mode status");
  }
}

/** Upserts one settings row, JSON-encoded exactly like PATCH /api/settings. */
function putSetting(key: string, value: unknown): void {
  const jsonValue = JSON.stringify(value);
  const now = new Date().toISOString();
  const existing = db
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.key, key))
    .get();

  if (existing) {
    db.update(settings)
      .set({ value: jsonValue, updatedAt: now })
      .where(eq(settings.key, key))
      .run();
  } else {
    db.insert(settings).values({ key, value: jsonValue, updatedAt: now }).run();
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid payload. Send a JSON object of auto mode settings." },
      { status: 400 }
    );
  }

  const payload = body as Record<string, unknown>;

  try {
    // Every field is optional so the dialog can toggle the switch without
    // resending the whole form. Values go through the same parsers the
    // resolver uses, so a clamp applies at write time as well as read time.
    if ("enabled" in payload) {
      const enabled = parseAutoModeEnabled(payload.enabled);
      if (enabled === null) {
        return NextResponse.json(
          { error: "`enabled` must be a boolean." },
          { status: 400 }
        );
      }
      putSetting(autoModeEnabledSettingKey(projectId), enabled);
    }

    if ("buildAgent" in payload) {
      putSetting(
        autoModeBuildAgentSettingKey(projectId),
        parseAutoModeAgent(payload.buildAgent)
      );
    }
    if ("reviewAgent" in payload) {
      putSetting(
        autoModeReviewAgentSettingKey(projectId),
        parseAutoModeAgent(payload.reviewAgent)
      );
    }

    if ("buildConcurrency" in payload) {
      const value = parseAutoModeConcurrency(payload.buildConcurrency);
      if (value === null) {
        return NextResponse.json(
          { error: "`buildConcurrency` must be an integer between 0 and 10." },
          { status: 400 }
        );
      }
      putSetting(autoModeBuildConcurrencySettingKey(projectId), value);
    }

    if ("reviewConcurrency" in payload) {
      const value = parseAutoModeConcurrency(payload.reviewConcurrency);
      if (value === null) {
        return NextResponse.json(
          { error: "`reviewConcurrency` must be an integer between 0 and 10." },
          { status: 400 }
        );
      }
      putSetting(autoModeReviewConcurrencySettingKey(projectId), value);
    }

    const status = buildStatus(projectId);

    // Enabling (or retuning) takes effect now, not on the next 15s tick.
    // Disabling also sweeps: that pass is what clears the registry state.
    kickAutoMode(projectId);

    return NextResponse.json({ data: status });
  } catch (error) {
    return errorResponse(error, "Failed to update auto mode settings");
  }
}
