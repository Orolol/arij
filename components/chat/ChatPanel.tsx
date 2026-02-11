"use client";

import { useChat } from "@/hooks/useChat";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface ChatPanelProps {
  projectId: string;
}

export function ChatPanel({ projectId }: ChatPanelProps) {
  const { messages, loading, sending, sendMessage } = useChat(projectId);
  const [generating, setGenerating] = useState(false);
  const router = useRouter();

  async function handleGenerateSpec() {
    setGenerating(true);
    try {
      await fetch(`/api/projects/${projectId}/generate-spec`, {
        method: "POST",
      });
      router.refresh();
    } catch {
      // ignore
    }
    setGenerating(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h3 className="font-medium text-sm">Chat</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={handleGenerateSpec}
          disabled={generating}
          className="text-xs"
        >
          {generating ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-3 w-3 mr-1" />
          )}
          Generate Spec & Plan
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        <MessageList messages={messages} loading={loading} />
      </div>
      <MessageInput onSend={sendMessage} disabled={sending} />
    </div>
  );
}
