import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, sqlite } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam || "50", 10) || 50, 1), 200);

  const rows = db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all();

  // Compute unread count: notifications where created_at > read cursor
  const cursor = sqlite
    .prepare("SELECT read_at FROM notification_read_cursor WHERE id = 1")
    .get() as { read_at: string } | undefined;

  let unreadCount: number;
  if (cursor) {
    const result = sqlite
      .prepare("SELECT COUNT(*) AS cnt FROM notifications WHERE created_at > ?")
      .get(cursor.read_at) as { cnt: number };
    unreadCount = result.cnt;
  } else {
    const result = sqlite
      .prepare("SELECT COUNT(*) AS cnt FROM notifications")
      .get() as { cnt: number };
    unreadCount = result.cnt;
  }

  return NextResponse.json({ data: rows, unreadCount });
}
