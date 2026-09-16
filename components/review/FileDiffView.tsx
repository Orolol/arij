"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, FileText, FilePlus, FileMinus, FileEdit } from "lucide-react";
import type { FileDiff } from "@/lib/git/diff";
import type { ReviewComment } from "@/hooks/useReviewComments";
import { Mono, Stamp } from "@/components/piscine";
import { DiffLine } from "./DiffLine";

interface FileDiffViewProps {
  file: FileDiff;
  comments: ReviewComment[];
  onAddComment: (filePath: string, lineNumber: number, body: string) => Promise<unknown>;
  onUpdateComment: (id: string, updates: { body?: string; status?: string }) => Promise<unknown>;
  onDeleteComment: (id: string) => Promise<unknown>;
  defaultExpanded?: boolean;
  disabled?: boolean;
}

const statusIcons: Record<string, typeof FileText> = {
  added: FilePlus,
  modified: FileEdit,
  deleted: FileMinus,
  renamed: FileEdit,
};

export function FileDiffView({
  file,
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  defaultExpanded = true,
  disabled,
}: FileDiffViewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const t = useTranslations("Review");
  const fileComments = comments.filter((c) => c.filePath === file.filePath);
  const openComments = fileComments.filter((c) => c.status === "open");
  const StatusIcon = statusIcons[file.status] || FileText;

  const additions = file.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "add").length,
    0
  );
  const deletions = file.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "del").length,
    0
  );

  return (
    <div className="border border-border/40 rounded-[10px] overflow-hidden bg-card">
      <button
        type="button"
        className="w-full flex items-center justify-start py-2 px-3 text-left hover:bg-accent/40 cursor-pointer bg-transparent border-0 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 mr-2 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 mr-2 text-muted-foreground" />
        )}
        <StatusIcon className="h-4 w-4 shrink-0 mr-2 text-muted-foreground" />
        <span className="text-sm font-mono truncate flex-1 text-left">
          {file.filePath}
        </span>
        {file.oldPath && (
          <span className="text-xs text-muted-foreground mr-2">
            {t("file.renamedFrom", { path: file.oldPath })}
          </span>
        )}
        {openComments.length > 0 && (
          <Stamp tone="live" className="mr-2">
            {t("file.comments", { count: openComments.length })}
          </Stamp>
        )}
        <Mono size={10} tone="muted" className="shrink-0 flex items-center gap-1">
          {additions > 0 && <span>+{additions}</span>}
          {deletions > 0 && <span>-{deletions}</span>}
        </Mono>
      </button>

      {expanded && (
        <div className="border-t border-border overflow-x-auto">
          {file.hunks.map((hunk, hunkIdx) => (
            <div key={hunkIdx}>
              <div className="bg-accent/30 px-3 py-1 text-xs text-muted-foreground font-mono">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </div>
              {hunk.lines.map((line, lineIdx) => (
                <DiffLine
                  key={`${hunkIdx}-${lineIdx}`}
                  line={line}
                  filePath={file.filePath}
                  comments={comments}
                  onAddComment={(lineNumber, body) =>
                    onAddComment(file.filePath, lineNumber, body)
                  }
                  onUpdateComment={onUpdateComment}
                  onDeleteComment={onDeleteComment}
                  disabled={disabled}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
