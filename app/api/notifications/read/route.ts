import { NextResponse } from "next/server";
import { sqlite } from "@/lib/db";

export async function POST() {
  const now = new Date().toISOString();

  sqlite
    .prepare(
      "INSERT OR REPLACE INTO notification_read_cursor (id, read_at) VALUES (1, ?)"
    )
    .run(now);

  return NextResponse.json({ ok: true });
}
