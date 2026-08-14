import { NextResponse } from "next/server";
import { count, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationReadCursor, notifications } from "@/lib/db/schema";

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
  // (no cursor row yet => everything is unread).
  const cursor = db
    .select({ readAt: notificationReadCursor.readAt })
    .from(notificationReadCursor)
    .where(eq(notificationReadCursor.id, 1))
    .get();

  const unread = db
    .select({ cnt: count() })
    .from(notifications)
    .where(cursor ? gt(notifications.createdAt, cursor.readAt) : undefined)
    .get();

  const unreadCount = unread?.cnt ?? 0;

  return NextResponse.json({ data: { notifications: rows, unreadCount } });
}
