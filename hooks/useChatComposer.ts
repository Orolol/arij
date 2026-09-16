"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import type { ChatSendResult } from "@/hooks/useChat";

type SendResult = void | boolean | ChatSendResult;
export type ChatSend = (content: string, attachmentIds: string[]) => SendResult | Promise<SendResult>;

function wasAccepted(result: SendResult): boolean {
  return typeof result === "object" ? result.accepted : result !== false;
}

/** Text, images and submission have the same rules on both chat surfaces. */
export function useChatComposer({ projectId, conversationId, disabled = false, attachmentsDisabled = false, onSend }: {
  projectId: string | null;
  conversationId?: string | null;
  disabled?: boolean;
  attachmentsDisabled?: boolean;
  onSend: ChatSend;
}) {
  const t = useTranslations("ClientErrors");
  const scope = JSON.stringify([projectId, conversationId ?? null]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Set<string>>(() => new Set());
  const pending = useRef(new Set<string>());
  const [sendErrors, setSendErrors] = useState<Record<string, string | null>>({});
  const composing = useRef(false);
  const value = drafts[scope] ?? "";
  const setValue = (value: string) => setDrafts((current) => ({ ...current, [scope]: value }));
  const locked = disabled || submitting.has(scope);
  const images = useImageAttachments({ projectId: projectId ?? "", scopeId: conversationId, disabled: attachmentsDisabled || locked });
  const attachments = attachmentsDisabled ? [] : images.attachments;
  const hasContent = value.trim().length > 0 || attachments.length > 0;

  function handleSubmit() {
    if (!hasContent || locked || images.uploading || pending.current.has(scope)) return;
    pending.current.add(scope);
    setSubmitting((current) => new Set(current).add(scope));
    setSendErrors((current) => ({ ...current, [scope]: null }));
    // Clear text optimistically; retain its exact draft and the staged images
    // until the sender confirms, so a rejected request is recoverable.
    setValue("");
    const finish = (accepted: boolean) => {
      if (accepted) {
        if (!attachmentsDisabled) images.clear();
      } else {
        setDrafts((current) => ({ ...current, [scope]: current[scope] || value }));
      }
      pending.current.delete(scope);
      setSubmitting((current) => { const next = new Set(current); next.delete(scope); return next; });
    };
    const fail = () => {
      setSendErrors((current) => ({ ...current, [scope]: t("failedToSendMessage") }));
      finish(false);
    };
    try {
      const result = onSend(value.trim(), attachments.map((attachment) => attachment.id));
      if (result && typeof result === "object" && "then" in result) {
        void result.then((outcome) => finish(wasAccepted(outcome)), fail);
      } else {
        finish(wasAccepted(result));
      }
    } catch {
      fail();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey || composing.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void handleSubmit();
  }

  return {
    value, setValue, attachments, hasContent, disabled: locked,
    uploading: images.uploading, error: sendErrors[scope] || images.error,
    fileInputProps: images.fileInputProps, openFilePicker: images.openFilePicker,
    handlePaste: images.handlePaste,
    removeAttachment: (id: string) => { if (!locked) images.remove(id); },
    handleSubmit, handleKeyDown,
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: () => { composing.current = false; },
  };
}
