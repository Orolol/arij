"use client";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { usePolledResource } from "@/hooks/usePolledResource";
import type { UsageRange, UsageReport } from "@/lib/types/usage";
export function useUsage() {
  const t = useTranslations("ClientErrors");
  const [range, setRange] = useState<UsageRange>("30d");
  const url = range === "30d" ? "/api/usage" : `/api/usage?range=${range}`;
  const errorMessage = useCallback(() => t("failedToLoadTheUsageReport"), [t]);
  const resource = usePolledResource<UsageReport>(url, null, errorMessage);
  const { reload: resourceReload } = resource;
  const refresh = useCallback(async (options?: { fresh?: boolean }) => {
    await resourceReload(options?.fresh ? `${url}${url.includes("?") ? "&" : "?"}fresh=1` : undefined);
  }, [resourceReload, url]);
  return { report: resource.data, loading: resource.loading, error: resource.error, range, setRange, refresh };
}
