/**
 * POST /api/mcp/list-tickets — the chat-toolset mcp__arij__list_tickets tool.
 *
 * Runs the shared board-tool executor (lib/chat/board-tools.ts), so CLI chat
 * sessions read exactly the board summary fast mode does: per-column counts,
 * budget-bounded rows with active columns first, omitted tail counted.
 */

import { z } from "zod";
import { ALL_STATUSES } from "@/lib/chat/board-tools";
import { createBoardToolRouteHandler } from "@/lib/mcp/board-tool-route";

const bodySchema = z
  .object({
    status: z.enum(ALL_STATUSES).optional(),
  })
  .strict();

export const POST = createBoardToolRouteHandler("list_tickets", bodySchema);
