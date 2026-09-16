"use client";

import { DeleteProjectSection } from "@/components/projects/DeleteProjectSection";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { RoutinesSettings } from "@/components/routines/RoutinesSettings";
import { McpServersSection } from "@/components/settings/McpServersSection";
import { PillButton } from "@/components/piscine";
import {
  PROMPT_TOKEN_BUDGET_GLOBAL_SETTING_KEY,
  promptTokenBudgetSettingKey,
  parsePromptTokenBudget,
} from "@/lib/tokens/budget-settings";

function ProjectTokenBudgetSection({ projectId }: { projectId: string }) {
  const t = useTranslations("ProjectSettings");
  const [budget, setBudget] = useState("");
  const [globalDefault, setGlobalDefault] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  const settingKey = promptTokenBudgetSettingKey(projectId);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({
      keys: `${settingKey},${PROMPT_TOKEN_BUDGET_GLOBAL_SETTING_KEY}`,
    });
    fetch(`/api/settings?${query.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error("settings read failed");
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        if (!d?.data || d.error) throw new Error("settings read failed");
        const projectVal = parsePromptTokenBudget(d?.data?.[settingKey]);
        setBudget(projectVal != null ? String(projectVal) : "");

        const globalVal = parsePromptTokenBudget(
          d?.data?.[PROMPT_TOKEN_BUDGET_GLOBAL_SETTING_KEY]
        );
        setGlobalDefault(globalVal);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setMessage(t("tokenBudget.loadFailed")); });
    return () => { cancelled = true; };
  }, [settingKey, t]);

  async function handleSave() {
    if (!loaded || pending.current) return;
    setSaving(true);
    setMessage(null);

    const raw = budget.trim();
    let val: number | null = null;
    if (raw !== "") {
      const parsed = parsePromptTokenBudget(raw);
      if (parsed === null || parsed <= 0) {
        setMessage(t("tokenBudget.invalid"));
        setSaving(false);
        return;
      }
      val = parsed;
    }

    pending.current = true;
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [settingKey]: val }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) {
        setMessage(t("tokenBudget.saveFailed"));
      } else {
        setBudget(val === null ? "" : String(val));
        setMessage(
          val === null ? t("tokenBudget.cleared") : t("tokenBudget.saved")
        );
      }
    } catch {
      setMessage(t("tokenBudget.saveFailed"));
    }
    // Trailing, not in a `finally` clause: the React Compiler stops at the
    // clause, and stopping left this component unread by every compiler rule.
    pending.current = false;
    setSaving(false);
  }

  return (
    <section
      className="space-y-4 rounded-[12px] border border-border/40 bg-card p-4"
      data-testid="project-prompt-budget-settings"
    >
      <div>
        <h3 className="text-base font-semibold">{t("tokenBudget.heading")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("tokenBudget.description")}
        </p>
      </div>

      <div className="space-y-1">
        <label
          htmlFor="project-prompt-token-budget-setting"
          className="block text-xs font-medium text-muted-foreground"
        >
          {t("tokenBudget.fieldLabel")}
        </label>
        <input
          id="project-prompt-token-budget-setting"
          data-testid="project-prompt-token-budget-setting"
          type="text"
          className="h-8 w-full rounded-[6px] border border-border/50 bg-background px-2.5 text-xs font-mono outline-none focus:border-primary"
          value={budget}
          disabled={!loaded || saving}
          placeholder={
            globalDefault != null
              ? t("tokenBudget.placeholderGlobal", {
                  // The raw digits, as the template literal printed them: a
                  // number argument would pick up locale grouping.
                  tokens: String(globalDefault),
                })
              : t("tokenBudget.placeholder")
          }
          onChange={(e) => setBudget(e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          {t("tokenBudget.hint")}
        </p>
      </div>

      <PillButton
        type="button"
        variant="filled"
        size="sm"
        onClick={handleSave}
        disabled={!loaded || saving}
        data-testid="project-prompt-token-budget-save"
      >
        {saving ? t("tokenBudget.savePending") : t("tokenBudget.save")}
      </PillButton>

      {message && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="project-prompt-token-budget-message"
        >
          {message}
        </p>
      )}
    </section>
  );
}

export default function ProjectSettingsPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  return (
    <div key={projectId} className="p-6 max-w-4xl space-y-6">
      <DeleteProjectSection projectId={projectId} />
      <ProjectTokenBudgetSection projectId={projectId} />
      <RoutinesSettings projectId={projectId} />
      {/* Project-scoped MCP servers, plus the globals this project inherits. */}
      <McpServersSection projectId={projectId} />
    </div>
  );
}
