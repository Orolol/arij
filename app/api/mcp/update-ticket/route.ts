/**
 * POST /api/mcp/update-ticket — the chat-toolset mcp__arij__update_ticket
 * tool.
 *
 * Edits title/description/priority through the canonical PATCH epics route;
 * status moves stay with update-ticket-status (workflow-validated). The
 * ticket must live in the token's project (readable ids accepted).
 */

import { z } from "zod";
import { createBoardToolRouteHandler } from "@/lib/mcp/board-tool-route";

const bodySchema = z
  .object({
    ticket_id: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    priority: z.number().int().min(0).max(3).optional(),
  })
  .strict();

export const POST = createBoardToolRouteHandler("update_ticket", bodySchema);
