"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PillButton } from "@/components/piscine";

export default function Error({
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
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-2xl font-bold tracking-tight text-foreground">
        {t("errorTitle")}
      </h2>
      <p className="max-w-[420px] text-sm text-muted-foreground">
        {t("errorDescription")}
      </p>
      <div className="flex items-center gap-3">
        <PillButton variant="primary" onClick={() => reset()}>
          {t("tryAgain")}
        </PillButton>
        <Link href="/">
          <PillButton variant="secondary">
            {t("backToDesk")}
          </PillButton>
        </Link>
      </div>
    </div>
  );
}
