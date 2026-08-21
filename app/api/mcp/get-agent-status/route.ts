/**
 * POST /api/mcp/get-agent-status — the chat-toolset mcp__arij__get_agent_status
 * tool.
 *
 * Reads the token's project's live agent activity (running/queued build,
 * review and merge sessions, plus chat/spec/release activities) through the
 * canonical sessions/active route via the shared board-tool executor.
 */

import { z } from "zod";
import { createBoardToolRouteHandler } from "@/lib/mcp/board-tool-route";

const bodySchema = z.object({}).strict();

export const POST = createBoardToolRouteHandler("get_agent_status", bodySchema);
