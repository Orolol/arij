/**
 * POST /api/mcp/start-build — the chat-toolset mcp__arij__start_build tool.
 *
 * Launches a build agent on a ticket through the canonical build route, so
 * every guard applies unchanged: buildable-column check, one-agent-per-ticket
 * 409, worktree/branch creation, session bookkeeping. The tool description
 * (bin/arij-mcp.mjs) orders the model to ask the user first unless the build
 * was clearly requested.
 */

import { z } from "zod";
import { createBoardToolRouteHandler } from "@/lib/mcp/board-tool-route";

const bodySchema = z
  .object({
    ticket_id: z.string().min(1),
    comment: z.string().optional(),
  })
  .strict();

export const POST = createBoardToolRouteHandler("start_build", bodySchema);
