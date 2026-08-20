/**
 * Shared POST handler factory for the /api/mcp/* board-tool routes
 * (list-tickets, create-ticket, update-ticket, get-agent-status,
 * start-build) that give CLI chat sessions parity with the fast-mode board
 * tools.
 *
 * Each route authenticates with the standard MCP bearer token and then runs
 * the SAME executor the fast-mode chat loop uses
 * (CHAT_BOARD_TOOL_EXECUTORS in lib/chat/board-tools.ts) — mutations flow
 * through Arij's canonical HTTP routes, so workflow guards, SSE board
 * events, activity log and arji.json export all fire identically on both
 * surfaces. The token (never the body) decides the project scope, exactly
 * like the ticket-scoped MCP routes.
 *
 * Executor results are LLM-facing JSON strings ({...} on success, {error,
 * detail?} on failure); this wrapper maps them onto the MCP envelope the
 * shim expects: `{ data }` with 2xx, `{ error, code? }` with the upstream
 * status (default 400) otherwise.
 */

import { NextRequest, NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import { isErrorResponse } from "@/lib/api/route-helpers";
import { validateBody } from "@/lib/validation/validate";
import { requireMcpToken } from "@/lib/mcp/http-auth";
import {
  CHAT_BOARD_TOOL_EXECUTORS,
  type ChatBoardToolContext,
} from "@/lib/chat/board-tools";

interface BoardToolFailure {
  error: string;
  detail?: { code?: unknown; status?: unknown };
}

function isBoardToolFailure(value: unknown): value is BoardToolFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

export function createBoardToolRouteHandler<T extends Record<string, unknown>>(
  toolName: string,
  bodySchema: ZodSchema<T>,
): (request: NextRequest) => Promise<NextResponse> {
  const executor = CHAT_BOARD_TOOL_EXECUTORS[toolName];
  if (!executor) {
    throw new Error(`Unknown board tool: ${toolName}`);
  }

  return async function POST(request: NextRequest): Promise<NextResponse> {
    const auth = requireMcpToken(request);
    if (isErrorResponse(auth)) return auth;

    const validated = await validateBody(bodySchema, request);
    if (isErrorResponse(validated)) return validated;

    const ctx: ChatBoardToolContext = {
      projectId: auth.projectId,
      // The shim reached us at this origin, so the executor's internal
      // fetches to the canonical routes are loopback calls to the same app.
      baseUrl: new URL(request.url).origin,
      mcpToken: auth.token,
      signal: request.signal,
    };

    const parsed: unknown = JSON.parse(await executor(validated.data, ctx));

    if (isBoardToolFailure(parsed)) {
      const status =
        typeof parsed.detail?.status === "number" ? parsed.detail.status : 400;
      const code = typeof parsed.detail?.code === "string" ? parsed.detail.code : undefined;
      return NextResponse.json(
        { error: parsed.error, ...(code ? { code } : {}) },
        { status },
      );
    }

    return NextResponse.json({ data: parsed });
  };
}
