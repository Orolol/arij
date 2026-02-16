"use client";

import { useDiff } from "@/hooks/useDiff";
import { useReviewComments } from "@/hooks/useReviewComments";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, FileCode, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileDiffView } from "./FileDiffView";
import { ReviewActions } from "./ReviewActions";

interface DiffViewerProps {
  projectId: string;
  epicId: string;
  epicStatus: string;
  onBackToDev: (comment: string) => Promise<unknown>;
  onApprove: () => Promise<unknown>;
  dispatching?: boolean;
  isRunning?: boolean;
}

export function DiffViewer({
  projectId,
  epicId,
  epicStatus,
  onBackToDev,
  onApprove,
  dispatching,
  isRunning,
}: DiffViewerProps) {
  const { files, loading: diffLoading, error: diffError, refresh: refreshDiff } = useDiff(projectId, epicId);
  const {
    comments,
    loading: commentsLoading,
    openCount,
    addComment,
    updateComment,
    deleteComment,
    resolveAll,
    refresh: refreshComments,
  } = useReviewComments(projectId, epicId);

  const totalAdditions = files.reduce(
    (sum, f) => sum + f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "add").length, 0),
    0
  );
  const totalDeletions = files.reduce(
    (sum, f) => sum + f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "del").length, 0),
    0
  );

  function handleRefresh() {
    refreshDiff();
    refreshComments();
  }

  if (diffLoading && files.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
        <span className="text-sm text-muted-foreground">Loading diff...</span>
      </div>
    );
  }

  if (diffError) {
    return (
      <div className="py-8 text-center space-y-2">
        <p className="text-sm text-destructive">{diffError}</p>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="py-8 text-center space-y-2">
        <FileCode className="h-8 w-8 mx-auto text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          No changes detected. The branch may not have diverged from main yet.
        </p>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className="gap-1 text-xs">
          <FileCode className="h-3 w-3" />
          {files.length} file{files.length !== 1 ? "s" : ""}
        </Badge>
        <Badge variant="outline" className="gap-1 text-xs text-green-500">
          +{totalAdditions}
        </Badge>
        <Badge variant="outline" className="gap-1 text-xs text-red-500">
          -{totalDeletions}
        </Badge>
        {openCount > 0 && (
          <Badge variant="outline" className="gap-1 text-xs text-blue-500 border-blue-500/30">
            <MessageSquare className="h-3 w-3" />
            {openCount} open comment{openCount !== 1 ? "s" : ""}
          </Badge>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-7 text-xs">
          <RefreshCw className={`h-3 w-3 mr-1 ${diffLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Review actions */}
      <ReviewActions
        projectId={projectId}
        epicId={epicId}
        epicStatus={epicStatus}
        openCount={openCount}
        comments={comments}
        onBackToDev={onBackToDev}
        onApprove={onApprove}
        onResolveAll={resolveAll}
        dispatching={dispatching}
        isRunning={isRunning}
      />

      {/* File diffs */}
      <ScrollArea className="max-h-[calc(100vh-300px)]">
        <div className="space-y-3 pb-4">
          {files.map((file) => (
            <FileDiffView
              key={file.filePath}
              file={file}
              comments={comments}
              onAddComment={addComment}
              onUpdateComment={updateComment}
              onDeleteComment={deleteComment}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
