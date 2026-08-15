import type Database from "better-sqlite3";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createId } from "@/lib/utils/nanoid";
import { sqlite } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  agentSessionChunks,
  agentSessionSequences,
  agentSessions,
} from "@/lib/db/schema";
import { extractLastNonEmptyText } from "@/lib/agent-sessions/last-text";

export type AgentSessionStreamType = "response" | "raw" | "output";

export interface SessionChunk {
  id: string;
  sessionId: string;
  streamType: AgentSessionStreamType;
  sequence: number;
  chunkKey: string | null;
  content: string;
  createdAt: string | null;
}

export interface AppendSessionChunkInput {
  sessionId: string;
  streamType: AgentSessionStreamType;
  content: string;
  chunkKey?: string | null;
  createdAt?: string;
}

export interface AppendSessionChunkResult {
  inserted: boolean;
  chunk: SessionChunk;
}

export interface SessionChunkStore {
  appendChunk: (input: AppendSessionChunkInput) => AppendSessionChunkResult;
  listChunks: (
    sessionId: string,
    streamType: AgentSessionStreamType
  ) => SessionChunk[];
}

type ChunkRow = {
  id: string;
  sessionId: string;
  streamType: string;
  sequence: number;
  chunkKey: string | null;
  content: string;
  createdAt: string | null;
};

/**
 * `stream_type` is a plain text column in the schema; the store is the layer
 * that narrows it back to the union the rest of the app works with.
 */
function toSessionChunk(row: ChunkRow): SessionChunk {
  return {
    ...row,
    streamType: row.streamType as AgentSessionStreamType,
  };
}

export function createSessionChunkStore(
  database: Database.Database
): SessionChunkStore {
  const db = drizzle(database, { schema });

  // Built here rather than at module scope so that importing this module
  // stays free of any schema/driver evaluation.
  const chunkColumns = {
    id: agentSessionChunks.id,
    sessionId: agentSessionChunks.sessionId,
    streamType: agentSessionChunks.streamType,
    sequence: agentSessionChunks.sequence,
    chunkKey: agentSessionChunks.chunkKey,
    content: agentSessionChunks.content,
    createdAt: agentSessionChunks.createdAt,
  };

  const selectExistingByKeyStmt = db
    .select(chunkColumns)
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType")),
        eq(agentSessionChunks.chunkKey, sql.placeholder("chunkKey"))
      )
    )
    .limit(1)
    .prepare();

  const reserveSequenceStmt = db
    .insert(agentSessionSequences)
    .values({
      sessionId: sql.placeholder("sessionId"),
      nextSequence: 2,
      updatedAt: sql.placeholder("updatedAt"),
    })
    .onConflictDoUpdate({
      target: agentSessionSequences.sessionId,
      set: {
        nextSequence: sql`${agentSessionSequences.nextSequence} + 1`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning({
      sequence: sql`next_sequence - 1`.mapWith(Number),
    })
    .prepare();

  const insertChunkStmt = db
    .insert(agentSessionChunks)
    .values({
      id: sql.placeholder("id"),
      sessionId: sql.placeholder("sessionId"),
      streamType: sql.placeholder("streamType"),
      sequence: sql.placeholder("sequence"),
      chunkKey: sql.placeholder("chunkKey"),
      content: sql.placeholder("content"),
      createdAt: sql.placeholder("createdAt"),
    })
    .prepare();

  const listChunksStmt = db
    .select(chunkColumns)
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType"))
      )
    )
    .orderBy(asc(agentSessionChunks.sequence))
    .prepare();

  const updateLastNonEmptyTextStmt = db
    .update(agentSessions)
    // Wrapped in `sql` because `.set()` only accepts SQL / literal values.
    .set({ lastNonEmptyText: sql`${sql.placeholder("lastNonEmptyText")}` })
    .where(eq(agentSessions.id, sql.placeholder("sessionId")))
    .prepare();

  function appendChunk(
    input: AppendSessionChunkInput
  ): AppendSessionChunkResult {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const chunkKey = input.chunkKey ?? null;

    if (chunkKey) {
      const existing = selectExistingByKeyStmt.get({
        sessionId: input.sessionId,
        streamType: input.streamType,
        chunkKey,
      });
      if (existing) {
        return {
          inserted: false,
          chunk: toSessionChunk(existing),
        };
      }
    }

    const sequenceRow = reserveSequenceStmt.get({
      sessionId: input.sessionId,
      updatedAt: createdAt,
    });
    if (!sequenceRow) {
      throw new Error(
        `Failed to reserve sequence for session ${input.sessionId}`
      );
    }

    const chunk: SessionChunk = {
      id: createId(),
      sessionId: input.sessionId,
      streamType: input.streamType,
      sequence: sequenceRow.sequence,
      chunkKey,
      content: input.content,
      createdAt,
    };

    insertChunkStmt.run({
      id: chunk.id,
      sessionId: chunk.sessionId,
      streamType: chunk.streamType,
      sequence: chunk.sequence,
      chunkKey: chunk.chunkKey,
      content: chunk.content,
      createdAt: chunk.createdAt ?? createdAt,
    });

    if (input.streamType === "output" || input.streamType === "response") {
      const lastNonEmptyText = extractLastNonEmptyText(input.content);
      if (lastNonEmptyText) {
        updateLastNonEmptyTextStmt.run({
          lastNonEmptyText,
          sessionId: input.sessionId,
        });
      }
    }

    return {
      inserted: true,
      chunk,
    };
  }

  return {
    appendChunk(input: AppendSessionChunkInput): AppendSessionChunkResult {
      return db.transaction(() => appendChunk(input));
    },
    listChunks(
      sessionId: string,
      streamType: AgentSessionStreamType
    ): SessionChunk[] {
      return listChunksStmt.all({ sessionId, streamType }).map(toSessionChunk);
    },
  };
}

let defaultStore: SessionChunkStore | null = null;

function getDefaultStore(): SessionChunkStore {
  if (!defaultStore) {
    defaultStore = createSessionChunkStore(sqlite);
  }
  return defaultStore;
}

export function appendSessionChunk(
  input: AppendSessionChunkInput
): AppendSessionChunkResult {
  return getDefaultStore().appendChunk(input);
}

export function listSessionChunks(
  sessionId: string,
  streamType: AgentSessionStreamType
): SessionChunk[] {
  return getDefaultStore().listChunks(sessionId, streamType);
}
