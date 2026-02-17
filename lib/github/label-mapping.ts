import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface LabelMapping {
  featureLabels: string[];
  bugLabels: string[];
}

const DEFAULT_MAPPING: LabelMapping = {
  featureLabels: ["feature", "enhancement", "epic"],
  bugLabels: ["bug", "defect", "error"],
};

/**
 * Retrieves the label mapping for a given project, falling back to global then default.
 *
 * Lookup order: project-specific -> global -> hardcoded default.
 */
export function getLabelMapping(projectId?: string): LabelMapping {
  const keys = projectId
    ? [`label_mapping:${projectId}`, "label_mapping"]
    : ["label_mapping"];

  for (const key of keys) {
    const row = db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get();

    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as Partial<LabelMapping>;
        return {
          featureLabels: parsed.featureLabels || DEFAULT_MAPPING.featureLabels,
          bugLabels: parsed.bugLabels || DEFAULT_MAPPING.bugLabels,
        };
      } catch {
        // Invalid JSON, fall through to next key
      }
    }
  }

  return DEFAULT_MAPPING;
}

/**
 * Persists the label mapping. If projectId is provided, saves as project-scoped;
 * otherwise saves as the global mapping.
 */
export function saveLabelMapping(
  mapping: LabelMapping,
  projectId?: string
): void {
  const key = projectId ? `label_mapping:${projectId}` : "label_mapping";
  const value = JSON.stringify(mapping);

  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

/**
 * Maps a set of GitHub issue labels to a ticket type using the provided mapping.
 */
export function mapIssueTypeWithMapping(
  labels: string[],
  mapping: LabelMapping
): "feature" | "bug" {
  const lower = new Set(labels.map((v) => v.toLowerCase()));

  if (mapping.bugLabels.some((label) => lower.has(label.toLowerCase()))) {
    return "bug";
  }

  if (mapping.featureLabels.some((label) => lower.has(label.toLowerCase()))) {
    return "feature";
  }

  return "feature";
}
