"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { GhostInputPill, PillButton } from "@/components/piscine";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QaFinding } from "@/lib/qa/types";

import { FindingSeverityStamp } from "./FindingSeverityStamp";

/** Human dismissal preserves the finding body and stores a separate reason. */
export interface DismissDialogProps {
  finding: QaFinding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (finding: QaFinding, reason: string) => void | Promise<void>;
  pending?: boolean;
}

export function DismissDialog({
  finding,
  open,
  onOpenChange,
  onConfirm,
  pending = false,
}: DismissDialogProps) {
  const t = useTranslations("Qa");
  const [reason, setReason] = useState("");

  /*
    A new finding is a new reason: never carry the previous one over.

    Adjusted during render rather than from an effect. The dialog is mounted
    for the whole screen's life (QaScreen keeps it rendered and drives it with
    `open`), so the reset has to happen on the render that swaps the finding in
    — an effect clears it one commit late, which is a frame of the previous
    finding's text sitting in the new finding's box.
  */
  const resetKey = `${finding?.findingId ?? ""}:${open}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setReason("");
  }

  const submit = () => {
    const trimmed = reason.trim();
    if (!finding || trimmed.length === 0) return;
    void onConfirm(finding, trimmed);
  };

  /*
    Radix aims the content's `aria-describedby` at the `DialogDescription` it
    expects to find below. With no finding there is nothing to describe, so
    take its sanctioned opt-out rather than leaving that pointer aimed at an id
    nothing renders — the dangling pointer is what made every open log
    `Missing \`Description\` or \`aria-describedby={undefined}\``.

    QaScreen drives `open` off `dismissTarget !== null` and so never reaches
    this branch, but the props admit the pair and the warning was loud.
  */
  const describedBy: { "aria-describedby"?: undefined } = finding
    ? {}
    : { "aria-describedby": undefined };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-testid="qa-dismiss-dialog"
        {...describedBy}
        // No shadow: the ticket overlay is the only shadow in the system.
        className="gap-3 rounded-[16px] border-[1.5px] border-border bg-card p-[18px] shadow-none sm:max-w-[440px]"
      >
        <DialogHeader>
          <DialogTitle className="font-display text-[15px] font-bold text-foreground">
            {t("dismissDialog.title")}
          </DialogTitle>
        </DialogHeader>

        {finding ? (
          <div className="flex items-start gap-2">
            <FindingSeverityStamp
              tier={finding.tier}
              label={finding.severityLabel}
              className="mt-[2px]"
            />
            {/* The finding's own text IS the dialog's description: the thing
                a screen reader has to hear before confirming. Same pixels as
                the span it replaces — `cn` puts this className last, so the
                primitive's `text-muted-foreground text-sm` loses to it. */}
            <DialogDescription className="min-w-0 flex-1 font-sans text-[13px] text-foreground">
              {finding.text}
            </DialogDescription>
          </div>
        ) : null}

        <GhostInputPill
          value={reason}
          onChange={setReason}
          onSubmit={submit}
          placeholder={t("dismissDialog.reasonPlaceholder")}
          fill="field"
          width="flex"
          disabled={pending}
          aria-label={t("dismissDialog.reasonPlaceholder")}
          data-testid="qa-dismiss-reason"
        />

        <DialogFooter className="gap-2">
          <PillButton
            variant="outline"
            outlineTone="neutral"
            size="sm"
            onClick={() => onOpenChange(false)}
            data-testid="qa-dismiss-cancel"
          >
            {t("dismissDialog.cancel")}
          </PillButton>
          <PillButton
            variant="filled"
            size="sm"
            onClick={submit}
            disabled={reason.trim().length === 0}
            pending={pending}
            pendingLabel={t("dismissDialog.pending")}
            data-testid="qa-dismiss-confirm"
          >
            {t("dismissDialog.confirm")}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
