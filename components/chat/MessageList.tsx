"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { MarkdownContent } from "./MarkdownContent";
import type { ChatAttachment } from "@/hooks/useChat";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
  createdAt: string;
}

interface MessageListProps {
  messages: Message[];
  loading: boolean;
  streamStatus?: string | null;
}

export function MessageList({ messages, loading, streamStatus }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; alt: string } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!lightboxImage) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxImage(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [lightboxImage]);

  if (loading) {
    return (
      <div className="px-[18px] py-[18px] text-[13.5px] text-muted-foreground">
        Loading messages...
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="mt-8 px-[18px] text-center text-[13.5px] text-muted-foreground">
        Start a conversation to brainstorm your project with Claude
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-[14px] px-[18px] py-[18px]">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              data-role={msg.role}
              className={cn(
                "flex flex-col gap-2",
                isUser
                  ? "max-w-[80%] self-end rounded-[12px] rounded-br-[4px] bg-agent-bg px-[14px] py-[11px] text-[13.5px] leading-[1.55]"
                  : "max-w-[88%] self-start text-[13.5px] leading-[1.6]",
              )}
            >
              <div>
                {msg.content ? (
                  <MarkdownContent content={msg.content} />
                ) : (
                  <span className="animate-pulse text-muted-foreground">
                    {streamStatus || "..."}
                  </span>
                )}
              </div>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {msg.attachments.map((att) => (
                    <button
                      key={att.id}
                      onClick={() => setLightboxImage({ url: att.url, alt: att.fileName })}
                      className="block overflow-hidden rounded-[8px] border border-border transition-colors hover:border-primary"
                      type="button"
                    >
                      <img
                        src={att.url}
                        alt={att.fileName}
                        loading="lazy"
                        className="max-h-48 max-w-64 bg-muted object-contain"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Lightbox overlay */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 text-white/80 transition-colors hover:text-white"
            type="button"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={lightboxImage.url}
            alt={lightboxImage.alt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
