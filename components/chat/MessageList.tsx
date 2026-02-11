"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useRef } from "react";
import { User, Bot } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface MessageListProps {
  messages: Message[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (loading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Loading messages...
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center mt-8">
        Start a conversation to brainstorm your project with Claude
      </div>
    );
  }

  return (
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
          <div className="flex-1 text-sm whitespace-pre-wrap">{msg.content}</div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
