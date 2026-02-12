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
import { QuestionCards } from "@/components/chat/QuestionCards";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { User, Bot, Send, Loader2, Sparkles, Plus, X, RefreshCw } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";

interface CreateEpicSheetProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (epicId: string) => void;
}

interface ConversationTab {
  id: string;
  conversationId: string;
  label: string;
  status?: string;
}

export function CreateEpicSheet({
  projectId,
  open,
  onClose,
  onCreated,
}: CreateEpicSheetProps) {
  const [tabs, setTabs] = useState<ConversationTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const createTab = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "epic", label: "New Epic" }),
      });
      const json = await res.json();
      if (json.data) {
        const tab: ConversationTab = {
          id: `tab-${json.data.id}`,
          conversationId: json.data.id,
          label: json.data.label || "New Epic",
          status: json.data.status || "active",
        };
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
      }
    } catch {
      // ignore
    }
  }, [projectId]);

  // Load existing epic conversations on sheet open
  useEffect(() => {
    if (!open) return;
    if (loaded) return;

    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/conversations`);
        const json = await res.json();
        const data: Array<{ id: string; type: string; label: string; status: string }> = json.data || [];

        // Find existing epic conversations that are active or error
        const existingEpic = data.filter(
          (c) => c.type === "epic" && (c.status === "active" || c.status === "error")
        );

        if (existingEpic.length > 0) {
          const existingTabs = existingEpic.map((c) => ({
            id: `tab-${c.id}`,
            conversationId: c.id,
            label: c.label,
            status: c.status,
          }));
          setTabs(existingTabs);
          setActiveTabId(existingTabs[0].id);
        } else {
          // No existing conversations, create a new one
          await createTab();
        }
      } catch {
        await createTab();
      }
      setLoaded(true);
    })();
  }, [open, loaded, projectId, createTab]);

  function removeTab(tabId: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId && next.length > 0) {
        setActiveTabId(next[next.length - 1].id);
      }
      return next;
    });
  }

  function handleClose() {
    setTabs([]);
    setActiveTabId(null);
    setLoaded(false);
    onClose();
  }

  // Update tab label when conversation updates
  const updateTabLabel = useCallback((tabId: string, label: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, label } : t))
    );
  }, []);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent className="w-[500px] sm:max-w-[500px] flex flex-col p-0">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            New Epic
          </SheetTitle>
        </SheetHeader>

        {/* Tab bar */}
        {tabs.length > 0 && (
          <div className="border-b border-border flex items-center overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`group flex items-center gap-1 px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab.id === activeTabId
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.status === "error" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                )}
                {tab.label}
                {tabs.length > 1 && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTab(tab.id);
                    }}
                    className="ml-1 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={createTab}
              className="flex items-center justify-center w-7 h-7 mx-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="New epic conversation"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* All conversations rendered, only active visible */}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex-1 flex flex-col min-h-0 ${
              tab.id === activeTabId ? "" : "hidden"
            }`}
          >
            <EpicConversation
              projectId={projectId}
              conversationId={tab.conversationId}
              initialStatus={tab.status}
              onCreated={(epicId) => {
                onCreated(epicId);
                removeTab(tab.id);
                if (tabs.length <= 1) handleClose();
              }}
              onLabelChange={(label) => updateTabLabel(tab.id, label)}
            />
          </div>
        ))}
      </SheetContent>
    </Sheet>
  );
}

// ─── Inner conversation component ───────────────────────────────────────────

interface EpicConversationProps {
  projectId: string;
  conversationId: string;
  initialStatus?: string;
  onCreated: (epicId: string) => void;
  onLabelChange?: (label: string) => void;
}

function EpicConversation({
  projectId,
  conversationId,
  initialStatus,
  onCreated,
}: EpicConversationProps) {
  const {
    messages, sending, creating, epicCreationStatus, pendingQuestions, streamStatus,
    sendMessage, answerQuestions, createEpic,
  } = useEpicCreation(projectId, conversationId);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingQuestions]);

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
    }
  }

  const isError = epicCreationStatus === "error" || initialStatus === "error";
  const canCreate = messages.length >= 2 && !sending && !creating;

  return (
    <>
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
                <div className="flex-1 text-sm">
                  {msg.content ? (
                    <MarkdownContent content={msg.content} />
                  ) : (
                    <span className="animate-pulse text-muted-foreground">
                      {streamStatus || "..."}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {pendingQuestions && (
              <div className="mt-2">
                <QuestionCards
                  questions={pendingQuestions}
                  onSubmit={answerQuestions}
                  disabled={sending}
                />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* Create / Retry button */}
      {canCreate && (
        <div className="px-3 pb-1">
          <Button
            className="w-full"
            variant={isError ? "destructive" : "default"}
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating...
              </>
            ) : isError ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry Epic Creation
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
    </>
  );
}
