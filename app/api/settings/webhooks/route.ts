import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, settings } from "@/lib/db/schema";
import { errorResponse, getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { isValidationError, validateBody } from "@/lib/validation/validate";
import { updateProjectWebhookSchema } from "@/lib/validation/webhook-schemas";
import {
  parseWebhookUrl,
  projectIdFromWebhookSettingKey,
  webhookSettingKey,
} from "@/lib/webhooks/send";

export interface ProjectWebhookEntry {
  projectId: string;
  projectName: string;
  /** Empty string when no webhook is configured. */
  url: string;
}

/** GET — every project with its configured webhook URL (or ""). */
export async function GET() {
  try {
    const projectRows = db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .orderBy(projects.name)
      .all();

    const urlByProjectId = new Map<string, string>();
    for (const row of db.select().from(settings).all()) {
      if (typeof row?.key !== "string") continue;
      const projectId = projectIdFromWebhookSettingKey(row.key);
      if (!projectId) continue;
      const url = parseWebhookUrl(row.value);
      if (url) urlByProjectId.set(projectId, url);
    }

    const webhooks: ProjectWebhookEntry[] = projectRows.map((project) => ({
      projectId: project.id,
      projectName: project.name,
      url: urlByProjectId.get(project.id) ?? "",
    }));

    return NextResponse.json({ data: { webhooks } });
  } catch (error) {
    return errorResponse(error, "Failed to load webhooks");
  }
}

/** PUT — set (or clear, with an empty url) one project's webhook URL. */
export async function PUT(request: NextRequest) {
  const validated = await validateBody(updateProjectWebhookSchema, request);
  if (isValidationError(validated)) return validated;

  const { projectId } = validated.data;
  const url = validated.data.url.trim();

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const key = webhookSettingKey(projectId);

  try {
    if (url.length === 0) {
      db.delete(settings).where(eq(settings.key, key)).run();
      return NextResponse.json({ data: { projectId, url: "" } });
    }

    const now = new Date().toISOString();
    const value = JSON.stringify(url);
    const existing = db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get();

    if (existing) {
      db.update(settings)
        .set({ value, updatedAt: now })
        .where(eq(settings.key, key))
        .run();
    } else {
      db.insert(settings).values({ key, value, updatedAt: now }).run();
    }

    return NextResponse.json({ data: { projectId, url } });
  } catch (error) {
    return errorResponse(error, "Failed to save webhook URL");
  }
}
