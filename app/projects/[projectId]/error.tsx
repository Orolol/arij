"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PillButton } from "@/components/piscine";

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("ClientErrors");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4 p-6 text-center">
      <h3 className="text-lg font-semibold text-foreground">
        {t("projectErrorTitle")}
      </h3>
      <p className="max-w-[400px] text-xs text-muted-foreground">
        {t("projectErrorDescription")}
      </p>
      <div className="flex items-center gap-2">
        <PillButton variant="primary" size="sm" onClick={() => reset()}>
          {t("tryAgain")}
        </PillButton>
        <Link href="/">
          <PillButton variant="secondary" size="sm">
            {t("backToDesk")}
          </PillButton>
        </Link>
      </div>
    </div>
  );
}
