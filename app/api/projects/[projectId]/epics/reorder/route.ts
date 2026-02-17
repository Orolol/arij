import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { tryExportArjiJson } from "@/lib/sync/export";
import type { KanbanStatus } from "@/lib/types/kanban";
import { KANBAN_COLUMNS } from "@/lib/types/kanban";
import { validateTransition } from "@/lib/workflow/engine";
import { buildTransitionContext } from "@/lib/workflow/context";

interface ReorderItem {
  id: string;
  status: string;
  position: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body: { items: ReorderItem[] } = await request.json();

  if (!body.items || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Validate workflow rules for any status changes
  for (const item of body.items) {
    const epic = db.select().from(epics).where(eq(epics.id, item.id)).get();
    if (!epic) continue;

    const fromStatus = (epic.status ?? "backlog") as KanbanStatus;
    const toStatus = item.status as KanbanStatus;

    // Only validate if status is actually changing
    if (fromStatus !== toStatus) {
      if (!KANBAN_COLUMNS.includes(toStatus)) {
        return NextResponse.json(
          { error: `Invalid status: ${toStatus}` },
          { status: 400 }
        );
      }

      const ctx = buildTransitionContext({
        epicId: item.id,
        fromStatus,
        toStatus,
        actor: "user",
      });
      const result = validateTransition(ctx);
      if (!result.valid) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }
    }
  }

  // Use a transaction for atomic reorder
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  const transaction = sqlite.transaction(() => {
    for (const item of body.items) {
      db.update(epics)
        .set({
          status: item.status,
          position: item.position,
          updatedAt: now,
        })
        .where(eq(epics.id, item.id))
        .run();
    }
  });

  transaction();

  tryExportArjiJson(projectId);
  return NextResponse.json({ data: { updated: body.items.length } });
}
