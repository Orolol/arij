"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Send, X } from "lucide-react";
import { PillButton } from "@/components/piscine";

interface InlineCommentFormProps {
  onSubmit: (body: string) => Promise<unknown>;
  onCancel: () => void;
  initialValue?: string;
  disabled?: boolean;
}

export function InlineCommentForm({
  onSubmit,
  onCancel,
  initialValue = "",
  disabled = false,
}: InlineCommentFormProps) {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const t = useTranslations("Review");

  async function handleSubmit() {
    if (!value.trim() || pending.current || disabled) return;
    pending.current = true;
    setSubmitting(true);
    // An async wrapper and a `.finally` call, not a `finally` clause: the
    // React Compiler stops at the clause, and stopping left this component
    // unread by every compiler rule. `onSubmit` belongs to the caller and may
    // throw synchronously as well as reject; settling it inside the wrapper
    // makes both endings a rejection, so `submitting` clears either way rather
    // than sticking on a throw that never reached `.finally`. The rejection
    // still reaches the caller.
    const submit = async () => onSubmit(value.trim());
    const result = await submit().finally(() => {
      pending.current = false;
      setSubmitting(false);
    });
    if (result !== null && result !== false) setValue("");
  }

  return (
    <div className="border border-border/40 rounded-[10px] p-2 bg-card space-y-2">
      <textarea
        value={value}
        disabled={submitting || disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === "Escape") {
            onCancel();
          }
        }}
        placeholder={t("commentForm.placeholder")}
        aria-label={t("commentForm.placeholder")}
        rows={2}
        className="w-full rounded-[6px] bg-background p-2 text-xs font-mono border border-border/50 outline-none focus:border-primary resize-none disabled:opacity-50"
        autoFocus
      />
      <div className="flex items-center gap-2 justify-end">
        <PillButton
          size="sm"
          variant="outline"
          outlineTone="neutral"
          onClick={onCancel}
          disabled={submitting}
        >
          <X className="h-3 w-3 mr-1" />
          {t("commentForm.cancel")}
        </PillButton>
        <PillButton
          size="sm"
          variant="filled"
          onClick={handleSubmit}
          disabled={!value.trim() || submitting || disabled}
        >
          {submitting ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Send className="h-3 w-3 mr-1" />
          )}
          {t("commentForm.submit")}
        </PillButton>
      </div>
    </div>
  );
}
