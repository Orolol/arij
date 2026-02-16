"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus } from "lucide-react";
import type { DiffLine as DiffLineType } from "@/lib/git/diff";
import type { ReviewComment } from "@/hooks/useReviewComments";
import { InlineCommentForm } from "./InlineCommentForm";
import { InlineCommentThread } from "./InlineCommentThread";

interface DiffLineProps {
  line: DiffLineType;
  filePath: string;
  comments: ReviewComment[];
  onAddComment: (lineNumber: number, body: string) => Promise<unknown>;
  onUpdateComment: (id: string, updates: { body?: string; status?: string }) => Promise<unknown>;
  onDeleteComment: (id: string) => Promise<unknown>;
}

export function DiffLine({
  line,
  filePath,
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: DiffLineProps) {
  const [showCommentForm, setShowCommentForm] = useState(false);
  const lineNumber = line.newLineNumber ?? line.oldLineNumber;
  const lineComments = comments.filter(
    (c) => c.filePath === filePath && c.lineNumber === lineNumber
  );

  const bgClass =
    line.type === "add"
      ? "bg-green-500/10"
      : line.type === "del"
        ? "bg-red-500/10"
        : "";

  const textClass =
    line.type === "add"
      ? "text-green-400"
      : line.type === "del"
        ? "text-red-400"
        : "text-muted-foreground";

  const prefix =
    line.type === "add" ? "+" : line.type === "del" ? "-" : " ";

  return (
    <>
      <div className={`flex group hover:bg-accent/30 ${bgClass}`}>
        <span className="w-12 shrink-0 text-right pr-2 select-none text-xs text-muted-foreground/50 font-mono leading-6">
          {line.oldLineNumber ?? ""}
        </span>
        <span className="w-12 shrink-0 text-right pr-2 select-none text-xs text-muted-foreground/50 font-mono leading-6">
          {line.newLineNumber ?? ""}
        </span>
        <span className={`flex-1 text-xs font-mono leading-6 whitespace-pre-wrap break-all ${textClass}`}>
          {prefix}
          {line.content}
        </span>
        <span className="w-8 shrink-0 flex items-center justify-center">
          {lineNumber != null && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setShowCommentForm(!showCommentForm)}
            >
              <MessageSquarePlus className="h-3 w-3" />
            </Button>
          )}
        </span>
      </div>

      {lineComments.length > 0 && (
        <div className="ml-24 mr-8 my-1">
          <InlineCommentThread
            comments={lineComments}
            onUpdate={onUpdateComment}
            onDelete={onDeleteComment}
          />
        </div>
      )}

      {showCommentForm && lineNumber != null && (
        <div className="ml-24 mr-8 my-1">
          <InlineCommentForm
            onSubmit={async (body) => {
              await onAddComment(lineNumber, body);
              setShowCommentForm(false);
            }}
            onCancel={() => setShowCommentForm(false)}
          />
        </div>
      )}
    </>
  );
}
