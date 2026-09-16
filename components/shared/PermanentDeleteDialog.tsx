"use client";

import { useTranslations } from "next-intl";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PermanentDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  deleting: boolean;
  locked?: boolean;
  onConfirm: () => Promise<void> | void;
}

export function PermanentDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  deleting,
  locked = false,
  onConfirm,
}: PermanentDeleteDialogProps) {
  const t = useTranslations("Shared");

  async function handleConfirm() {
    if (deleting || locked) return;
    await onConfirm();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (deleting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("permanentDelete.warning")}</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting || locked}
          >
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting || locked}
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

