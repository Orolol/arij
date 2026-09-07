"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Hammer, GitMerge, Loader2, MessageSquare, CheckCheck } from "lucide-react";
import type { ReviewComment } from "@/hooks/useReviewComments";

interface ReviewActionsProps {
  projectId: string;
  epicId: string;
  epicStatus: string;
  openCount: number;
  comments: ReviewComment[];
  onBackToDev: (comment: string) => Promise<unknown>;
  /** Merge the epic's branch — the merge IS the approval (POST .../merge). */
  onMerge: () => Promise<unknown>;
  onResolveAll: () => Promise<unknown>;
  dispatching?: boolean;
  isRunning?: boolean;
}

export function ReviewActions({
  projectId,
  epicId,
  epicStatus,
  openCount,
  comments,
  onBackToDev,
  onMerge,
  onResolveAll,
  dispatching,
  isRunning,
}: ReviewActionsProps) {
  const [backToDevOpen, setBackToDevOpen] = useState(false);
  const [additionalComment, setAdditionalComment] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const [merging, setMerging] = useState(false);
  const [resolvingAll, setResolvingAll] = useState(false);

  const actionsLocked = dispatching || isRunning;
  const canBackToDev = ["review", "to_merge", "in_progress", "todo", "backlog"].includes(epicStatus);
  const canMerge = epicStatus === "to_merge";

  async function handleBackToDev() {
    // Build the rework comment from open review comments
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
      <div className="flex items-center gap-2 flex-wrap border border-border rounded-lg p-3 bg-muted/30">
        {openCount > 0 && (
          <Badge variant="outline" className="gap-1 text-xs text-blue-500 border-blue-500/30">
            <MessageSquare className="h-3 w-3" />
            {openCount} open
          </Badge>
        )}

        <div className="flex-1" />

        {openCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleResolveAll}
            disabled={resolvingAll}
            className="h-7 text-xs"
          >
            {resolvingAll ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <CheckCheck className="h-3 w-3 mr-1" />
            )}
            Resolve All
          </Button>
        )}

        {canBackToDev && openCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAdditionalComment("");
              setBackToDevOpen(true);
            }}
            disabled={actionsLocked}
            className="h-7 text-xs"
          >
            <Hammer className="h-3 w-3 mr-1" />
            Back to Dev
          </Button>
        )}

        {canMerge && (
          <Button
            size="sm"
            onClick={handleMerge}
            disabled={merging || actionsLocked}
            className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
          >
            {merging ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <GitMerge className="h-3 w-3 mr-1" />
            )}
            Merge
          </Button>
        )}
      </div>

      {/* Back to Dev Dialog */}
      <Dialog open={backToDevOpen} onOpenChange={setBackToDevOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Back to Dev</DialogTitle>
            <DialogDescription>
              {openCount} open review comment{openCount !== 1 ? "s" : ""} will be
              formatted and sent to the agent as context for the next iteration.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-48 overflow-y-auto border rounded-lg p-3 bg-muted/30 text-xs space-y-2">
            {comments
              .filter((c) => c.status === "open")
              .map((c) => (
                <div key={c.id} className="flex gap-2">
                  <span className="text-muted-foreground font-mono shrink-0">
                    {c.filePath}:{c.lineNumber}
                  </span>
                  <span>{c.body}</span>
                </div>
              ))}
          </div>

          <Textarea
            value={additionalComment}
            onChange={(e) => setAdditionalComment(e.target.value)}
            placeholder="Additional instructions (optional)..."
            rows={3}
            className="text-sm"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setBackToDevOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleBackToDev}
              disabled={sendingBack || actionsLocked}
            >
              {sendingBack ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Hammer className="h-4 w-4 mr-1" />
              )}
              Send to Dev
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
