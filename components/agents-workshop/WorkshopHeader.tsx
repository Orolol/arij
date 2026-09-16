"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { UnderlineTabNav, type UnderlineTabNavItem } from "@/components/piscine";
import type { TranslationKey } from "@/lib/i18n/catalogue";

import { FrictionsPill } from "./FrictionsPill";

/**
 * The workshop's SECOND ROW — the five tabs, and the Frictions pill on the
 * right.
 *
 * It lives in app/agents/layout.tsx so every tab shares one instance and the
 * tab bar never remounts on navigation.
 *
 * When a `?project=` query parameter is active, the workshop tabs (except `/usage`)
 * preserve the scoped project query across tab transitions.
 */
const TABS: ReadonlyArray<{
  href: string;
  labelKey: TranslationKey;
  exact?: boolean;
}> = [
  { href: "/agents", labelKey: "AgentsWorkshop.tabs.namedAgents", exact: true },
  { href: "/agents/assignments", labelKey: "AgentsWorkshop.tabs.assignments" },
  { href: "/agents/prompts", labelKey: "AgentsWorkshop.tabs.prompts" },
  { href: "/agents/limits", labelKey: "AgentsWorkshop.tabs.limits" },
  { href: "/usage", labelKey: "AgentsWorkshop.tabs.usage" },
];

function ScopedWorkshopTabNav({
  defaultTabs,
}: {
  defaultTabs: readonly UnderlineTabNavItem[];
}) {
  const searchParams = useSearchParams();
  const project = searchParams?.get("project")?.trim();

  const tabs = useMemo(() => {
    if (!project) return defaultTabs;
    return defaultTabs.map((tab) => {
      if (tab.href === "/usage") return tab;
      return {
        ...tab,
        href: `${tab.href}?project=${encodeURIComponent(project)}`,
      };
    });
  }, [defaultTabs, project]);

  return <UnderlineTabNav items={tabs} />;
}

export function WorkshopHeader() {
  const t = useTranslations();
  const tabs = useMemo(
    () =>
      TABS.map(({ labelKey, ...tab }) => ({
        ...tab,
        label: t(labelKey),
      })),
    [t],
  );

  return (
    <div
      data-testid="workshop-controls"
      className="flex h-[44px] shrink-0 items-center gap-[12px] px-[14px]"
    >
      <Suspense fallback={<UnderlineTabNav items={tabs} />}>
        <ScopedWorkshopTabNav defaultTabs={tabs} />
      </Suspense>
      <div className="ml-auto flex items-center gap-2">
        <Suspense fallback={null}>
          <FrictionsPill />
        </Suspense>
      </div>
    </div>
  );
}
