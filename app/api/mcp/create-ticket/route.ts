/**
 * POST /api/mcp/create-ticket — the chat-toolset mcp__arij__create_ticket
 * tool.
 *
 * Runs the shared board-tool executor, which creates the ticket through the
 * canonical POST /api/projects/:id/epics route — readable ids, SSE board
 * events, activity log and arji.json export all fire like a UI creation.
 * The token decides the target project; the body cannot widen it.
 */

import { z } from "zod";
import { WRITABLE_STATUSES } from "@/lib/chat/board-tools";
import { createBoardToolRouteHandler } from "@/lib/mcp/board-tool-route";

const bodySchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    type: z.enum(["feature", "bug"]).optional(),
    priority: z.number().int().min(0).max(3).optional(),
    status: z.enum(WRITABLE_STATUSES).optional(),
    user_stories: z
      .array(
        z
          .object({
            title: z.string().min(1),
            description: z.string().optional(),
            acceptance_criteria: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const POST = createBoardToolRouteHandler("create_ticket", bodySchema);
