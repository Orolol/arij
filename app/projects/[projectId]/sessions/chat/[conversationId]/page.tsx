"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/i18n/format";
import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  BreathingDot,
  IdentityChip,
  Mono,
  PillButton,
  Stamp,
  type StampTone,
  SurfaceCard,
} from "@/components/piscine";
import { MessageList } from "@/components/chat/MessageList";
import { useSessionPolling } from "@/components/session-live/useSessionPolling";
import {
  ArrowLeft,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Calendar,
  Hash,
} from "lucide-react";
import { PROVIDER_LABELS } from "@/lib/agent-config/constants";
import {
  BRAINSTORM_AGENT_TYPE,
  CHAT_AGENT_TYPE,
  EPIC_CREATION_AGENT_TYPE,
  isEpicCreationConversationAgentType,
  normalizeConversationAgentType,
} from "@/lib/chat/conversation-agent";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/catalogue";

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

const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  active: "ProjectSessions.conversation.statuses.active",
  generating: "ProjectSessions.conversation.statuses.generating",
  generated: "ProjectSessions.conversation.statuses.generated",
  completed: "ProjectSessions.conversation.statuses.completed",
  error: "ProjectSessions.conversation.statuses.error",
};

function statusStampTone(status: string): StampTone {
  if (status === "generating") return "live";
  if (status === "error") return "failed";
  if (status === "active") return "next";
  if (status === "generated" || status === "completed") return "land";
  return "next";
}

export default function ChatDetailPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const conversationId = params.conversationId as string;
  return <ChatDetailContent key={`${projectId}:${conversationId}`} projectId={projectId} conversationId={conversationId} />;
}

function ChatDetailContent({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const locale = useLocale();
  const t = useTranslations("ProjectSessions");
  const tKey = useTranslations();
  const tErrors = useTranslations("ClientErrors");
  const readFailed = tErrors("unableToLoadTheConversationTryAgain");
  const [meta, setMeta] = useState<ConversationMeta | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    setRefreshing(true);
    let nextMeta: ConversationMeta | null = null;
    let nextMessages: ChatMessage[] | null = null;
    let notFound = false;
    try {
      const [metaRes, messagesRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/conversations/${conversationId}`, { signal }),
        fetch(`/api/projects/${projectId}/chat?conversationId=${conversationId}`, { signal }),
      ]);
      notFound = metaRes.status === 404;
      if (metaRes.ok) {
        const body = await metaRes.json();
        nextMeta = body.data;
      }
      if (messagesRes.ok) {
        const body = await messagesRes.json();
        nextMessages = body.data;
      }
    } catch {
      // Keep a previously loaded transcript available while the read is retried.
    }
    if (signal.aborted) return;
    if (notFound) {
      setMeta(null);
      setMessages([]);
      setError(null);
    } else if (nextMeta && Array.isArray(nextMessages)) {
      setMeta(nextMeta);
      setMessages(nextMessages);
      setError(null);
    } else {
      setError(readFailed);
    }
    setLoading(false);
    setRefreshing(false);
  }, [projectId, conversationId, readFailed]);

  const handleRefresh = useSessionPolling(`${projectId}:${conversationId}`, load, meta?.status === "generating", 3000, { immediate: true });

  if (loading) {
    return (
      <div className="p-6 text-muted-foreground">
        {t("conversation.loading")}
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="p-6">
        <Link
          href={`/projects/${projectId}/sessions`}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="h-3 w-3" /> {t("conversation.back")}
        </Link>
        <p role={error ? "alert" : undefined} className="text-muted-foreground text-sm">
          {error ?? t("conversation.notFound")}
        </p>
        {error && (
          <PillButton
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {t("conversation.refresh")}
          </PillButton>
        )}
      </div>
    );
  }

  // Creators write `epic_creation` and this route returns the raw column, so
  // the legacy literal `epic` alone never matched a recent conversation.
  const TypeIcon = isEpicCreationConversationAgentType(meta.type)
    ? Sparkles
    : MessageSquare;
  // The stored `type` is an enum value (`epic_creation`), not a word. An
  // unknown kind still shows its raw value, which is data and never a key.
  const kind = normalizeConversationAgentType(meta.type);
  const kindLabel =
    kind === BRAINSTORM_AGENT_TYPE
      ? t("conversation.kinds.brainstorm")
      : kind === EPIC_CREATION_AGENT_TYPE
        ? t("conversation.kinds.epicCreation")
        : kind === CHAT_AGENT_TYPE
          ? t("conversation.kinds.chat")
          : meta.type;
  const isGenerating = meta.status === "generating";
  const statusKey = meta.status ? STATUS_LABEL_KEYS[meta.status] : null;
  const statusLabel = statusKey ? tKey(statusKey) : meta.status;

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-[16px] p-[24px]">
      {/* Back link */}
      <Link
        href={`/projects/${projectId}/sessions`}
        className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> {t("conversation.back")}
      </Link>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {/* Identity line */}
      <div
        data-testid="conversation-identity"
        className="flex flex-wrap items-center gap-[10px]"
      >
        {isGenerating ? (
          <BreathingDot size={6} />
        ) : (
          <TypeIcon className="h-4 w-4 text-meta" />
        )}
        <span data-testid="conversation-kind" className="shrink-0">
          <Mono size={11} weight={700} tone="feed-deep" className="uppercase">
            {kindLabel}
          </Mono>
        </span>
        {statusLabel && (
          <Stamp tone={statusStampTone(meta.status ?? "")} dot={isGenerating}>
            {statusLabel}
          </Stamp>
        )}
        {meta.namedAgentName ? (
          <IdentityChip label={meta.namedAgentName} size="sm" />
        ) : meta.provider && meta.provider !== "claude-code" ? (
          <IdentityChip
            label={
              PROVIDER_LABELS[meta.provider as keyof typeof PROVIDER_LABELS] ??
              meta.provider
            }
            size="sm"
          />
        ) : null}

        <div className="ml-auto flex items-center gap-[8px]">
          <Link href={`/chat?conversation=${conversationId}`}>
            <PillButton variant="outline" size="sm">
              {t("conversation.openInChat")}
            </PillButton>
          </Link>
          <PillButton
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={cn("h-3 w-3", refreshing && "animate-spin")}
            />
            {t("conversation.refresh")}
          </PillButton>
        </div>
      </div>

      <h2 className="text-[18px] font-medium leading-[1.3]">{meta.label}</h2>

      {/* Key/value rows */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-4 border-t border-border-soft py-[11px]">
          <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Calendar className="h-[13px] w-[13px]" />
            {t("conversation.created")}
          </span>
          <span className="text-[13px]">
            {formatDateTime(meta.createdAt, { locale, style: "dateTimeSeconds" })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 border-y border-border-soft py-[11px]">
          <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Hash className="h-[13px] w-[13px]" />
            {t("conversation.messages")}
          </span>
          <span className="font-mono text-[13px]">{messages.length}</span>
        </div>
      </div>

      {/* Message history */}
      <SurfaceCard radius={12} className="overflow-hidden p-0">
        <MessageList
          messages={messages}
          loading={false}
          streamStatus={isGenerating ? t("conversation.generating") : null}
        />
      </SurfaceCard>
    </div>
  );
}
