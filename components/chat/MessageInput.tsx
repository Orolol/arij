"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/components/documents/MentionTextarea";
import { ArrowRight, ImagePlus, X, Loader2 } from "lucide-react";

export interface PendingAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  previewUrl: string;
}

interface MessageInputProps {
  projectId: string;
  onSend: (content: string, attachmentIds: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Disables the image-attach button, paste-to-attach, and file picker.
   * Set when the active conversation runs on a provider that cannot take
   * image attachments (OpenAI-compatible fast mode).
   */
  attachmentsDisabled?: boolean;
}

export function MessageInput({
  projectId,
  onSend,
  disabled,
  placeholder = "Ask a question...",
  attachmentsDisabled = false,
}: MessageInputProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File): Promise<PendingAttachment | null> => {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch(`/api/projects/${projectId}/chat/upload`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) return null;

        const { data } = await res.json();
        return {
          id: data.id,
          fileName: data.fileName,
          mimeType: data.mimeType,
          previewUrl: `/api/projects/${projectId}/chat/uploads/${data.id}`,
        };
      } catch {
        return null;
      }
    },
    [projectId]
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      setUploading(true);
      const results = await Promise.all(files.map(uploadFile));
      const successful = results.filter((r): r is PendingAttachment => r !== null);
      setAttachments((prev) => [...prev, ...successful]);
      setUploading(false);
    },
    [uploadFile]
  );

  function handleSubmit() {
    const trimmed = value.trim();
    const effectiveAttachments = attachmentsDisabled ? [] : attachments;
    if ((!trimmed && effectiveAttachments.length === 0) || disabled || uploading) return;
    onSend(trimmed, effectiveAttachments.map((a) => a.id));
    setValue("");
    setAttachments([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (attachmentsDisabled || !items) return;

    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const ext = file.type.split("/")[1] || "png";
          const named = new File([file], `pasted-image-${Date.now()}.${ext}`, {
            type: file.type,
          });
          imageFiles.push(named);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      uploadFiles(imageFiles);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (attachmentsDisabled || !files?.length) return;
    uploadFiles(Array.from(files));
    e.target.value = "";
  }

  const effectiveAttachments = attachmentsDisabled ? [] : attachments;
  const hasContent = value.trim().length > 0 || effectiveAttachments.length > 0;

  return (
    <div className="border-t border-border px-[18px] py-[14px]">
      {/* Attachment preview strip */}
      {(effectiveAttachments.length > 0 || uploading) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {effectiveAttachments.map((att) => (
            <div key={att.id} className="relative group">
              <img
                src={att.previewUrl}
                alt={att.fileName}
                className="h-16 w-16 object-cover rounded-md border border-border"
              />
              <button
                onClick={() => removeAttachment(att.id)}
                className="absolute -top-1.5 -right-1.5 bg-destructive text-background rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {uploading && (
            <div className="h-16 w-16 rounded-md border border-border flex items-center justify-center bg-muted">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-[10px]">
        <MentionTextarea
          projectId={projectId}
          value={value}
          onValueChange={setValue}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={2}
          className="min-h-[54px] resize-none rounded-[8px] text-[13.5px]"
          disabled={disabled}
        />
        <div className="flex shrink-0 flex-col gap-[6px]">
          <Button
            size="icon"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading || attachmentsDisabled}
            title="Attach image"
            type="button"
            className="h-[30px] w-[30px] rounded-[8px]"
          >
            {uploading ? (
              <Loader2 className="h-[14px] w-[14px] animate-spin" />
            ) : (
              <ImagePlus className="h-[14px] w-[14px]" />
            )}
          </Button>
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={disabled || !hasContent || uploading}
            aria-label="Send message"
            className="h-[30px] w-[30px] rounded-[8px] bg-primary"
          >
            <ArrowRight className="h-[14px] w-[14px]" />
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/png,image/jpg,image/jpeg,image/gif,image/webp"
        multiple
        onChange={handleFileSelect}
      />
    </div>
  );
}
