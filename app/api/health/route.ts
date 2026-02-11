import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

export async function GET() {
  let dbOk = false;
  try {
    db.select().from(settings).limit(1).all();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return NextResponse.json({
    status: dbOk ? "ok" : "error",
    db: dbOk,
    timestamp: new Date().toISOString(),
  });
}
