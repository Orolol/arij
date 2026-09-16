import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { documentImageAbsolutePath, projectDocumentsDirectory } from "@/lib/documents/document-paths";
import { isStoredPathWithin } from "@/lib/storage/stored-path";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".tiff": "image/tiff" };
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  const { projectId, documentId } = await params;
  const missing = () => NextResponse.json({ error: "Document image not found" }, { status: 404 });
  const doc = db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.projectId, projectId))).get();
  if (!doc || doc.kind !== "image") return missing();
  const candidate = documentImageAbsolutePath(doc.imagePath);
  if (!candidate) return missing();
  try {
    const root = fs.realpathSync(projectDocumentsDirectory(projectId));
    const file = fs.realpathSync(candidate);
    if (!isStoredPathWithin(root, file) || !fs.statSync(file).isFile()) return missing();
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) return missing();
    return new NextResponse(new Uint8Array(fs.readFileSync(file)), { headers: {
      "Content-Type": mime, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-cache",
    } });
  } catch { return missing(); }
}
