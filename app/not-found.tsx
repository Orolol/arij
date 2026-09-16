import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PillButton } from "@/components/piscine";

export default async function NotFound() {
  const t = await getTranslations("ClientErrors");
  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-2xl font-bold tracking-tight text-foreground">
        {t("notFoundTitle")}
      </h2>
      <p className="max-w-[420px] text-sm text-muted-foreground">
        {t("notFoundDescription")}
      </p>
      <Link href="/">
        <PillButton variant="primary">
          {t("backToDesk")}
        </PillButton>
      </Link>
    </div>
  );
}
