"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { ChatMessage } from "@/hooks/useChat";
import type { Conversation } from "@/hooks/useConversations";
import type { ControlDeskPayload } from "@/lib/control-desk/types";

import type { ChatThreadResolvedTicket } from "./ChatThread";
import type { CreatedHereEntry } from "./CreatedHereCard";
import { epicsByMessageId } from "./message-epics";
import { longPlacement, shortPlacement } from "./placement";
import {
  flattenDeskTickets,
  normalizeTitle,
  uniqueTicketsByTitle,
  type DeskTicket,
} from "./ticket-bindings";

const EPIC_MAP_STORAGE_PREFIX = "arij.chat.epic-by-message.";

/**
 * The in-thread cards' identity has to survive a reload, and the in-memory map
 * does not. Storage is best-effort in both directions: a corrupt or
 * unavailable store falls through to the title heuristics, and never throws.
 */
function readStoredEpicMap(conversationId: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const raw = window.localStorage.getItem(
      `${EPIC_MAP_STORAGE_PREFIX}${conversationId}`,
    );
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return map;
    for (const [messageId, epicId] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof epicId === "string" && epicId) map.set(messageId, epicId);
    }
  } catch {
    // Private mode, a quota error, a hand-edited value — all the same answer.
  }
  return map;
}

function writeStoredEpicMap(conversationId: string, map: Map<string, string>) {
  try {
    window.localStorage.setItem(
      `${EPIC_MAP_STORAGE_PREFIX}${conversationId}`,
      JSON.stringify(Object.fromEntries(map)),
    );
  } catch {
    // Storage is an optimisation here, never a requirement.
  }
}

export interface EpicCreatedInThread {
  epicId: string;
  readableId: string | null;
  status: string;
}

/**
 * Which message drafted which epic, and what that epic has become.
 *
 * Lifted out of `ChatPageView` so the project side panel renders the SAME
 * in-thread epic cards as `/chat`: the panel used to draw its own "Proposed
 * epic" footer card that created the epic with a different payload (lot 10,
 * #52). Both hosts feed it the desk aggregate they already read.
 */
export function useThreadEpics({
  projectId,
  activeId,
  activeConversation,
  messages,
  desk,
  onDeskChanged,
}: {
  projectId: string;
  activeId: string | null;
  activeConversation: Conversation | null;
  messages: readonly ChatMessage[];
  desk: ControlDeskPayload | null;
  onDeskChanged: () => void;
}) {
  /*
    `placement.ts` is a pattern-3 table of FULL dotted keys read by a module a
    hook cannot reach, so it resolves through the namespace-less translator —
    the same split `components/piscine/TopBar.tsx` makes for `NAV_CATEGORIES`.
  */
  const tKey = useTranslations();

  // Memoised over `messages`: the JSON candidate scan is O(content) per
  // message, which is fine per change and NOT fine per render.
  const epicsByMessage = useMemo(() => epicsByMessageId(messages), [messages]);

  const [epicBindings, setEpicBindings] = useState(() => ({
    conversationId: activeId, map: activeId ? readStoredEpicMap(activeId) : new Map<string, string>(),
  }));
  if (epicBindings.conversationId !== activeId) setEpicBindings({
    conversationId: activeId, map: activeId ? readStoredEpicMap(activeId) : new Map<string, string>(),
  });
  const epicByMessage = epicBindings.map;
  /** Status seeded by the create response, so placement never starts at `—`. */
  const [createdMeta, setCreatedMeta] = useState<
    Map<string, { readableId: string | null; status: string }>
  >(() => new Map());

  const recordEpicBinding = useCallback(
    (messageId: string, created: EpicCreatedInThread) => {
      if (activeId) {
        // Persist to the conversation that started the request, even if the
        // user selected another one before creation completed.
        const saved = readStoredEpicMap(activeId);
        saved.set(messageId, created.epicId);
        writeStoredEpicMap(activeId, saved);
      }
      setEpicBindings((current) => current.conversationId === activeId
        ? { ...current, map: new Map(current.map).set(messageId, created.epicId) } : current);
      setCreatedMeta((current) => {
        const next = new Map(current);
        next.set(created.epicId, {
          readableId: created.readableId,
          status: created.status,
        });
        return next;
      });
      onDeskChanged();
    },
    [activeId, onDeskChanged],
  );

  const deskTickets = useMemo(() => flattenDeskTickets(desk, projectId), [desk, projectId]);
  const ticketsById = useMemo(() => {
    const map = new Map<string, DeskTicket>();
    for (const row of deskTickets) {
      // The status-bearing row (upNext) is inserted first and must win.
      if (!map.has(row.epicId) || map.get(row.epicId)?.status === null) {
        map.set(row.epicId, row);
      }
    }
    return map;
  }, [deskTickets]);

  /**
   * §7.4(c): the map is gone after a reload with no storage. Recover the
   * binding from the conversation's own epic link when exactly one message
   * declares an epic with that title, then from the desk's tickets by title.
   * A card that resolves to nothing is still fully actionable — that is the
   * point — but it must never show a `readableId` it did not resolve.
   */
  const resolvedEpicByMessage = useMemo(() => {
    const map = new Map(epicByMessage);

    const linkedEpicId = activeConversation?.epicId ?? null;
    const linked = linkedEpicId ? ticketsById.get(linkedEpicId) : null;
    if (linked) {
      const matches = [...epicsByMessage.entries()].filter(
        ([, parsed]) => normalizeTitle(parsed.title) === normalizeTitle(linked.title),
      );
      if (matches.length === 1 && !map.has(matches[0][0])) {
        map.set(matches[0][0], linked.epicId);
      }
    }

    const byTitle = uniqueTicketsByTitle(deskTickets);
    for (const [messageId, parsed] of epicsByMessage) {
      if (map.has(messageId)) continue;
      const hit = byTitle.get(normalizeTitle(parsed.title));
      if (hit) map.set(messageId, hit.epicId);
    }

    return map;
  }, [epicByMessage, epicsByMessage, activeConversation, ticketsById, deskTickets]);

  const resolveTicket = useCallback(
    (epicId: string): ChatThreadResolvedTicket => {
      const row = ticketsById.get(epicId);
      const seeded = createdMeta.get(epicId);
      const readableId = row?.readableId ?? seeded?.readableId ?? null;
      const status = row?.status ?? null;
      const rank = row?.rank ?? null;
      const seededStatus = seeded?.status ?? null;
      const currentPlacement = longPlacement(status, rank, tKey);
      const placement = currentPlacement ?? longPlacement(seededStatus, null, tKey);
      return { readableId, placement };
    },
    [ticketsById, createdMeta, tKey],
  );

  /* ---- the CREATED IN THIS CHAT rail ----------------------------------- */

  const createdHere: CreatedHereEntry[] = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const push = (epicId: string | null | undefined) => {
      if (!epicId || seen.has(epicId)) return;
      seen.add(epicId);
      ids.push(epicId);
    };

    push(activeConversation?.epicId);
    for (const epicId of resolvedEpicByMessage.values()) push(epicId);

    return ids.map((epicId) => {
      const row = ticketsById.get(epicId);
      const seeded = createdMeta.get(epicId);
      const parsed = [...resolvedEpicByMessage.entries()].find(
        ([, id]) => id === epicId,
      );
      const parsedTitle = parsed ? epicsByMessage.get(parsed[0])?.title : null;
      const status = row?.status ?? null;
      const rank = row?.rank ?? null;
      const seededStatus = seeded?.status ?? null;
      const currentPlacement = shortPlacement(status, rank, tKey);
      const placement = currentPlacement ?? shortPlacement(seededStatus, null, tKey);
      return {
        epicId,
        readableId: row?.readableId ?? seeded?.readableId ?? null,
        title: row?.title ?? parsedTitle ?? null,
        placement,
      };
    });
  }, [
    activeConversation,
    resolvedEpicByMessage,
    ticketsById,
    createdMeta,
    epicsByMessage,
    tKey,
  ]);

  return {
    epicsByMessage,
    resolvedEpicByMessage,
    resolveTicket,
    recordEpicBinding,
    createdHere,
  };
}
