"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function GlobalError({
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
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center font-sans text-foreground">
        <h2 className="text-2xl font-bold">{t("globalErrorTitle")}</h2>
        <p className="max-w-[420px] text-sm text-muted-foreground">
          {t("globalErrorDescription")}
        </p>
        <button
          onClick={() => reset()}
          className="rounded-full bg-action px-4 py-2 text-sm font-medium text-action-foreground"
        >
          {t("tryAgain")}
        </button>
      </body>
    </html>
  );
}
