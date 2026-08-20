"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageAttachmentStrip } from "@/components/shared/ImageAttachmentStrip";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { PRIORITY_LABELS } from "@/lib/types/kanban";
import { cn } from "@/lib/utils";
import { ImagePlus, Loader2 } from "lucide-react";

interface BugCreateDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  namedAgentId?: string | null;
}

export function BugCreateDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
  namedAgentId = null,
}: BugCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("2");
  const [submitMode, setSubmitMode] = useState<"create" | "create_and_fix" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = submitMode !== null;

  const {
    attachments,
    uploading,
    error: attachmentError,
    dragActive,
    fileInputProps,
    openFilePicker,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    remove: removeAttachment,
    clear: clearAttachments,
  } = useImageAttachments({ projectId });

  function resetForm() {
    setTitle("");
    setDescription("");
    setPriority("2");
    clearAttachments();
  }

  async function handleSubmit(mode: "create" | "create_and_fix" = "create") {
    if (!title.trim() || uploading) return;
    setSubmitMode(mode);
    setError(null);

    const images = attachments.map((a) => a.filePath).filter(Boolean);

    try {
      const createRes = await fetch(`/api/projects/${projectId}/bugs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority: Number(priority),
          // Omitted entirely when nothing is attached, so a bug without a
          // screenshot posts exactly the payload it posted before.
          ...(images.length > 0 ? { images } : {}),
        }),
      });

      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok || createData.error) {
        setError(createData.error || "Failed to create bug");
        return;
      }

      const createdBugId = createData?.data?.id as string | undefined;
      if (mode === "create_and_fix") {
        if (!createdBugId) {
          setError("Bug created, but failed to start fix agent: missing bug ID");
          resetForm();
          onCreated?.();
          return;
        }

        const buildRes = await fetch(
          `/api/projects/${projectId}/epics/${createdBugId}/build`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ namedAgentId }),
          }
        );
        const buildData = await buildRes.json().catch(() => ({}));
        if (!buildRes.ok || buildData.error) {
          const reason = buildData.error ? `: ${buildData.error}` : "";
          setError(`Bug created, but failed to start fix agent${reason}`);
          resetForm();
          onCreated?.();
          return;
        }
      }

      resetForm();
      onOpenChange(false);
      onCreated?.();
    } catch {
      setError(
        mode === "create_and_fix"
          ? "Failed to create bug and start fix agent"
          : "Failed to create bug"
      );
    } finally {
      setSubmitMode(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[14px] shadow-[0_18px_40px_rgba(58,48,44,.14)] sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold">New Bug</DialogTitle>
        </DialogHeader>

        <div
          className={cn(
            "space-y-4 rounded-[10px] py-2 transition-colors",
            dragActive && "bg-muted/40 outline-2 outline-dashed outline-primary/60"
          )}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          data-testid="bug-create-drop-zone"
        >
          <div>
            <label className="mb-1 block text-[12.5px] text-muted-foreground">
              Title *
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bug title..."
              onKeyDown={(e) => e.key === "Enter" && handleSubmit("create")}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-[12.5px] text-muted-foreground">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual behavior..."
              rows={4}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-[12.5px] text-muted-foreground">
                Screenshots
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={openFilePicker}
                disabled={submitting || uploading}
                className="h-[26px] rounded-[7px] px-2 text-[12px]"
              >
                <ImagePlus className="mr-1 h-3 w-3" />
                Attach image
              </Button>
            </div>

            <ImageAttachmentStrip
              attachments={attachments}
              onRemove={removeAttachment}
              uploading={uploading}
              className="mb-2"
            />

            <p className="text-[11.5px] text-muted-foreground">
              Paste a screenshot with Ctrl/Cmd+V, drop an image here, or attach one.
            </p>

            {attachmentError && (
              <p className="mt-1 text-xs text-destructive" role="alert">
                {attachmentError}
              </p>
            )}

            <input {...fileInputProps} />
          </div>

          <div>
            <label className="mb-1 block text-[12.5px] text-muted-foreground">
              Priority
            </label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="h-[29px] rounded-[7px] text-[12.5px]">
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

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleSubmit("create")}
            disabled={!title.trim() || submitting || uploading}
            variant="destructive"
          >
            {submitMode === "create" && (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            )}
            Create Bug
          </Button>
          <Button
            onClick={() => handleSubmit("create_and_fix")}
            disabled={!title.trim() || submitting || uploading}
            variant="destructive"
          >
            {submitMode === "create_and_fix" && (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            )}
            Create And Fix
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
