"use client";

import { useTranslations } from "next-intl";

import { useCallback } from "react";

import { usePolledResource } from "@/hooks/usePolledResource";
import type { QaPayload } from "@/lib/qa/types";

/**
 * Frame 11b's single data source: one poll of `GET /api/qa/findings`.
 *
 * Shares request ordering and refresh invalidation with `useControlDesk`
 * through `usePolledResource`.
 *
 * THE INTERVAL IS 8 s, NOT 4 s. `better-sqlite3` is synchronous on ONE shared
 * connection, and the control desk already polls it every 4 s from the route
 * the user usually has open. QA is a secondary surface: a human arbitrating
 * findings does not need a 4 s refresh, and halving the frequency halves what
 * this screen costs the connection every other request shares.
 *
 * POLLING, NOT SSE, for the reason `hooks/useControlDesk.ts` documents:
 * `lib/events/bus.ts` has no wildcard room and only a per-project SSE
 * endpoint, so a cross-project screen would need one long-lived connection per
 * project and browsers cap those at about six per origin.
 *
 * @param projectId when set, the server applies the scope before history
 *                  limits and computes that project's coverage and totals.
 */
export function useQaFindings(
  projectId?: string | null,
  intervalMs = 8000,
): {
  data: QaPayload | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const tErrors = useTranslations("ClientErrors");
  const errorMessage = useCallback(
    (status?: number) => status === undefined
      ? tErrors("failedToLoadQA")
      : tErrors("qaHttp", { status }),
    [tErrors],
  );
  const scopedProjectId = projectId?.trim();
  const url = scopedProjectId
    ? `/api/qa/findings?${new URLSearchParams({ projectId: scopedProjectId })}`
    : "/api/qa/findings";
  return usePolledResource<QaPayload>(url, intervalMs, errorMessage);
}
