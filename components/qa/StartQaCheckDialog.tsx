"use client";

import { PillButton } from "@/components/piscine";
import { useCallback, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, Play, Save, X } from "lucide-react";
import { NamedAgentSelect } from "@/components/shared/NamedAgentSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TranslationKey } from "@/lib/i18n/catalogue";
import { requestJson } from "@/lib/api/client";
import { usePolledResource } from "@/hooks/usePolledResource";
import { useScopedMutation } from "@/hooks/useScopedMutation";
import { TELESCOPE_MAX_WINDOW_DAYS } from "@/lib/telescope/constants";

type CheckType = "tech_check" | "e2e_test" | "failure_digest";

interface QaPrompt {
  id: string;
  name: string;
  prompt: string;
}

interface StartQaCheckDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted?: (data: {
    reportId: string;
    sessionId: string | null;
    noOp?: boolean;
  }) => void;
}

/**
 * A module-scope copy table, so it holds catalogue KEY REFERENCES and the
 * dialog resolves them at render with the namespace-less translator
 * (`lib/i18n/catalogue.ts`, pattern 3).
 *
 * `nameKey` is the bare check name ("Tech Check"). It exists so the failure
 * message does not have to derive one by stripping "Start " off the title — a
 * string surgery that only works in English.
 */
const CHECK_TYPE_CONFIG: Record<
  CheckType,
  { nameKey: TranslationKey; titleKey: TranslationKey; descriptionKey: TranslationKey }
> = {
  tech_check: {
    nameKey: "Qa.checkTypes.techCheck.name",
    titleKey: "Qa.checkTypes.techCheck.title",
    descriptionKey: "Qa.checkTypes.techCheck.description",
  },
  e2e_test: {
    nameKey: "Qa.checkTypes.e2eTest.name",
    titleKey: "Qa.checkTypes.e2eTest.title",
    descriptionKey: "Qa.checkTypes.e2eTest.description",
  },
  failure_digest: {
    nameKey: "Qa.checkTypes.failureDigest.name",
    titleKey: "Qa.checkTypes.failureDigest.title",
    descriptionKey: "Qa.checkTypes.failureDigest.description",
  },
};

export function StartQaCheckDialog(props: StartQaCheckDialogProps) {
  return props.open ? <QaCheckForm key={props.projectId} {...props} /> : null;
}

function QaCheckForm({
  projectId,
  open,
  onOpenChange,
  onStarted,
}: StartQaCheckDialogProps) {
  const t = useTranslations("Qa");
  // The check-type table holds full dotted paths, so it resolves through the
  // namespace-less translator.
  const tKey = useTranslations();
  // The dialog is a reusable component, so the field ids are generated rather
  // than static — two mounted copies would otherwise share them and every
  // label would point at the first copy's controls.
  const fieldId = useId();
  const checkTypeId = `${fieldId}-check-type`;
  const namedAgentFieldId = `${fieldId}-named-agent`;
  const namedAgentHintId = `${fieldId}-named-agent-hint`;
  const savedPromptId = `${fieldId}-saved-prompt`;
  const customPromptFieldId = `${fieldId}-custom-prompt`;

  const [checkType, setCheckType] = useState<CheckType>("tech_check");
  const [namedAgentId, setNamedAgentId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [customPromptId, setCustomPromptId] = useState<string | null>(null);
  const [savePromptName, setSavePromptName] = useState("");
  const [failureDigestWindowDays, setFailureDigestWindowDays] = useState("14");
  const loadErrorMessage = useCallback(() => t("checkDialog.errors.loadPrompts"), [t]);
  const { data: promptData, loading: loadingPrompts, error: loadError, refresh: loadPrompts, updateData } = usePolledResource<QaPrompt[]>(
    "/api/qa/prompts", null, loadErrorMessage, { validateData: Array.isArray },
  );
  const prompts = promptData ?? [];
  const { run, pending, error: mutationError, clearError } = useScopedMutation(projectId);
  const [action, setAction] = useState<"save" | "start" | null>(null);
  const savingPrompt = pending && action === "save";
  const starting = pending && action === "start";
  const error = mutationError || loadError;

  function resetForm() {
    setCheckType("tech_check");
    setNamedAgentId(null);
    setCustomPrompt("");
    setCustomPromptId(null);
    setSavePromptName("");
    setFailureDigestWindowDays("14");
    clearError();
  }

  async function handleSavePrompt() {
    const name = savePromptName.trim();
    const prompt = customPrompt.trim();
    if (!name || !prompt || !promptData) return;
    const saved = await run(async () => {
      setAction("save");
      const result = await requestJson<QaPrompt>("/api/qa/prompts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, prompt }), errorMessage: t("checkDialog.errors.savePrompt"),
      });
      if (result.error !== null) throw new Error(result.error);
      updateData((current) => [...(current ?? []), result.data]);
      return result.data;
    }, t("checkDialog.errors.savePrompt"));
    if (saved) {
      setSavePromptName("");
      setCustomPromptId(saved.id);
    }
  }

  async function mutatePreset(method: "PATCH" | "DELETE") {
    const selected = prompts.find((prompt) => prompt.id === customPromptId);
    if (!selected) return;
    const changed = await run(async () => {
      setAction("save");
      const result = await requestJson(`/api/qa/prompts/${selected.id}`, { method,
        headers: { "Content-Type": "application/json" },
        ...(method === "PATCH" ? { body: JSON.stringify({ name: savePromptName.trim() || selected.name, prompt: customPrompt.trim() }) } : {}),
        errorMessage: t("checkDialog.errors.savePrompt"),
      });
      if (result.error) throw new Error(result.error);
      await loadPrompts();
      return true;
    }, t("checkDialog.errors.savePrompt"));
    if (changed && method === "DELETE") setCustomPromptId(null);
  }

  function handlePromptSelect(value: string) {
    if (value === "__none__") {
      setCustomPromptId(null);
      return;
    }

    const selected = prompts.find((prompt) => prompt.id === value);
    if (!selected) return;
    setCustomPromptId(selected.id);
    setCustomPrompt(selected.prompt);
  }

  async function handleStart() {
    const result = await run(async () => {
      setAction("start");
      const response = await requestJson<Parameters<NonNullable<StartQaCheckDialogProps["onStarted"]>>[0]>(
        `/api/projects/${projectId}/qa/check`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ namedAgentId, customPrompt, customPromptId, checkType,
            ...(checkType === "failure_digest" ? { windowDays: Number(failureDigestWindowDays) } : {}),
          }),
          errorMessage: t("checkDialog.errors.start", { checkType: tKey(config.nameKey) }),
        },
      );
      if (response.error !== null) throw new Error(response.error);
      return response.data;
    }, t("checkDialog.errors.start", { checkType: tKey(config.nameKey) }));
    if (result) {
      onStarted?.(result);
      onOpenChange(false);
      resetForm();
    }
  }

  const config = CHECK_TYPE_CONFIG[checkType];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          resetForm();
        }
      }}
    >
      <DialogContent className="sm:max-w-[680px] rounded-[14px] shadow-[0_18px_40px_rgba(58,48,44,.14)]">
        <DialogHeader>
          <DialogTitle>{tKey(config.titleKey)}</DialogTitle>
          <DialogDescription>{tKey(config.descriptionKey)}</DialogDescription>
        </DialogHeader>

        <fieldset disabled={pending} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <label
              htmlFor={checkTypeId}
              className="text-[12.5px] text-muted-foreground"
            >
              {t("checkDialog.checkTypeLabel")}
            </label>
            <Select
              value={checkType}
              onValueChange={(value) => setCheckType(value as CheckType)}
            >
              <SelectTrigger
                id={checkTypeId}
                className="h-[34px] rounded-[8px] text-[13px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tech_check">
                  {tKey(CHECK_TYPE_CONFIG.tech_check.nameKey)}
                </SelectItem>
                <SelectItem value="e2e_test">
                  {tKey(CHECK_TYPE_CONFIG.e2e_test.nameKey)}
                </SelectItem>
                <SelectItem value="failure_digest">
                  {tKey(CHECK_TYPE_CONFIG.failure_digest.nameKey)}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {checkType === "e2e_test" && (
            <div className="flex items-start gap-2 rounded-[10px] border border-priority-yellow/40 bg-priority-yellow/10 p-3">
              <AlertTriangle className="h-4 w-4 text-priority-yellow mt-0.5 shrink-0" />
              <p className="text-[12.5px] leading-[1.55] text-priority-yellow">
                {t("checkDialog.e2eWarning")}
              </p>
            </div>
          )}

          {checkType === "failure_digest" && (
            <div className="space-y-1.5">
              <label
                htmlFor="failure-digest-window"
                className="text-[12.5px] text-muted-foreground"
              >
                {t("checkDialog.windowLabel")}
              </label>
              <Input
                id="failure-digest-window"
                type="number"
                min={1}
                max={TELESCOPE_MAX_WINDOW_DAYS}
                step={1}
                value={failureDigestWindowDays}
                onChange={(event) => setFailureDigestWindowDays(event.target.value)}
                className="h-[34px] w-32 rounded-[8px] text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("checkDialog.windowHint")}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor={namedAgentFieldId}
              className="text-[12.5px] text-muted-foreground"
            >
              {t("checkDialog.namedAgentLabel")}
            </label>
            <div className="flex items-center gap-2">
              <NamedAgentSelect
                id={namedAgentFieldId}
                // The hint below renders only while no agent is picked, so the
                // reference is claimed only while its target exists. Chrome
                // ignores a dangling one silently, which is exactly why the
                // markup should not assert a description it doesn't have.
                aria-describedby={namedAgentId ? undefined : namedAgentHintId}
                value={namedAgentId}
                onChange={setNamedAgentId}
                className="w-56 h-[34px] rounded-[8px] text-[13px]"
                dispatchRole="qa"
              />
              {namedAgentId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setNamedAgentId(null)}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  {t("checkDialog.useDefault")}
                </Button>
              )}
            </div>
            {!namedAgentId && (
              <p id={namedAgentHintId} className="text-[11px] text-muted-foreground">
                {t("checkDialog.namedAgentHint")}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={savedPromptId}
              className="text-[12.5px] text-muted-foreground"
            >
              {t("checkDialog.savedPromptLabel")}
            </label>
            <Select
              value={customPromptId ?? "__none__"}
              onValueChange={handlePromptSelect}
              disabled={loadingPrompts}
            >
              <SelectTrigger id={savedPromptId} className="h-8 text-xs">
                <SelectValue
                  placeholder={
                    loadingPrompts
                      ? t("checkDialog.loadingPrompts")
                      : t("checkDialog.selectSavedPrompt")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("checkDialog.none")}</SelectItem>
                {prompts.map((prompt) => (
                  <SelectItem key={prompt.id} value={prompt.id}>
                    {prompt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {customPromptId && <div className="flex gap-2">
              <PillButton variant="outline" size="sm" disabled={pending || !customPrompt.trim()} onClick={() => void mutatePreset("PATCH")}>{t("checkDialog.updatePreset")}</PillButton>
              <PillButton variant="outline" size="sm" disabled={pending} onClick={() => void mutatePreset("DELETE")}>{t("checkDialog.deletePreset")}</PillButton>
            </div>}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={customPromptFieldId}
              className="text-[12.5px] text-muted-foreground"
            >
              {t("checkDialog.customPromptLabel")}
            </label>
            <Textarea
              id={customPromptFieldId}
              value={customPrompt}
              onChange={(event) => setCustomPrompt(event.target.value)}
              placeholder={t("checkDialog.customPromptPlaceholder")}
              rows={8}
              className="rounded-[10px] text-[13.5px] leading-[1.6]"
            />
          </div>

          <div className="flex items-center gap-2">
            {/*
              The row is a compact input+button pair with no room for a visible
              label, so the name is authored on the control. It is NOT the
              placeholder doing double duty: a placeholder is dropped by some
              screen readers and is only a last-resort fallback in the
              accessible-name spec, so a control named that way reads as unnamed
              exactly when the user has typed into it.
            */}
            <Input
              aria-label={t("checkDialog.promptNameLabel")}
              value={savePromptName}
              onChange={(event) => setSavePromptName(event.target.value)}
              placeholder={t("checkDialog.promptNamePlaceholder")}
              className="h-[34px] rounded-[8px] text-[13px]"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleSavePrompt}
              disabled={!savePromptName.trim() || !customPrompt.trim() || pending || !promptData}
            >
              {savingPrompt ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              {t("checkDialog.savePrompt")}
            </Button>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {loadError && <Button variant="outline" onClick={() => void loadPrompts()}>{t("report.retry")}</Button>}
        </fieldset>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetForm();
            }}
            disabled={pending}
          >
            {t("checkDialog.cancel")}
          </Button>
          <Button onClick={handleStart} disabled={pending}>
            {starting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            {tKey(config.titleKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
