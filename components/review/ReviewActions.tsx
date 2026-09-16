"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PillButton, Stamp } from "@/components/piscine";
import { Hammer, GitMerge, Loader2, MessageSquare, CheckCheck } from "lucide-react";
import type { ReviewComment } from "@/hooks/useReviewComments";
import { MarkdownContent } from "@/components/chat/MarkdownContent";

interface ReviewActionsProps {
  projectId?: string;
  epicId?: string;
  epicStatus: string;
  openCount: number;
  comments: ReviewComment[];
  onBackToDev: (comment: string) => Promise<unknown>;
  /** Merge the epic's branch — the merge IS the approval (POST .../merge). */
  onMerge: () => Promise<unknown>;
  onResolveAll: () => Promise<unknown>;
  dispatching?: boolean;
  isRunning?: boolean;
  disabled?: boolean;
}

export function ReviewActions({
  epicStatus,
  openCount,
  comments,
  onBackToDev,
  onMerge,
  onResolveAll,
  dispatching,
  isRunning,
  disabled = false,
}: ReviewActionsProps) {
  const [backToDevOpen, setBackToDevOpen] = useState(false);
  const [additionalComment, setAdditionalComment] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const [merging, setMerging] = useState(false);
  const [resolvingAll, setResolvingAll] = useState(false);
  const t = useTranslations("Review");

  const actionsLocked = dispatching || isRunning || disabled;
  const canBackToDev = ["review", "to_merge"].includes(epicStatus);
  const canMerge = epicStatus === "to_merge";

  async function handleBackToDev() {
    // Build the rework comment from open review comments.
    //
    // NOT COPY, and deliberately absent from the catalogue: this markdown is
    // the prompt an agent reads on the next iteration, and it is persisted on
    // the ticket. Agent-facing and persisted text is pinned to English at its
    // own site rather than following the interface locale
    // (lib/i18n/catalogue.ts, exclusion 5).
    const openComments = comments.filter((c) => c.status === "open");
    const parts: string[] = [];

    if (openComments.length > 0) {
      parts.push("## Review Comments\n");
      // Group by file
      const byFile = new Map<string, ReviewComment[]>();
      for (const c of openComments) {
        const existing = byFile.get(c.filePath) || [];
        existing.push(c);
        byFile.set(c.filePath, existing);
      }
      for (const [filePath, fileComments] of byFile) {
        parts.push(`### ${filePath}`);
        for (const c of fileComments) {
          parts.push(`- **Line ${c.lineNumber}**: ${c.body}`);
        }
        parts.push("");
      }
    }

    if (additionalComment.trim()) {
      parts.push("## Additional Instructions\n");
      parts.push(additionalComment.trim());
    }

    const fullComment = parts.join("\n");
    setSendingBack(true);
    // An async wrapper and a `.finally` call, not a `finally` clause, here and
    // in the two handlers below: the React Compiler stops at the clause, and
    // stopping left this component unread by every compiler rule. The wrapper
    // is what makes the call equivalent — these callbacks come from outside,
    // and `Promise<unknown>` does not stop one from throwing BEFORE it returns
    // a promise, which would unwind past a `.finally` attached to that return
    // value and leave the spinner running for good. Settling the call inside
    // the wrapper turns either ending into a rejection first. A rejection
    // still reaches the caller, and still skips the resets after it.
    const sendBack = async () => onBackToDev(fullComment);
    await sendBack().finally(() => setSendingBack(false));
    setBackToDevOpen(false);
    setAdditionalComment("");
  }

  async function handleMerge() {
    setMerging(true);
    // The merge is the approval: the route resolves whatever comments
    // remain open as part of the same action.
    const merge = async () => onMerge();
    await merge().finally(() => setMerging(false));
  }

  async function handleResolveAll() {
    setResolvingAll(true);
    const resolveAll = async () => onResolveAll();
    await resolveAll().finally(() => setResolvingAll(false));
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap rounded-[12px] bg-card p-3 border border-border/40">
        {openCount > 0 && (
          <Stamp tone="live">
            <MessageSquare className="h-3 w-3" />
            {t("actions.open", { count: openCount })}
          </Stamp>
        )}

        <div className="flex-1" />

        {openCount > 0 && (
          <PillButton
            size="sm"
            variant="outline"
            outlineTone="neutral"
            onClick={handleResolveAll}
            disabled={resolvingAll || actionsLocked}
          >
            {resolvingAll ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <CheckCheck className="h-3 w-3 mr-1" />
            )}
            {t("actions.resolveAll")}
          </PillButton>
        )}

        {canBackToDev && openCount > 0 && (
          <PillButton
            size="sm"
            variant="outline"
            outlineTone="neutral"
            onClick={() => {
              setAdditionalComment("");
              setBackToDevOpen(true);
            }}
            disabled={actionsLocked}
          >
            <Hammer className="h-3 w-3 mr-1" />
            {t("actions.backToDev")}
          </PillButton>
        )}

        {canMerge && (
          <PillButton
            size="sm"
            variant="filled"
            onClick={handleMerge}
            disabled={merging || actionsLocked}
          >
            {merging ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <GitMerge className="h-3 w-3 mr-1" />
            )}
            {t("actions.merge")}
          </PillButton>
        )}
      </div>

      {/* Back to Dev Dialog */}
      <Dialog open={backToDevOpen} onOpenChange={setBackToDevOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("backToDevDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("backToDevDialog.description", { count: openCount })}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-48 overflow-y-auto rounded-[8px] border border-border/40 p-3 bg-muted/20 text-xs space-y-2">
            {comments
              .filter((c) => c.status === "open")
              .map((c) => (
                <div key={c.id} className="flex gap-2">
                  <span className="text-muted-foreground font-mono shrink-0">
                    {c.filePath}:{c.lineNumber}
                  </span>
                  <div className="min-w-0">
                    <MarkdownContent content={c.body} />
                  </div>
                </div>
              ))}
          </div>

          <textarea
            value={additionalComment}
            onChange={(e) => setAdditionalComment(e.target.value)}
            placeholder={t("backToDevDialog.placeholder")}
            aria-label={t("backToDevDialog.placeholder")}
            rows={3}
            className="w-full rounded-[8px] bg-background p-2.5 text-xs font-mono border border-border/50 outline-none focus:border-primary resize-y"
          />

          <DialogFooter className="gap-2 sm:gap-2">
            <PillButton
              size="sm"
              variant="outline"
              outlineTone="neutral"
              onClick={() => setBackToDevOpen(false)}
            >
              {t("backToDevDialog.cancel")}
            </PillButton>
            <PillButton
              size="sm"
              variant="filled"
              onClick={handleBackToDev}
              disabled={sendingBack || actionsLocked}
            >
              {sendingBack ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Hammer className="h-3.5 w-3.5 mr-1" />
              )}
              {t("backToDevDialog.send")}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
