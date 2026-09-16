import { eq } from "drizzle-orm";
import { db, type ArijDatabase } from "@/lib/db";
import { settings } from "@/lib/db/schema";
export function upsertSetting(key: string, value: unknown, connection: Pick<ArijDatabase, "select" | "update" | "insert"> = db) {
  const encoded = { value: JSON.stringify(value), updatedAt: new Date().toISOString() };
  const existing = connection.select({ key: settings.key }).from(settings).where(eq(settings.key, key)).get();
  if (existing) connection.update(settings).set(encoded).where(eq(settings.key, key)).run();
  else connection.insert(settings).values({ key, ...encoded }).run();
}
