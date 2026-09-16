"use client";

import { useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { BandHeader, Mono, SegmentedControl, StrataBand } from "@/components/piscine";
import type { UiLocale } from "@/lib/i18n/locales";
import { SettingsSection } from "./SettingsSection";

/**
 * THÈME — jour / nuit.
 *
 * NOT A SETTINGS KEY. The theme is `next-themes` in localStorage
 * (`attribute="class"`, `enableSystem={false}`); adding a database key would
 * create a second source of truth for a value the class attribute already
 * carries — and the two would disagree the first time someone opened a second
 * browser.
 *
 * The control is held until `mounted`, because `theme` is `undefined` on the
 * server render and the segment would flip on hydration.
 */
type ThemeSegment = "light" | "dark";
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function AppearanceBand() {
  const t = useTranslations("Settings");
  const { theme, setTheme } = useTheme();
  const activeLocale = useLocale() as UiLocale;
  const router = useRouter();
  const [locale, setLocale] = useState<UiLocale>(activeLocale);
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

  async function handleLocaleChange(next: UiLocale) {
    if (next === locale) return;
    setLocale(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ui_locale: next }),
      });
      router.refresh();
    } catch {
      // best-effort
    }
  }

  return (
    <SettingsSection
      testId="appearance-settings"
      heading={t("appearance.heading")}
    >
      <StrataBand stratum="card">
        <BandHeader stratum="card" label={t("appearance.label")} standalone />
        {mounted ? (
          <SegmentedControl<ThemeSegment>
            chrome="bordered"
            size="md"
            className="w-[240px]"
            options={[
              { value: "light", label: t("appearance.day") },
              { value: "dark", label: t("appearance.night") },
            ]}
            value={theme === "light" ? "light" : "dark"}
            onChange={(next) => setTheme(next)}
          />
        ) : null}
        <Mono size={10.5} tone="muted" as="div">
          {t("appearance.note")}
        </Mono>
      </StrataBand>

      <StrataBand stratum="card">
        <BandHeader stratum="card" label={t("appearance.languageLabel")} standalone />
        {mounted ? (
          <SegmentedControl<UiLocale>
            chrome="bordered"
            size="md"
            className="w-[240px]"
            options={[
              { value: "en", label: t("appearance.languageEn") },
              { value: "fr", label: t("appearance.languageFr") },
            ]}
            value={locale}
            onChange={(next) => void handleLocaleChange(next)}
          />
        ) : null}
        <Mono size={10.5} tone="muted" as="div">
          {t("appearance.languageNote")}
        </Mono>
      </StrataBand>
    </SettingsSection>
  );
}
