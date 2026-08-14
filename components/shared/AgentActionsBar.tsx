"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/components/documents/MentionTextarea";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Hammer,
  Search,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { AgentDispatchDialog } from "@/components/shared/AgentDispatchDialog";
import { ReviewTypesPicker } from "@/components/shared/ReviewTypesPicker";

interface EpicItem {
  id: string;
  status: string;
  title: string;
}

interface StoryItem {
  id: string;
  epicId?: string;
  status: string;
  title: string;
}

export type AgentActionsTarget =
  | { kind: "epic"; epic: EpicItem }
  | { kind: "story"; story: StoryItem };

interface TargetConfig {
  /** Noun used in the "Another agent is already running…" lock message. */
  noun: string;
  /** Statuses from which a fresh "Send to Dev" is allowed. */
  sendToDevStatuses: string[];
  devDialogTitle: string;
  reviewDialogTitle: string;
  reviewDialogDescription: string;
  /** agentType used to filter resumable sessions for the build dialog. */
  buildAgentType: string;
}

const TARGET_CONFIG: Record<AgentActionsTarget["kind"], TargetConfig> = {
  epic: {
    noun: "epic",
    sendToDevStatuses: ["backlog", "todo", "in_progress"],
    devDialogTitle: "Send Epic to Dev",
    reviewDialogTitle: "Epic Agent Review",
    reviewDialogDescription:
      "Select the review types to run on this epic. Each selected type dispatches a separate agent.",
    buildAgentType: "build",
  },
  story: {
    noun: "task",
    sendToDevStatuses: ["todo", "in_progress"],
    devDialogTitle: "Send to Dev",
    reviewDialogTitle: "Agent Review",
    reviewDialogDescription:
      "Select the review types to run. Each selected type dispatches a separate agent.",
    buildAgentType: "ticket_build",
  },
};

interface AgentActionsBarProps {
  projectId: string;
  target: AgentActionsTarget;
  dispatching: boolean;
  isRunning: boolean;
  activeSessionId?: string | null;
  onSendToDev: (comment?: string, namedAgentId?: string | null, resumeSessionId?: string) => Promise<unknown>;
  onSendToReview: (types: string[], namedAgentId?: string | null, resumeSessionId?: string) => Promise<unknown>;
  onApprove: () => Promise<unknown>;
  onActionError?: (error: unknown) => void;
}

export function AgentActionsBar({
  projectId,
  target,
  dispatching,
  isRunning,
  activeSessionId,
  onSendToDev,
  onSendToReview,
  onApprove,
  onActionError,
}: AgentActionsBarProps) {
  const [sendToDevOpen, setSendToDevOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [devComment, setDevComment] = useState("");
  const [devAgentId, setDevAgentId] = useState<string | null>(null);
  const [reviewAgentId, setReviewAgentId] = useState<string | null>(null);
  const [reviewTypes, setReviewTypes] = useState<Set<string>>(new Set(["feature_review"]));
  const [approving, setApproving] = useState(false);
  const [resumeSessionId, setResumeSessionId] = useState<string | undefined>();
  const [reviewResumeSessionId, setReviewResumeSessionId] = useState<string | undefined>();

  const config = TARGET_CONFIG[target.kind];
  const item = target.kind === "epic" ? target.epic : target.story;
  // Session scoping: epics resume their own sessions; stories resume
  // sessions scoped to the story (and its parent epic when known).
  const sessionEpicId = target.kind === "epic" ? target.epic.id : target.story.epicId;
  const sessionUserStoryId = target.kind === "epic" ? undefined : target.story.id;

  const status = item.status;
  const canSendToDev = config.sendToDevStatuses.includes(status);
  const canSendToDevFromReview = status === "review";
  const canReview = status === "review" || status === "done";
  const canApprove = status === "review";
  const actionsLocked = dispatching || isRunning;
  const lockMessage =
    isRunning && activeSessionId
      ? `Another agent is already running for this ${config.noun} (#${activeSessionId.slice(0, 6)}).`
      : isRunning
        ? `Another agent is already running for this ${config.noun}.`
        : null;

  // Send to Dev (from backlog/todo/in_progress — optional comment)
  async function handleSendToDev() {
    try {
      await onSendToDev(devComment.trim() || undefined, devAgentId, resumeSessionId);
      setSendToDevOpen(false);
      setDevComment("");
      setResumeSessionId(undefined);
    } catch (error) {
      onActionError?.(error);
    }
  }

  // Send to Dev from Review (mandatory comment)
  async function handleSendToDevFromReview() {
    if (!devComment.trim()) return;
    try {
      await onSendToDev(devComment.trim(), devAgentId, resumeSessionId);
      setSendToDevOpen(false);
      setDevComment("");
      setResumeSessionId(undefined);
    } catch (error) {
      onActionError?.(error);
    }
  }

  // Agent Review
  function toggleReviewType(type: string) {
    setReviewTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  async function handleReview() {
    if (reviewTypes.size === 0) return;
    try {
      await onSendToReview(Array.from(reviewTypes), reviewAgentId, reviewResumeSessionId);
      setReviewOpen(false);
      setReviewTypes(new Set());
      setReviewResumeSessionId(undefined);
    } catch (error) {
      onActionError?.(error);
    }
  }

  // Approve
  async function handleApprove() {
    setApproving(true);
    try {
      await onApprove();
    } catch (error) {
      onActionError?.(error);
    } finally {
      setApproving(false);
    }
  }

  return (
    <TooltipProvider>
    <div className="flex items-center gap-2 flex-wrap">
      {/* Running indicator */}
      {isRunning && (
        <Badge variant="outline" className="gap-1 text-yellow-500 border-yellow-500/30">
          <Loader2 className="h-3 w-3 animate-spin" />
          Agent running
        </Badge>
      )}
      {lockMessage && (
        <span className="text-xs text-muted-foreground">{lockMessage}</span>
      )}

      {/* Send to Dev button */}
      {(canSendToDev || canSendToDevFromReview) && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDevComment("");
            setSendToDevOpen(true);
          }}
          disabled={actionsLocked}
          className="h-7 text-xs"
        >
          <Hammer className="h-3 w-3 mr-1" />
          Send to Dev
        </Button>
      )}

      {/* Agent Review button */}
      {canReview && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setReviewTypes(new Set(["feature_review"]));
            setReviewOpen(true);
          }}
          disabled={actionsLocked}
          className="h-7 text-xs"
        >
          <Search className="h-3 w-3 mr-1" />
          Agent Review
        </Button>
      )}

      {/* Approve button */}
      {canApprove && (
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={approving || actionsLocked}
          className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
        >
          {approving ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <CheckCircle2 className="h-3 w-3 mr-1" />
          )}
          Approve
        </Button>
      )}

      {/* Send to Dev Dialog */}
      <AgentDispatchDialog
        open={sendToDevOpen}
        onOpenChange={(open) => { setSendToDevOpen(open); if (!open) setResumeSessionId(undefined); }}
        title={config.devDialogTitle}
        description={
          canSendToDevFromReview
            ? "Explain what needs to be fixed. This comment is required."
            : "Optionally add a comment for the agent before dispatching."
        }
        projectId={projectId}
        agentProps={{ value: devAgentId, onChange: setDevAgentId }}
        sessionPicker={{
          epicId: sessionEpicId,
          userStoryId: sessionUserStoryId,
          agentType: config.buildAgentType,
          namedAgentId: devAgentId,
          provider: "claude-code",
          selectedSessionId: resumeSessionId,
          onSelect: setResumeSessionId,
        }}
        extraContent={
          <MentionTextarea
            projectId={projectId}
            value={devComment}
            onValueChange={setDevComment}
            placeholder={
              canSendToDevFromReview
                ? "Describe what needs to be fixed..."
                : "Optional instructions for the agent..."
            }
            rows={4}
            className=""
          />
        }
        confirmLabel="Dispatch Agent"
        confirmIcon={<Hammer className="h-4 w-4 mr-1" />}
        busy={dispatching}
        confirmDisabled={
          actionsLocked ||
          (canSendToDevFromReview && !devComment.trim())
        }
        onConfirm={
          canSendToDevFromReview
            ? handleSendToDevFromReview
            : handleSendToDev
        }
        onCancel={() => setSendToDevOpen(false)}
      />

      {/* Agent Review Dialog */}
      <AgentDispatchDialog
        open={reviewOpen}
        onOpenChange={(open) => { setReviewOpen(open); if (!open) setReviewResumeSessionId(undefined); }}
        title={config.reviewDialogTitle}
        description={config.reviewDialogDescription}
        projectId={projectId}
        agentProps={{ value: reviewAgentId, onChange: setReviewAgentId }}
        sessionPicker={{
          epicId: sessionEpicId,
          userStoryId: sessionUserStoryId,
          agentType: Array.from(reviewTypes)[0],
          namedAgentId: reviewAgentId,
          provider: "claude-code",
          selectedSessionId: reviewResumeSessionId,
          onSelect: setReviewResumeSessionId,
        }}
        extraContent={
          <ReviewTypesPicker selected={reviewTypes} onToggle={toggleReviewType} />
        }
        confirmLabel={`Run Review (${reviewTypes.size})`}
        confirmIcon={<Search className="h-4 w-4 mr-1" />}
        busy={dispatching}
        confirmDisabled={actionsLocked || reviewTypes.size === 0}
        onConfirm={handleReview}
        onCancel={() => setReviewOpen(false)}
      />
    </div>
    </TooltipProvider>
  );
}
