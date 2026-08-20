"use client";

import { useCallback, useRef, useState } from "react";
import {
  IMAGE_UPLOAD_ACCEPT,
  formatImageRejections,
  imageFilesFromClipboard,
  imageFilesFromDrop,
  partitionImageFiles,
} from "@/lib/uploads/image-attachments";

export interface PendingAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  /** Repo-relative path on disk, e.g. `data/uploads/<projectId>/<file>`. */
  filePath: string;
  previewUrl: string;
}

export interface UseImageAttachmentsOptions {
  projectId: string;
  /**
   * Makes every entry point inert without discarding what is already staged.
   * Set by the chat composer when the active provider cannot take images.
   */
  disabled?: boolean;
}

interface UploadOutcome {
  attachment?: PendingAttachment;
  error?: string;
}

/**
 * Staging area for image attachments: upload transfer, clipboard paste, drag
 * and drop, the file picker, and per-item removal.
 *
 * Shared by the chat composer (`MessageInput`) and the bug creation modal
 * (`BugCreateDialog`) so the transfer to `/chat/upload` exists in one place.
 */
export function useImageAttachments({
  projectId,
  disabled = false,
}: UseImageAttachmentsOptions) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File): Promise<UploadOutcome> => {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch(`/api/projects/${projectId}/chat/upload`, {
          method: "POST",
          body: formData,
        });

        const json = await res
          .json()
          .catch(() => ({} as { data?: PendingAttachment; error?: string }));

        if (!res.ok || !json?.data) {
          return { error: `${file.name}: ${json?.error || "upload failed"}` };
        }

        const data = json.data;
        return {
          attachment: {
            id: data.id,
            fileName: data.fileName,
            mimeType: data.mimeType,
            filePath: data.filePath ?? "",
            previewUrl: `/api/projects/${projectId}/chat/uploads/${data.id}`,
          },
        };
      } catch {
        return { error: `${file.name}: upload failed` };
      }
    },
    [projectId]
  );

  const uploadAccepted = useCallback(
    async (accepted: File[]) => {
      if (accepted.length === 0) return;

      setUploading(true);
      const outcomes = await Promise.all(accepted.map(uploadFile));
      setUploading(false);

      const uploaded = outcomes
        .map((outcome) => outcome.attachment)
        .filter((attachment): attachment is PendingAttachment => Boolean(attachment));
      if (uploaded.length > 0) {
        setAttachments((prev) => [...prev, ...uploaded]);
      }

      const failures = outcomes
        .map((outcome) => outcome.error)
        .filter((message): message is string => Boolean(message));
      if (failures.length > 0) {
        setError((prev) => [prev, ...failures].filter(Boolean).join(" · "));
      }
    },
    [uploadFile]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (disabled || files.length === 0) return;
      const { accepted, rejected } = partitionImageFiles(files);
      setError(formatImageRejections(rejected));
      void uploadAccepted(accepted);
    },
    [disabled, uploadAccepted]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (disabled) return;

      const files = imageFilesFromClipboard(e.clipboardData);
      if (files.length === 0) return;

      const { accepted, rejected } = partitionImageFiles(files);
      setError(formatImageRejections(rejected));
      // Only swallow the paste when an image actually lands; the text the
      // clipboard also carries must still reach the field otherwise.
      if (accepted.length > 0) {
        e.preventDefault();
        void uploadAccepted(accepted);
      }
    },
    [disabled, uploadAccepted]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      const types = e.dataTransfer?.types;
      if (types && !Array.from(types).includes("Files")) return;
      e.preventDefault();
      setDragActive(true);
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // dragleave also fires when the pointer crosses from one child to the
    // next, so dropping the highlight on those would make it flicker all the
    // way across the drop zone. Only a leave that lands outside counts.
    const movingTo = e.relatedTarget;
    if (movingTo instanceof Node && e.currentTarget.contains(movingTo)) return;
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      const files = imageFilesFromDrop(e.dataTransfer);
      if (files.length === 0) return;
      e.preventDefault();
      setDragActive(false);
      addFiles(files);
    },
    [addFiles, disabled]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files?.length) {
        addFiles(Array.from(files));
      }
      e.target.value = "";
    },
    [addFiles]
  );

  const openFilePicker = useCallback(() => {
    if (disabled) return;
    fileInputRef.current?.click();
  }, [disabled]);

  const remove = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  const clear = useCallback(() => {
    setAttachments([]);
    setError(null);
  }, []);

  const fileInputProps = {
    ref: fileInputRef,
    type: "file" as const,
    className: "hidden",
    accept: IMAGE_UPLOAD_ACCEPT,
    multiple: true,
    onChange: handleFileSelect,
  };

  return {
    attachments,
    uploading,
    error,
    dragActive,
    fileInputProps,
    openFilePicker,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    remove,
    clear,
  };
}
