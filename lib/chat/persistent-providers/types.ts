import type { ChildProcess } from "child_process";
import type { StreamChunk } from "@/lib/claude/spawn";
import type { createChatCliToolChannel } from "@/lib/chat/cli-tool-channel";
import type { PersistentChatProvider } from "@/lib/agent-config/constants";

export type PersistentSessionState = "hot" | "cold";

export interface PersistentChatTurnOptions {
  conversationId: string;
  projectId: string;
  provider: PersistentChatProvider;
  prompt: string;
  cwd: string;
  mode: "plan" | "chat";
  model?: string;
  cliSessionId?: string;
  resumeSession?: boolean;
  conversationType: string | null;
  idleTimeoutMs?: number;
  maxWarmConversations?: number;
  turnStallTimeoutMs?: number;
  onChunk: (chunk: StreamChunk) => void;
  onCliSessionId?: (cliSessionId: string) => void;
}

export interface PersistentChatTurnHandle {
  /** Whether this turn reused an already-running process. */
  wasWarm: boolean;
  promise: Promise<void>;
  /** Cancels the turn by restarting the whole embedded CLI process. */
  kill: () => void;
}

export interface ActiveTurn {
  onChunk: (chunk: StreamChunk) => void;
  onCliSessionId?: (cliSessionId: string) => void;
  resolve: () => void;
  reject: (error: Error) => void;
  textDeltasEmitted: boolean;
  stallTimer: ReturnType<typeof setTimeout> | null;
  requestId?: string;
  fallbackText?: string;
  /**
   * Oh My Pi only. Kept as two fields with different lifetimes because they
   * answer different questions and one sticky flag conflated them:
   * - `messageError` describes the *latest* assistant message, so every
   *   assistant `message_end` overwrites it — including clearing it when a
   *   retried attempt finally settles cleanly.
   * - `retryError` is OMP declaring the whole retry ladder spent, so it
   *   survives later frames and is only lifted by an explicit recovery.
   */
  messageError?: string;
  retryError?: string;
}

export interface PersistentProcess {
  conversationId: string;
  provider: PersistentChatProvider;
  displayName: string;
  child: ChildProcess;
  channel: ReturnType<typeof createChatCliToolChannel>;
  mcpConfigPath: string | null;
  lastUsedAt: number;
  idleTimeoutMs: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  turnStallMs: number;
  activeTurn: ActiveTurn | null;
  stdoutBuffer: string;
  stderrTail: string;
  closing: boolean;
  cleanedUp: boolean;
  maxFrameBytes?: number;
  discoveredCliSessionId?: string;
  ready: Promise<void>;
  send: (
    prompt: string,
    onChunk: (chunk: StreamChunk) => void,
    onCliSessionId?: (cliSessionId: string) => void,
  ) => Promise<void>;
  terminate: (reason: string) => void;
}

export interface PersistentProviderAdapter {
  displayName: string;
  binary: string;
  /** Message when the binary is missing from PATH. */
  missingBinaryMessage: string;
  /**
   * Refuse the spawn before anything is allocated — no MCP token, no child.
   * A returned string is thrown to the caller as the turn's failure.
   */
  preflight?(): string | null | Promise<string | null>;
  /** Chat MCP token holder for this provider, or null when unavailable. */
  createChannel(
    options: PersistentChatTurnOptions,
  ): ReturnType<typeof createChatCliToolChannel>;
  /** Argv, environment, and any temp MCP config file to clean up later. */
  buildSpawn(
    options: PersistentChatTurnOptions,
    channel: ReturnType<typeof createChatCliToolChannel>,
  ): { args: string[]; env: NodeJS.ProcessEnv; mcpConfigPath: string | null };
  /**
   * Encodes one user turn as the bytes to write to stdin, plus the id the
   * event handler will correlate responses against. Throwing here rejects the
   * turn before it is registered, leaving the process reusable.
   */
  encodeTurnFrame(
    process: PersistentProcess,
    prompt: string,
  ): { frame: string; requestId?: string };
  /** Runs after the turn is registered but before its frame is written. */
  afterTurnRegistered?(
    process: PersistentProcess,
    onCliSessionId?: (cliSessionId: string) => void,
  ): void;
  /**
   * Wires provider-specific readiness and output handling. Returns the stdout
   * line handler plus a teardown hook for anything it armed.
   */
  attach(
    process: PersistentProcess,
    ready: ReadyControls,
    options: PersistentChatTurnOptions,
  ): { handleLine(line: string): void; dispose(): void };
}

export interface ReadyControls {
  resolve(): void;
  reject(error: Error): void;
  /** Whether `ready` has already resolved or rejected. */
  settled(): boolean;
}

/** Providers report progress/completion; the runner owns timers and teardown. */
export interface PersistentLifecycle {
  finishTurn(process: PersistentProcess, error?: Error): void;
  noteTurnProgress(process: PersistentProcess): void;
  cleanupProcess(process: PersistentProcess, error?: Error): void;
}
