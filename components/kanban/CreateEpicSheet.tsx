"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEpicCreation } from "@/hooks/useEpicCreation";
import { User, Bot, Send, Loader2, Sparkles } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface CreateEpicSheetProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (epicId: string) => void;
}

export function CreateEpicSheet({
  projectId,
  open,
  onClose,
  onCreated,
}: CreateEpicSheetProps) {
  const { messages, sending, creating, sendMessage, createEpic, reset } =
    useEpicCreation(projectId);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    sendMessage(trimmed);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleCreate() {
    const epicId = await createEpic();
    if (epicId) {
      onCreated(epicId);
      reset();
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  const canCreate = messages.length >= 2 && !sending && !creating;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent className="w-[450px] sm:max-w-[450px] flex flex-col p-0">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            New Epic
          </SheetTitle>
        </SheetHeader>

        {/* Chat area */}
        <ScrollArea className="flex-1 min-h-0">
          {messages.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center mt-8">
              Describe the epic you want to create. Claude will help you refine
              it before generating user stories.
            </div>
          ) : (
            <div className="p-3 space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className="flex gap-2">
                  <div className="shrink-0 mt-0.5">
                    {msg.role === "user" ? (
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-3 w-3" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                        <Bot className="h-3 w-3" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-sm whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex gap-2">
                  <div className="shrink-0 mt-0.5">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="h-3 w-3" />
                    </div>
                  </div>
                  <div className="flex-1 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline" />{" "}
                    Thinking...
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

        {/* Create button */}
        {canCreate && (
          <div className="px-3 pb-1">
            <Button
              className="w-full"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create Epic & Generate User Stories
                </>
              )}
            </Button>
          </div>
        )}

        {/* Input area */}
        <div className="p-3 border-t border-border">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your epic..."
              rows={2}
              className="resize-none text-sm"
              disabled={sending || creating}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={sending || creating || !input.trim()}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
