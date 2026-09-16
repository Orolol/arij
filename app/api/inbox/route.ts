import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readInboxPage } from "@/lib/inbox/read";
import { INBOX_PAGE_SIZE } from "@/lib/inbox/types";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const page = Number(query.get("page") ?? 1);
  const pageSize = Number(query.get("limit") ?? INBOX_PAGE_SIZE);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return NextResponse.json({ error: "Invalid inbox pagination" }, { status: 400 });
  }
  return NextResponse.json({ data: readInboxPage(db, page, pageSize, query.get("summary") === "1") });
}
