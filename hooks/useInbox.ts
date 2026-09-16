"use client";

import { useTranslations } from "next-intl";
import { useState, useCallback, useEffect, useRef } from "react";
import { usePolledResource } from "@/hooks/usePolledResource";
import { markRead as markTicketRead, replyToEpic } from "@/lib/inbox/client";
import type { InboxData, InboxItem } from "@/lib/inbox/types";

export type { InboxItem } from "@/lib/inbox/types";

const EMPTY_ITEMS: InboxItem[] = [];

/** Cross-project inbox. Confirmed writes invalidate older polling snapshots. */
export function useInbox({ summaryOnly = false, enabled = true }: { summaryOnly?: boolean; enabled?: boolean } = {}) {
  const [requestedPage, setPage] = useState(1);
  const t = useTranslations("Inbox");
  const tErrors = useTranslations("ClientErrors");
  const loadError = useCallback(() => t("loadError"), [t]);
  const { data, loading, error, refresh } = usePolledResource<InboxData>(
    !enabled ? null : summaryOnly ? "/api/inbox?summary=1" : requestedPage === 1 ? "/api/inbox" : `/api/inbox?page=${requestedPage}`, 5000, loadError,
  );
  // Reading the final item can remove the requested page. Adopt the server's
  // clamped page before rendering; future arrivals must not jump us back to an
  // old page number. usePolledResource only exposes data for the current URL.
  const confirmedPage = data?.pagination?.page;
  if (confirmedPage !== undefined && Number.isSafeInteger(confirmedPage)
      && confirmedPage >= 1 && confirmedPage < requestedPage) {
    setPage(confirmedPage);
  }
  const latestRefresh = useRef(refresh);
  useEffect(() => { latestRefresh.current = refresh; }, [refresh]);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const markRead = useCallback(async (epicId: string) => {
    setMutationError(null);
    const result = await markTicketRead(epicId, t("row.markReadError"));
    if (result.error !== null) throw new Error(result.error);
    await latestRefresh.current();
  }, [t]);

  const reply = useCallback(async (
    item: Pick<InboxItem, "projectId" | "epicId">,
    content: string,
  ) => {
    const result = await replyToEpic(item, content, tErrors("failedToPostReply"));
    if (result.error !== null) throw new Error(result.error);
    // The reply is durable even if the separate read cursor cannot be saved.
    const marked = await markRead(item.epicId).then(() => true, () => false);
    if (!marked) {
      setMutationError(t("row.markReadError"));
      await latestRefresh.current();
    }
  }, [markRead, t, tErrors]);

  const retry = useCallback(async () => {
    setMutationError(null);
    await refresh();
  }, [refresh]);

  return {
    page: data?.pagination?.page ?? requestedPage,
    totalPages: data?.pagination?.totalPages ?? 1,
    setPage,
    items: data?.items ?? EMPTY_ITEMS,
    unreadCount: data?.unreadCount ?? 0,
    unreadMessageCount: data?.unreadMessageCount ?? 0,
    awaitingReplyCount: data?.awaitingReplyCount ?? 0,
    loading,
    error: mutationError ?? error,
    markRead,
    reply,
    refresh: retry,
  };
}
