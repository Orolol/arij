"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  Loader2,
  MessageSquare,
  Sparkles,
} from "lucide-react";

// --- Discriminated union types ---

interface AgentSession {
  kind: "agent_session";
  id: string;
  status: string;
  mode: string;
  provider?: string;
  epicId?: string;
  branchName?: string;
  startedAt?: string;
  endedAt?: string;
  completedAt?: string;
  lastNonEmptyText?: string;
  error?: string;
  agentType?: string;
  claudeSessionId?: string;
  namedAgentName?: string | null;
  model?: string | null;
  createdAt: string;
}

interface ChatSession {
  kind: "chat_session";
  id: string;
  type: string;
  label: string;
  status: string | null;
  epicId?: string | null;
  provider?: string | null;
  namedAgentId?: string | null;
  namedAgentName?: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  createdAt: string;
}

type UnifiedSession = AgentSession | ChatSession;

const AGENT_TYPE_LABELS: Record<string, string> = {
  build: "Build",
  ticket_build: "Ticket",
  team_build: "Team",
  review_security: "Security",
  review_code: "Code Review",
  review_compliance: "Compliance",
  review_feature: "Feature Review",
  merge: "Merge",
  tech_check: "Tech Check",
};

const STATUS_CONFIG: Record<
  string,
  { icon: typeof Clock; color: string; label: string }
> = {
  queued: { icon: Clock, color: "text-muted-foreground", label: "Queued" },
  pending: { icon: Clock, color: "text-muted-foreground", label: "Pending" },
  running: { icon: Loader2, color: "text-yellow-500", label: "Running" },
  completed: {
    icon: CheckCircle2,
    color: "text-green-500",
    label: "Completed",
  },
  failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
  cancelled: { icon: Ban, color: "text-muted-foreground", label: "Cancelled" },
};

export default function SessionsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [items, setItems] = useState<UnifiedSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, [projectId]);

  async function loadSessions() {
    const res = await fetch(`/api/projects/${projectId}/sessions`);
    const data = await res.json();
    setItems(data.data || []);
    setLoading(false);
  }

  function getDuration(session: AgentSession): string {
    if (!session.startedAt) return "-";
    const start = new Date(session.startedAt).getTime();
    const endAt = session.endedAt || session.completedAt;
    const end = endAt
      ? new Date(endAt).getTime()
      : Date.now();
    const seconds = Math.floor((end - start) / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  if (loading) {
    return (
      <div className="p-6 text-muted-foreground">Loading sessions...</div>
    );
  }

  const agentSessions = items.filter((i): i is AgentSession => i.kind === "agent_session");
  const chatSessions = items.filter((i): i is ChatSession => i.kind === "chat_session");

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Sessions</h2>
        <div className="flex gap-2 text-xs text-muted-foreground">
          <span>{agentSessions.filter((s) => s.status === "running").length} running</span>
          <span>{agentSessions.filter((s) => s.status === "completed").length} completed</span>
          <span>{agentSessions.filter((s) => s.status === "failed").length} failed</span>
          {chatSessions.length > 0 && (
            <span>{chatSessions.length} chats</span>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No sessions yet</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) =>
            item.kind === "agent_session" ? (
              <AgentSessionCard
                key={`agent-${item.id}`}
                session={item}
                projectId={projectId}
                getDuration={getDuration}
              />
            ) : (
              <ChatSessionCard
                key={`chat-${item.id}`}
                session={item}
                projectId={projectId}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function AgentSessionCard({
  session,
  projectId,
  getDuration,
}: {
  session: AgentSession;
  projectId: string;
  getDuration: (s: AgentSession) => string;
}) {
  const config =
    STATUS_CONFIG[session.status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <Link href={`/projects/${projectId}/sessions/${session.id}`}>
      <Card className="p-4 hover:bg-accent/50 transition-colors cursor-pointer">
        <div className="flex items-center gap-3">
          <Icon
            className={`h-4 w-4 shrink-0 ${config.color} ${
              session.status === "running" ? "animate-spin" : ""
            }`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                #{session.id.slice(0, 8)}
              </span>
              {session.agentType && (
                <Badge variant="secondary" className="text-[10px]">
                  {AGENT_TYPE_LABELS[session.agentType] || session.agentType}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {session.mode}
              </Badge>
              {session.namedAgentName ? (
                <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30">
                  {session.namedAgentName}
                </Badge>
              ) : session.provider && session.provider !== "claude-code" ? (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  {session.provider === "codex" ? "Codex" : session.provider === "gemini-cli" ? "Gemini" : session.provider}
                </Badge>
              ) : null}
              {session.model && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  {session.model}
                </span>
              )}
              {session.claudeSessionId && (
                <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/30">
                  resumable
                </Badge>
              )}
              {session.branchName && (
                <span className="text-xs text-muted-foreground font-mono truncate">
                  {session.branchName}
                </span>
              )}
            </div>
            {session.error && (
              <p className="text-xs text-destructive mt-1 truncate">
                {session.error}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-muted-foreground">
              {getDuration(session)}
            </div>
            {session.status === "running" &&
              session.lastNonEmptyText && (
                <div className="text-xs text-muted-foreground max-w-56 truncate">
                  {session.lastNonEmptyText}
                </div>
              )}
            <div className="text-xs text-muted-foreground">
              {new Date(session.createdAt).toLocaleDateString()}{" "}
              {new Date(session.createdAt).toLocaleTimeString()}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ChatSessionCard({
  session,
  projectId,
}: {
  session: ChatSession;
  projectId: string;
}) {
  const isGenerating = session.status === "generating";
  const TypeIcon = session.type === "epic" ? Sparkles : MessageSquare;

  return (
    <Link href={`/projects/${projectId}/sessions/chat/${session.id}`}>
      <Card className="p-4 hover:bg-accent/50 transition-colors cursor-pointer">
        <div className="flex items-center gap-3">
          {isGenerating ? (
            <Loader2 className="h-4 w-4 shrink-0 text-yellow-500 animate-spin" />
          ) : (
            <TypeIcon className="h-4 w-4 shrink-0 text-blue-400" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {session.label}
              </span>
              <Badge className="text-[10px] bg-blue-500/20 text-blue-400 border-blue-400/30">
                Chat
              </Badge>
              {session.namedAgentName ? (
                <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30">
                  {session.namedAgentName}
                </Badge>
              ) : session.provider && session.provider !== "claude-code" ? (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  {session.provider === "codex" ? "Codex" : session.provider === "gemini-cli" ? "Gemini" : session.provider}
                </Badge>
              ) : null}
              {session.messageCount > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {session.messageCount} message{session.messageCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {session.lastMessagePreview && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {session.lastMessagePreview}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-muted-foreground">
              {new Date(session.createdAt).toLocaleDateString()}{" "}
              {new Date(session.createdAt).toLocaleTimeString()}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
