import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationReadCursor } from "@/lib/db/schema";

export async function POST() {
  const now = new Date().toISOString();

  // Single-row cursor (id is always 1): insert it, or move it forward.
  db.insert(notificationReadCursor)
    .values({ id: 1, readAt: now })
    .onConflictDoUpdate({
      target: notificationReadCursor.id,
      set: { readAt: now },
    })
    .run();

  return NextResponse.json({ data: { ok: true } });
}
