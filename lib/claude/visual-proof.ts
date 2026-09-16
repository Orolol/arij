import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

import {
  VISUAL_PROOF_ENABLED_SETTING_KEY,
  parseVisualProofEnabledSetting,
} from "./visual-proof-constants";

export {
  VISUAL_PROOF_ENABLED_SETTING_KEY,
  parseVisualProofEnabledSetting,
};

/** Read the global tri-state setting. Missing or malformed means OFF. */
export function isVisualProofEnabled(): boolean {
  try {
    const row = db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, VISUAL_PROOF_ENABLED_SETTING_KEY))
      .get();

    return row
      ? (parseVisualProofEnabledSetting(row.value) ?? false)
      : false;
  } catch {
    // Prompt creation must remain usable if settings cannot be read. Since
    // visual proof is opt-in and non-blocking, the safe fallback is OFF.
    return false;
  }
}
