import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { tryExportArjiJson } from "@/lib/sync/export";

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
