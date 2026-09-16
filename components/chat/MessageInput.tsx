"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/components/documents/MentionTextarea";
import { ImageAttachmentStrip } from "@/components/shared/ImageAttachmentStrip";
import { useChatComposer, type ChatSend } from "@/hooks/useChatComposer";
import { ArrowRight, ImagePlus, Loader2 } from "lucide-react";

export type { PendingAttachment } from "@/hooks/useImageAttachments";

interface MessageInputProps {
  projectId: string;
  conversationId?: string | null;
  onSend: ChatSend;
  disabled?: boolean;
  /** Defaults to the catalogue's `input.placeholder` when the caller omits it. */
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
  conversationId,
  onSend,
  disabled: parentDisabled,
  placeholder,
  attachmentsDisabled = false,
}: MessageInputProps) {
  const t = useTranslations("ChatLegacy");
  const {
    value, setValue, attachments: effectiveAttachments, uploading, error,
    fileInputProps, openFilePicker, handlePaste, removeAttachment,
    handleSubmit, handleKeyDown, onCompositionStart, onCompositionEnd,
    hasContent, disabled,
  } = useChatComposer({ projectId, conversationId, onSend, disabled: parentDisabled, attachmentsDisabled });

  return (
    <div className="border-t border-border px-[18px] py-[14px]">
      {/* Attachment preview strip */}
      <ImageAttachmentStrip
        attachments={effectiveAttachments}
        onRemove={removeAttachment}
        uploading={uploading}
        className="mb-2"
      />

      <div className="flex items-end gap-[10px]">
        <MentionTextarea
          projectId={projectId}
          value={value}
          onValueChange={setValue}
          onKeyDown={handleKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onPaste={handlePaste}
          placeholder={placeholder ?? t("input.placeholder")}
          rows={2}
          className="min-h-[54px] resize-none rounded-[8px] text-[13.5px]"
          disabled={disabled}
        />
        <div className="flex shrink-0 flex-col gap-[6px]">
          <Button
            size="icon"
            variant="outline"
            onClick={openFilePicker}
            disabled={disabled || uploading || attachmentsDisabled}
            title={t("input.attachImage")}
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
            aria-label={t("input.send")}
            className="h-[30px] w-[30px] rounded-[8px] bg-primary"
          >
            <ArrowRight className="h-[14px] w-[14px]" />
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="mt-2 text-[12px] text-destructive">{error}</p>}
      <input {...fileInputProps} />
    </div>
  );
}
