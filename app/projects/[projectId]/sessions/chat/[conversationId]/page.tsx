"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MessageList } from "@/components/chat/MessageList";
import {
  ArrowLeft,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Calendar,
  Hash,
  Loader2,
} from "lucide-react";
import { PROVIDER_LABELS } from "@/lib/agent-config/constants";

interface ConversationMeta {
  id: string;
  projectId: string;
  type: string;
  label: string;
  status: string | null;
  epicId: string | null;
  provider: string | null;
  namedAgentId: string | null;
  namedAgentName: string | null;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: {
    id: string;
    fileName: string;
    mimeType: string;
    url: string;
  }[];
  createdAt: string;
}

export default function ChatDetailPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const conversationId = params.conversationId as string;

  const [meta, setMeta] = useState<ConversationMeta | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    const [metaRes, msgsRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/conversations/${conversationId}`),
      fetch(`/api/projects/${projectId}/chat?conversationId=${conversationId}`),
    ]);
    const metaJson = await metaRes.json();
    const msgsJson = await msgsRes.json();

    if (metaJson.data) setMeta(metaJson.data);
    if (msgsJson.data) setMessages(msgsJson.data);
  }, [projectId, conversationId]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // Auto-poll every 3s when status is "generating"
  useEffect(() => {
    if (meta?.status === "generating") {
      pollRef.current = setInterval(() => {
        fetchData();
      }, 3000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [meta?.status, fetchData]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <div className="p-6 text-muted-foreground">Loading conversation...</div>
    );
  }

  if (!meta) {
    return (
      <div className="p-6">
        <Link
          href={`/projects/${projectId}/sessions`}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="h-3 w-3" /> Back to sessions
        </Link>
        <p className="text-muted-foreground text-sm">Conversation not found</p>
      </div>
    );
  }

  const TypeIcon = meta.type === "epic" ? Sparkles : MessageSquare;
  const isGenerating = meta.status === "generating";

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back link */}
      <Link
        href={`/projects/${projectId}/sessions`}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> Back to sessions
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {isGenerating ? (
            <Loader2 className="h-5 w-5 text-yellow-500 animate-spin" />
          ) : (
            <TypeIcon className="h-5 w-5 text-blue-400" />
          )}
          <h2 className="text-xl font-bold">{meta.label}</h2>
          <Badge className="text-xs bg-blue-500/20 text-blue-400 border-blue-400/30">
            {meta.type}
          </Badge>
          {meta.status && (
            <Badge
              variant="outline"
              className={`text-xs ${
                isGenerating
                  ? "text-yellow-400 border-yellow-400/30"
                  : meta.status === "error"
                  ? "text-red-400 border-red-400/30"
                  : "text-muted-foreground"
              }`}
            >
              {meta.status}
            </Badge>
          )}
          {meta.namedAgentName ? (
            <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30">
              {meta.namedAgentName}
            </Badge>
          ) : meta.provider && meta.provider !== "claude-code" ? (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {PROVIDER_LABELS[meta.provider as keyof typeof PROVIDER_LABELS] ?? meta.provider}
            </Badge>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Metadata cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card className="p-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Created</div>
            <div className="text-sm">
              {new Date(meta.createdAt).toLocaleDateString()}{" "}
              {new Date(meta.createdAt).toLocaleTimeString()}
            </div>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-2">
          <Hash className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Messages</div>
            <div className="text-sm">{messages.length}</div>
          </div>
        </Card>
      </div>

      {/* Message history */}
      <Card className="overflow-hidden">
        <MessageList
          messages={messages}
          loading={false}
          streamStatus={isGenerating ? "Generating..." : null}
        />
      </Card>
    </div>
  );
}
