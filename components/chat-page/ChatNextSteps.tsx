"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { PillButton } from "@/components/piscine";

export interface ChatNextStepsProps {
  /**
   * An epic-creation conversation with a user message and NO drafted epic in
   * any message yet. The moment one message parses, its in-thread card takes
   * over and this chip disappears.
   */
  showDraftEpic: boolean;
  drafting: boolean;
  onDraftEpic: () => void;
  /** A brainstorm: the spec generation suggestion. */
  showGenerateSpec: boolean;
  generatingSpec: boolean;
  onGenerateSpec: () => void;
  disabled: boolean;
}

/**
 * The conversation's next-step chips, pinned under the last message of the
 * thread on both chat surfaces.
 *
 * "Draft the epic" does NOT create anything: it asks the agent for the epic as
 * one parseable reply, and the `DraftedEpicCard` that reply produces is the
 * only creator (lot 10, #52).
 */
export function ChatNextSteps({
  showDraftEpic,
  drafting,
  onDraftEpic,
  showGenerateSpec,
  generatingSpec,
  onGenerateSpec,
  disabled,
}: ChatNextStepsProps) {
  const t = useTranslations("Chat");
  if (!showDraftEpic && !showGenerateSpec) return null;

  return (
    <div data-testid="chat-next-steps" className="flex flex-wrap gap-2 px-2 pt-1">
      {showDraftEpic ? (
        <PillButton
          variant="outline"
          size="sm"
          icon={Sparkles}
          pending={drafting}
          disabled={disabled}
          pendingLabel={t("thread.draftEpicPending")}
          onClick={onDraftEpic}
        >
          {t("thread.draftEpic")}
        </PillButton>
      ) : null}
      {showGenerateSpec ? (
        <PillButton
          variant="outline"
          size="sm"
          icon={Sparkles}
          pending={generatingSpec}
          disabled={disabled}
          pendingLabel={t("thread.generateSpecPending")}
          onClick={onGenerateSpec}
        >
          {t("thread.generateSpec")}
        </PillButton>
      ) : null}
    </div>
  );
}
