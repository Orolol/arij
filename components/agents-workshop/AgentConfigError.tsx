"use client";

import { useTranslations } from "next-intl";
import { PillButton } from "@/components/piscine";

export function AgentConfigError({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const t = useTranslations("AgentsWorkshop");
  return (
    <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
      <span>{t("common.loadFailed")}</span>
      <PillButton variant="outline" outlineTone="neutral" size="sm" onClick={() => void onRetry()}>
        {t("common.retry")}
      </PillButton>
    </div>
  );
}
