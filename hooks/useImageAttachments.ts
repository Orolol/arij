"use client";

import { useTranslations } from "next-intl";

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
  /** Independent staging area within a project, e.g. a chat conversation. */
  scopeId?: string | null;
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
  scopeId,
  disabled = false,
}: UseImageAttachmentsOptions) {
  const tErrors = useTranslations("ClientErrors");
  const scope = JSON.stringify([projectId, scopeId ?? null]);
  type Staging = { attachments: PendingAttachment[]; pendingUploads: number; error: string | null; dragActive: boolean };
  const [staging, setStaging] = useState<Record<string, Staging>>({});
  const { attachments, pendingUploads, error, dragActive } = staging[scope] ?? {
    attachments: [], pendingUploads: 0, error: null, dragActive: false,
  };
  const update = useCallback((change: (current: Staging) => Staging) => {
    setStaging((current) => ({ ...current, [scope]: change(current[scope] ?? {
      attachments: [], pendingUploads: 0, error: null, dragActive: false,
    }) }));
  }, [scope]);
  const setAttachments = useCallback((action: React.SetStateAction<PendingAttachment[]>) => {
    update((current) => ({ ...current, attachments: typeof action === "function" ? action(current.attachments) : action }));
  }, [update]);
  const setPendingUploads = useCallback((action: React.SetStateAction<number>) => {
    update((current) => ({ ...current, pendingUploads: typeof action === "function" ? action(current.pendingUploads) : action }));
  }, [update]);
  const setError = useCallback((action: React.SetStateAction<string | null>) => {
    update((current) => ({ ...current, error: typeof action === "function" ? action(current.error) : action }));
  }, [update]);
  const setDragActive = useCallback((dragActive: boolean) => update((current) => ({ ...current, dragActive })), [update]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Each conversation keeps its draft, including uploads finishing while a
  // different conversation is selected. Clearing invalidates only that draft.
  const stagingSessionRef = useRef(new Map<string, number>());

  const uploading = pendingUploads > 0;

  /**
   * Tells the server the upload is not wanted after all.
   *
   * Fire-and-forget: the thumbnail is already gone from the strip and the user
   * has nothing to do about a failure. The route refuses anything a ticket or
   * a message has since claimed, so the worst case is a file that outlives its
   * form — never one deleted out from under a report that was filed with it.
   */
  const discardUpload = useCallback(
    (id: string) => {
      void fetch(`/api/projects/${projectId}/chat/uploads/${id}`, {
        method: "DELETE",
      }).catch(() => {});
    },
    [projectId]
  );

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
          return { error: `${file.name}: ${json?.error || tErrors("uploadFailed")}` };
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
        return { error: tErrors("uploadNamed", { name: file.name }) };
      }
    },
    [projectId, tErrors]
  );

  const uploadAccepted = useCallback(
    async (accepted: File[]) => {
      if (accepted.length === 0) return;

      const session = stagingSessionRef.current.get(scope) ?? 0;
      setPendingUploads((pending) => pending + 1);

      // A `.finally` call, not a `finally` clause (the React Compiler stops at
      // the clause). A cleared session already zeroed the counter; decrementing
      // on its behalf would drive the next transfer's count negative.
      const outcomes: UploadOutcome[] = await Promise.all(
        accepted.map(uploadFile)
      ).finally(() => {
        if ((stagingSessionRef.current.get(scope) ?? 0) === session) {
          setPendingUploads((pending) => pending - 1);
        }
      });

      // Answered into a form the caller has since submitted and reset. Staging
      // it now would attach a screenshot the user never sees to whatever they
      // write next — and leaving it alone would strand the file, since nothing
      // that survives this call knows it exists.
      if ((stagingSessionRef.current.get(scope) ?? 0) !== session) {
        for (const outcome of outcomes) {
          if (outcome.attachment) discardUpload(outcome.attachment.id);
        }
        return;
      }

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
    [discardUpload, uploadFile, scope, setPendingUploads, setAttachments, setError]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (disabled || files.length === 0) return;
      const { accepted, rejected } = partitionImageFiles(files);
      setError(formatImageRejections(rejected));
      void uploadAccepted(accepted);
    },
    [disabled, uploadAccepted, setError]
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
    [disabled, uploadAccepted, setError]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      const types = e.dataTransfer?.types;
      if (types && !Array.from(types).includes("Files")) return;
      e.preventDefault();
      setDragActive(true);
    },
    [disabled, setDragActive]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // dragleave also fires when the pointer crosses from one child to the
    // next, so dropping the highlight on those would make it flicker all the
    // way across the drop zone. Only a leave that lands outside counts.
    const movingTo = e.relatedTarget;
    if (movingTo instanceof Node && e.currentTarget.contains(movingTo)) return;
    setDragActive(false);
  }, [setDragActive]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      const files = imageFilesFromDrop(e.dataTransfer);
      if (files.length === 0) return;
      e.preventDefault();
      setDragActive(false);
      addFiles(files);
    },
    [addFiles, disabled, setDragActive]
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

  const remove = useCallback(
    (id: string) => {
      setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
      // Taking a thumbnail out of the strip is the user saying they do not
      // want the screenshot. Nothing else ever refers to it again, so the file
      // has to go now or it never will.
      discardUpload(id);
    },
    [discardUpload, setAttachments]
  );

  /**
   * Empties the staging area for a form that has *succeeded*: the uploads are
   * now owned by whatever was submitted, so the files stay.
   */
  const clear = useCallback(() => {
    stagingSessionRef.current.set(scope, (stagingSessionRef.current.get(scope) ?? 0) + 1);
    setPendingUploads(0);
    setAttachments([]);
    setError(null);
  }, [scope, setPendingUploads, setAttachments, setError]);

  /**
   * Empties the staging area for a form that has been *abandoned*: nothing was
   * submitted, so nothing claimed these uploads and they are deleted.
   */
  const discardAll = useCallback(() => {
    for (const attachment of attachments) {
      discardUpload(attachment.id);
    }
    clear();
  }, [attachments, clear, discardUpload]);

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
    discardAll,
  };
}
