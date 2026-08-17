"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { InlineEdit } from "./InlineEdit";
import { useEpicDetail } from "@/hooks/useEpicDetail";
import { useTicketComments } from "@/hooks/useTicketComments";
import { useAgentDispatch } from "@/hooks/useAgentDispatch";
import { useGitHubConfig } from "@/hooks/useGitHubConfig";
import { useGitStatus } from "@/hooks/useGitStatus";
import { useProjectEpicsList } from "@/hooks/useProjectEpicsList";
import { useEpicMutations } from "@/hooks/useEpicMutations";
import { AgentActionsBar } from "@/components/shared/AgentActionsBar";
import { AgentDispatchDialog } from "@/components/shared/AgentDispatchDialog";
import { TicketTypeBadge } from "@/components/shared/TicketTypeBadge";
import { EpicActivityFeed } from "./epic-detail/EpicActivityFeed";
import { PRIORITY_LABELS, KANBAN_COLUMNS, COLUMN_LABELS } from "@/lib/types/kanban";
import { useEpicPr } from "@/hooks/useEpicPr";
import { Wrench, FileCode } from "lucide-react";
import { useState, useEffect } from "react";
import { isAgentAlreadyRunningError } from "@/lib/agents/client-error";
import { PermanentDeleteDialog } from "@/components/shared/PermanentDeleteDialog";
import { DependencyEditor } from "@/components/dependencies/DependencyEditor";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DiffViewer } from "@/components/review/DiffViewer";
import { EpicGitSection } from "./epic-detail/EpicGitSection";
import { EpicUserStoriesSection } from "./epic-detail/EpicUserStoriesSection";
import { EpicDangerZone } from "./epic-detail/EpicDangerZone";
import { formatCostUsd } from "@/lib/utils/format-usage";

interface EpicDetailProps {
  projectId: string;
  epicId: string | null;
  open: boolean;
  onClose: () => void;
  onMerged?: () => void;
  onDeleted?: () => void;
  onAgentConflict?: (args: { message: string; sessionUrl?: string }) => void;
}

export function EpicDetail({
  projectId,
  epicId,
  open,
  onClose,
  onMerged,
  onDeleted,
  onAgentConflict,
}: EpicDetailProps) {
  const {
    epic,
    userStories,
    loading,
    updateEpic,
    addUserStory,
    updateUserStory,
    deleteUserStory,
    refresh,
    setPolling,
  } = useEpicDetail(projectId, epicId);

  const {
    comments,
    loading: commentsLoading,
    addComment,
  } = useTicketComments(projectId, { kind: "epic", epicId });

  const {
    activeSession,
    dispatching,
    isRunning,
    sendToDev,
    sendToReview,
    resolveMerge,
    approve,
  } = useAgentDispatch(projectId, { kind: "epic", epicId });

  const {
    pr,
    loading: prLoading,
    error: prError,
    createPr,
    syncPr,
  } = useEpicPr(projectId, epicId);

  const { isConfigured: githubConfigured } = useGitHubConfig(projectId);
  const {
    ahead,
    behind,
    lastFetchedAt,
    lastFetchError,
    loading: gitStatusLoading,
    error: gitStatusError,
    refresh: refreshGitStatus,
    push: pushToRemote,
    pushing,
  } = useGitStatus(projectId, epic?.branchName ?? null, githubConfigured);

  // All epics in the project for the dependency dropdown
  const { epics: projectEpics } = useProjectEpicsList(projectId, epicId, open);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const {
    merging,
    mergeError,
    setMergeError,
    merge,
    deletingEpic,
    deleteEpicError,
    deleteEpic,
  } = useEpicMutations(projectId, epicId, {
    onMergeSuccess: () => {
      onMerged?.();
      onClose();
    },
    onDeleteSuccess: () => {
      setDeleteDialogOpen(false);
      onClose();
      onDeleted?.();
    },
  });

  // Only poll epic detail when an agent is actively running
  useEffect(() => {
    setPolling(isRunning);
  }, [isRunning, setPolling]);

  // Opening a ticket marks it read: move its ticket_read_cursors row to now
  // so the kanban unread dot and the cross-project inbox both clear.
  useEffect(() => {
    if (!open || !epicId) return;
    const markRead = async () => {
      try {
        await fetch("/api/inbox/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ epicId }),
        });
      } catch {
        // Best-effort — the unread dot simply survives until the next open.
      }
    };
    void markRead();
  }, [open, epicId]);

  const [newUSTitle, setNewUSTitle] = useState("");
  const [resolvingMerge, setResolvingMerge] = useState(false);
  const [resolveMergeOpen, setResolveMergeOpen] = useState(false);
  const [resolveMergeAgentId, setResolveMergeAgentId] = useState<string | null>(null);
  const [resolveMergeResumeSessionId, setResolveMergeResumeSessionId] = useState<string | undefined>();

  async function handleResolveMerge(namedAgentId?: string | null, resumeSessionId?: string) {
    if (!epicId) return;
    setResolvingMerge(true);
    try {
      const result = await resolveMerge(namedAgentId, resumeSessionId);
      if (result?.clean) {
        setMergeError(null);
        onMerged?.();
        onClose();
      } else {
        setMergeError(null);
      }
      setResolveMergeOpen(false);
      setResolveMergeResumeSessionId(undefined);
    } catch (e) {
      if (isAgentAlreadyRunningError(e)) {
        onAgentConflict?.({
          message: e.message,
          sessionUrl: e.sessionUrl || `/projects/${projectId}/sessions/${e.activeSessionId}`,
        });
      }
      setMergeError(e instanceof Error ? e.message : "Failed to resolve merge");
    }
    setResolvingMerge(false);
  }

  async function handleApprove() {
    await approve();
    refresh();
  }

  async function handleSendToDev(
    comment?: string,
    namedAgentId?: string | null,
    resumeSessionId?: string,
    pipeline?: boolean
  ) {
    await sendToDev(comment, namedAgentId, resumeSessionId, pipeline);
    refresh();
  }

  async function handleBackToDev(reviewComment: string) {
    // Post the review summary as a ticket comment, then dispatch build
    await sendToDev(reviewComment);
    refresh();
  }

  async function handleSendToReview(types: string[], namedAgentId?: string | null, resumeSessionId?: string) {
    await sendToReview(types, namedAgentId, resumeSessionId);
    refresh();
  }

  function handleAddUS() {
    if (!newUSTitle.trim()) return;
    addUserStory(newUSTitle.trim());
    setNewUSTitle("");
  }

  if (!open) return null;

  return (
    <div className="h-full overflow-y-auto" data-testid="epic-detail-panel">
      {loading || !epic ? (
        <>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">Epic</h2>
          </div>
          <div className="py-8 text-center text-muted-foreground">
            Loading...
          </div>
        </>
      ) : (
        <>
          <div className="border-b border-border px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              {epic.readableId && (
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {epic.readableId}
                </span>
              )}
              <InlineEdit
                value={epic.title}
                onSave={(v) => updateEpic({ title: v })}
                className="text-lg font-bold"
              />
            </div>
            <TicketTypeBadge
              type={epic.type}
              className="bg-red-500/10 text-red-400 text-xs w-fit"
              iconClassName="h-3 w-3 mr-1"
            />
            {formatCostUsd(epic.sessionsCostUsd) && (
              <p
                className="text-[11px] text-muted-foreground/70"
                title="Cumulative cost of this ticket's agent sessions (when reported by the provider)"
              >
                Agent cost {formatCostUsd(epic.sessionsCostUsd)}
              </p>
            )}
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* Epic Actions Bar */}
            <AgentActionsBar
              projectId={projectId}
              target={{ kind: "epic", epic }}
              dispatching={dispatching}
              isRunning={isRunning}
              activeSessionId={activeSession?.id || null}
              onSendToDev={handleSendToDev}
              onSendToReview={handleSendToReview}
              onApprove={handleApprove}
              onActionError={(error) => {
                if (isAgentAlreadyRunningError(error)) {
                  onAgentConflict?.({
                    message: error.message,
                    sessionUrl:
                      error.sessionUrl ||
                      `/projects/${projectId}/sessions/${error.activeSessionId}`,
                  });
                  return;
                }
                onAgentConflict?.({
                  message:
                    error instanceof Error
                      ? error.message
                      : "Failed to run agent action",
                });
              }}
            />

            <Tabs defaultValue="details">
              <TabsList className="w-full">
                <TabsTrigger value="details" className="flex-1 text-xs">Details</TabsTrigger>
                {epic.branchName && (
                  <TabsTrigger value="review" className="flex-1 text-xs gap-1">
                    <FileCode className="h-3 w-3" />
                    Code Review
                  </TabsTrigger>
                )}
                <TabsTrigger value="activity" className="flex-1 text-xs">Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-4 mt-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Description
              </label>
              <InlineEdit
                value={epic.description || ""}
                onSave={(v) => updateEpic({ description: v })}
                multiline
                markdown
                className="text-sm"
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1">
                  Priority
                </label>
                <Select
                  value={String(epic.priority)}
                  onValueChange={(v) => updateEpic({ priority: Number(v) } as never)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1">
                  Status
                </label>
                <Select
                  value={epic.status}
                  onValueChange={(v) => updateEpic({ status: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KANBAN_COLUMNS.map((col) => (
                      <SelectItem key={col} value={col}>
                        {COLUMN_LABELS[col]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {epic.type === "bug" && epic.linkedEpicId && (
              <div className="text-xs text-muted-foreground">
                Linked to epic: <span className="font-mono">{epic.linkedEpicId}</span>
              </div>
            )}

            {epic.branchName && (
              <EpicGitSection
                projectId={projectId}
                branchName={epic.branchName}
                epicStatus={epic.status}
                githubConfigured={githubConfigured}
                isRunning={isRunning}
                ahead={ahead}
                behind={behind}
                gitStatusLoading={gitStatusLoading}
                gitStatusError={gitStatusError}
                lastFetchedAt={lastFetchedAt}
                lastFetchError={lastFetchError}
                onRefreshGitStatus={refreshGitStatus}
                onPush={pushToRemote}
                pushing={pushing}
                pr={pr}
                prLoading={prLoading}
                prError={prError}
                onCreatePr={() => createPr()}
                onSyncPr={syncPr}
                merging={merging}
                mergeError={mergeError}
                onMerge={merge}
                resolvingMerge={resolvingMerge}
                onOpenResolveMerge={() => setResolveMergeOpen(true)}
              />
            )}

            <Separator />

            {/* User Stories */}
            {epic.type !== "bug" && (
              <EpicUserStoriesSection
                projectId={projectId}
                userStories={userStories}
                newStoryTitle={newUSTitle}
                onNewStoryTitleChange={setNewUSTitle}
                onAddStory={handleAddUS}
                onUpdateStory={(id, updates) => updateUserStory(id, updates)}
                onDeleteStory={deleteUserStory}
                onRefresh={refresh}
                actionsLocked={dispatching || isRunning}
              />
            )}

            <Separator />

            {/* Dependencies */}
            {epicId && (
              <DependencyEditor
                projectId={projectId}
                epicId={epicId}
                projectEpics={projectEpics}
              />
            )}

            <Separator />

            <EpicDangerZone
              deleteError={deleteEpicError}
              deleting={deletingEpic}
              onRequestDelete={() => setDeleteDialogOpen(true)}
            />
              </TabsContent>

              {/* Code Review Tab */}
              {epic.branchName && epicId && (
                <TabsContent value="review" className="mt-4">
                  <DiffViewer
                    projectId={projectId}
                    epicId={epicId}
                    epicStatus={epic.status}
                    onBackToDev={handleBackToDev}
                    onApprove={handleApprove}
                    dispatching={dispatching}
                    isRunning={isRunning}
                  />
                </TabsContent>
              )}

              {/* Activity Tab */}
              <TabsContent value="activity" className="mt-4">
                <div className="min-h-[200px]">
                  <EpicActivityFeed
                    projectId={projectId}
                    epicId={epicId}
                    comments={comments}
                    commentsLoading={commentsLoading}
                    onAddComment={addComment}
                    onSendToDev={
                      epic && ["backlog", "todo", "in_progress", "review"].includes(epic.status)
                        ? async () => {
                            try {
                              await sendToDev();
                              refresh();
                            } catch (error) {
                              if (isAgentAlreadyRunningError(error)) {
                                onAgentConflict?.({
                                  message: error.message,
                                  sessionUrl: error.sessionUrl || `/projects/${projectId}/sessions/${error.activeSessionId}`,
                                });
                              }
                            }
                          }
                        : undefined
                    }
                    sendToDevDisabled={dispatching || isRunning}
                    sendToDevLoading={dispatching}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}

      <AgentDispatchDialog
        open={resolveMergeOpen}
        onOpenChange={(open) => { setResolveMergeOpen(open); if (!open) setResolveMergeResumeSessionId(undefined); }}
        title="Resolve Merge Conflicts"
        description="Launch an agent to resolve merge conflicts for this epic."
        projectId={projectId}
        agentProps={{
          value: resolveMergeAgentId,
          onChange: setResolveMergeAgentId,
          className: "w-44 h-8 text-xs",
        }}
        sessionPicker={
          epicId
            ? {
                epicId,
                agentType: "merge",
                namedAgentId: resolveMergeAgentId,
                provider: "claude-code",
                selectedSessionId: resolveMergeResumeSessionId,
                onSelect: setResolveMergeResumeSessionId,
              }
            : undefined
        }
        confirmLabel="Dispatch Agent"
        confirmIcon={<Wrench className="h-4 w-4 mr-1" />}
        busy={resolvingMerge}
        confirmDisabled={resolvingMerge || isRunning}
        onConfirm={() => handleResolveMerge(resolveMergeAgentId, resolveMergeResumeSessionId)}
        onCancel={() => setResolveMergeOpen(false)}
      />

      <PermanentDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Epic"
        description="Permanently delete this epic and all related user stories."
        confirmLabel="Confirm Delete"
        deleting={deletingEpic}
        onConfirm={deleteEpic}
      />
    </div>
  );
}
