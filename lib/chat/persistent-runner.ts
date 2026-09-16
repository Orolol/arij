import { createChildKiller } from "@/lib/providers/process-signals";
import { spawn as nodeSpawn, type ChildProcess } from "child_process";
import { StringDecoder } from "node:string_decoder";
import { cleanupMcpConfigFile } from "@/lib/claude/mcp-injection";
import { createClaudeAdapter } from "./persistent-providers/claude";
import { createOmpAdapter } from "./persistent-providers/oh-my-pi";
import { createPiAdapter } from "./persistent-providers/pi";
import type {
  ActiveTurn,
  PersistentChatTurnHandle,
  PersistentChatTurnOptions,
  PersistentProcess,
  PersistentProviderAdapter,
  PersistentSessionState,
  ReadyControls,
} from "./persistent-providers/types";

export type { PersistentChatTurnHandle, PersistentChatTurnOptions, PersistentSessionState } from "./persistent-providers/types";

export const DEFAULT_PERSISTENT_CHAT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_WARM_CHAT_CONVERSATIONS = 3;
/**
 * Deadline on a *silent* turn: how long an in-flight turn may go without any
 * frame from the CLI before Arij declares it wedged. Distinct from the idle
 * timeout, which only reclaims processes between turns. Without this, a CLI
 * that never emits its terminal frame pins its warm slot and its MCP token
 * forever, because the idle reaper refuses to touch a process with an
 * `activeTurn`.
 */
export const DEFAULT_PERSISTENT_CHAT_TURN_STALL_MS = 5 * 60 * 1000;

interface PersistentRunnerGlobalState {
  processes: Map<string, PersistentProcess>;
}

const GLOBAL_STATE_KEY = Symbol.for("arij.chat.persistent-runner");

function globalState(): PersistentRunnerGlobalState {
  const root = globalThis as typeof globalThis & {
    [GLOBAL_STATE_KEY]?: PersistentRunnerGlobalState;
  };
  root[GLOBAL_STATE_KEY] ??= { processes: new Map() };
  return root[GLOBAL_STATE_KEY];
}

function normalizedIdleTimeout(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value!)
    : DEFAULT_PERSISTENT_CHAT_IDLE_TIMEOUT_MS;
}

function normalizedTurnStall(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value!)
    : DEFAULT_PERSISTENT_CHAT_TURN_STALL_MS;
}

function normalizedWarmCap(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value!)
    : DEFAULT_MAX_WARM_CHAT_CONVERSATIONS;
}

function clearStallTimer(turn: ActiveTurn | null): void {
  if (!turn?.stallTimer) return;
  clearTimeout(turn.stallTimer);
  turn.stallTimer = null;
}

function finishTurn(process: PersistentProcess, error?: Error): void {
  const turn = process.activeTurn;
  if (!turn) return;
  clearStallTimer(turn);
  process.activeTurn = null;
  process.lastUsedAt = Date.now();
  scheduleIdleReap(process);
  if (error) turn.reject(error);
  else turn.resolve();
}

function formatStallDelay(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 120) return `${seconds}s`;
  return `${Math.round(seconds / 60)} minutes`;
}

/**
 * (Re)arms the silent-turn deadline. Called when a turn starts and again on
 * every frame the CLI sends for it, so a slow-but-talking turn is never cut
 * off — only a turn that has gone completely quiet.
 */
function armTurnStallWatchdog(process: PersistentProcess): void {
  const turn = process.activeTurn;
  if (!turn) return;
  clearStallTimer(turn);
  turn.stallTimer = setTimeout(() => {
    finishTurn(
      process,
      new Error(
        `${process.displayName} sent nothing for ${formatStallDelay(process.turnStallMs)} ` +
          "and the turn never completed. The persistent session was restarted; " +
          "send your message again.",
      ),
    );
    // The CLI is wedged, not merely slow: drop the process so its warm slot
    // and MCP token return to the pool instead of being pinned forever.
    process.terminate("turn stalled");
  }, process.turnStallMs);
  turn.stallTimer.unref?.();
}

/** Any frame for the active turn counts as progress against the deadline. */
function noteTurnProgress(process: PersistentProcess): void {
  if (process.activeTurn) armTurnStallWatchdog(process);
}

function scheduleIdleReap(process: PersistentProcess): void {
  if (process.idleTimer) clearTimeout(process.idleTimer);
  process.idleTimer = setTimeout(() => {
    if (!process.activeTurn) process.terminate("idle timeout");
  }, process.idleTimeoutMs);
  process.idleTimer.unref?.();
}

function removeProcess(process: PersistentProcess): void {
  const processes = globalState().processes;
  if (processes.get(process.conversationId) === process) {
    processes.delete(process.conversationId);
  }
}

function cleanupProcess(process: PersistentProcess, error?: Error): void {
  if (process.cleanedUp) return;
  process.cleanedUp = true;
  if (process.idleTimer) clearTimeout(process.idleTimer);
  process.idleTimer = null;
  cleanupMcpConfigFile(process.mcpConfigPath);
  process.resourceCleanup?.();
  process.channel?.release();
  removeProcess(process);
  if (process.activeTurn) {
    const turn = process.activeTurn;
    clearStallTimer(turn);
    process.activeTurn = null;
    const failure =
      error ??
      new Error(
        process.stderrTail.trim() ||
          `Persistent ${process.displayName} process stopped unexpectedly`,
      );
    turn.reject(failure);
  }
}

function spawnPersistentProcess(
  adapter: PersistentProviderAdapter,
  options: PersistentChatTurnOptions,
): PersistentProcess {
  // Before the MCP token and the child: a precondition that makes the spawn
  // unsafe rather than merely unlucky (an omp too old to honour --tools).
  // getOrSpawn() runs inside the turn promise, so throwing here rejects the
  // turn with this reason and leaves no process registered.

  const channel = adapter.createChannel(options);
  let prepared: ReturnType<PersistentProviderAdapter["buildSpawn"]> | null = null;
  let child: ChildProcess;
  try {
    prepared = adapter.buildSpawn(options, channel);
    child = nodeSpawn(adapter.binary, prepared.args, {
      cwd: options.cwd,
      env: prepared.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
  } catch (error) {
    // A synchronous failure has no child error/close event to release these.
    prepared?.cleanup?.();
    cleanupMcpConfigFile(prepared?.mcpConfigPath ?? null);
    channel?.release();
    throw error;
  }
  const { mcpConfigPath } = prepared;

  const killer = createChildKiller(() => child);

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // `send()` awaits `ready` and surfaces a spawn failure to the caller, but a
  // turn cancelled between spawn and the first `send()` never awaits it. Keep
  // a permanent no-op handler so a late `error` event cannot become an
  // unhandled rejection (fatal in Node outside dev).
  void ready.catch(() => {});
  const readyControls: ReadyControls = {
    resolve() {
      if (readySettled) return;
      readySettled = true;
      resolveReady();
    },
    reject(error) {
      if (readySettled) return;
      readySettled = true;
      rejectReady(error);
    },
    settled: () => readySettled,
  };

  const persistent: PersistentProcess = {
    conversationId: options.conversationId,
    provider: options.provider,
    displayName: adapter.displayName,
    child,
    channel,
    mcpConfigPath,
    resourceCleanup: prepared.cleanup,
    configurationKey: configurationKey(options),
    lastUsedAt: Date.now(),
    idleTimeoutMs: normalizedIdleTimeout(options.idleTimeoutMs),
    idleTimer: null,
    turnStallMs: normalizedTurnStall(options.turnStallTimeoutMs),
    activeTurn: null,
    stdoutBuffer: "",
    stderrTail: "",
    closing: false,
    cleanedUp: false,
    maxFrameBytes: undefined,
    discoveredCliSessionId: options.cliSessionId,
    ready,
    async send(prompt, onChunk, onCliSessionId) {
      await ready;
      if (persistent.closing || !persistent.child.stdin?.writable) {
        // A child that already exited has usually said why on stderr; that
        // beats reporting the symptom ("not writable") back to the user.
        const exited = persistent.child.exitCode !== null;
        throw new Error(
          (exited && persistent.stderrTail.trim()) ||
            `Persistent ${adapter.displayName} process is not writable`,
        );
      }
      if (persistent.activeTurn) {
        throw new Error("This conversation already has a turn in progress");
      }
      // Encode before registering: a frame this process cannot carry must
      // fail the turn without leaving one half-registered behind.
      const { frame, requestId } = adapter.encodeTurnFrame(persistent, prompt);
      if (persistent.idleTimer) clearTimeout(persistent.idleTimer);
      persistent.idleTimer = null;
      await new Promise<void>((resolve, reject) => {
        persistent.activeTurn = {
          onChunk,
          onCliSessionId,
          resolve,
          reject,
          textDeltasEmitted: false,
          stallTimer: null,
          requestId,
        };
        armTurnStallWatchdog(persistent);
        try {
          adapter.afterTurnRegistered?.(persistent, onCliSessionId);
        } catch (error) {
          // No bytes were sent: a failing observer must release the turn,
          // while the process itself can still accept a later message.
          finishTurn(persistent, asError(error));
          return;
        }
        try {
          persistent.child.stdin!.write(frame, (error) => {
            if (error) failProcess(error, "input write failed");
          });
        } catch (error) {
          failProcess(asError(error), "input write failed");
        }
      });
    },
    terminate(reason) {
      if (persistent.closing) return;
      persistent.closing = true;
      // Cancellation and capacity eviction can happen before provider ready.
      // No turn is registered yet, but send() is already awaiting this promise.
      readyControls.reject(new Error(`Persistent chat session stopped: ${reason}`));
      attached.dispose();
      removeProcess(persistent);
      if (persistent.idleTimer) clearTimeout(persistent.idleTimer);
      persistent.idleTimer = null;
      if (persistent.activeTurn) {
        const turn = persistent.activeTurn;
        clearStallTimer(turn);
        persistent.activeTurn = null;
        turn.reject(new Error(`Persistent chat session stopped: ${reason}`));
      }
      if (persistent.provider === "pi-persistent") {
        // Pi's private MCP config and token must not outlive the request to
        // stop, even while the process group is still draining. Both are
        // idempotent, so cleanupProcess repeating them is harmless.
        persistent.channel?.release();
        persistent.resourceCleanup?.();
      }
      killer.kill();
      void killer.waitForTeardown().then(() => cleanupProcess(persistent));
    },
  };

  const attached = adapter.attach(persistent, readyControls, options);
  const stdoutDecoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");

  function failProcess(error: Error, reason: string): void {
    readyControls.reject(error);
    finishTurn(persistent, error);
    attached.dispose();
    persistent.terminate(reason);
  }

  function handleLine(line: string): void {
    if (persistent.closing) return;
    try {
      attached.handleLine(line);
    } catch (error) {
      // Protocol/observer exceptions occur on an EventEmitter callback, not
      // inside send's promise. Reject that turn instead of crashing the host.
      failProcess(asError(error), "output handling failed");
    }
  }

  child.stdin?.on("error", (error: Error) => failProcess(error, "input write failed"));
  child.stdout?.on("data", (chunk: Buffer) => {
    persistent.stdoutBuffer += stdoutDecoder.write(chunk);
    const lines = persistent.stdoutBuffer.split("\n");
    persistent.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    persistent.stderrTail = `${persistent.stderrTail}${stderrDecoder.write(chunk)}`.slice(-4000);
  });
  child.once("error", (error) => {
    attached.dispose();
    const spawnError = new Error(
      error.message.includes("ENOENT")
        ? adapter.missingBinaryMessage
        : `Failed to spawn ${adapter.displayName} CLI: ${error.message}`,
    );
    readyControls.reject(spawnError);
    cleanupProcess(persistent, spawnError);
  });
  child.once("close", () => {
    if (!killer.isKilled()) killer.clear();
    attached.dispose();
    persistent.stdoutBuffer += stdoutDecoder.end();
    persistent.stderrTail = `${persistent.stderrTail}${stderrDecoder.end()}`.slice(-4000);
    // A child that dies before it is usable must fail `ready`, or every later
    // `send()` waits on a promise nothing will ever settle.
    readyControls.reject(
      new Error(
        persistent.stderrTail.trim() ||
          `Persistent ${adapter.displayName} process stopped before it was ready`,
      ),
    );
    if (persistent.stdoutBuffer.trim()) {
      handleLine(persistent.stdoutBuffer);
      persistent.stdoutBuffer = "";
    }
    cleanupProcess(persistent);
  });
  scheduleIdleReap(persistent);
  return persistent;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

const lifecycle = { finishTurn, noteTurnProgress, cleanupProcess };
const claudeAdapter = createClaudeAdapter(lifecycle);
const ompAdapter = createOmpAdapter(lifecycle);
const piAdapter = createPiAdapter(lifecycle);

function adapterFor(provider: PersistentChatTurnOptions["provider"]): PersistentProviderAdapter {
  if (provider === "claude-code-persistent") return claudeAdapter;
  if (provider === "pi-persistent") return piAdapter;
  return ompAdapter;
}

/** Spawn-shaping options: a warm process whose key differs is respawned. */
function configurationKey(options: PersistentChatTurnOptions): string {
  return JSON.stringify([
    options.projectId,
    options.cwd,
    options.mode,
    options.model,
    options.cliOptions ?? {},
    options.conversationType,
  ]);
}

function evictForCapacity(maxWarmConversations: number, exceptConversationId: string): void {
  const candidates = [...globalState().processes.values()]
    .filter(
      (process) =>
        process.conversationId !== exceptConversationId && !process.activeTurn,
    )
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
  while (
    globalState().processes.size >= maxWarmConversations &&
    candidates.length > 0
  ) {
    candidates.shift()!.terminate("warm conversation limit reached");
  }
  if (globalState().processes.size >= maxWarmConversations) {
    throw new Error(
      `All ${maxWarmConversations} persistent chat sessions are busy; try again shortly.`,
    );
  }
}

function getOrSpawn(options: PersistentChatTurnOptions): PersistentProcess {
  const existing = globalState().processes.get(options.conversationId);
  if (existing && existing.provider === options.provider && existing.configurationKey === configurationKey(options) && !existing.closing) {
    existing.idleTimeoutMs = normalizedIdleTimeout(options.idleTimeoutMs);
    return existing;
  }
  existing?.terminate("provider changed");
  const cap = normalizedWarmCap(options.maxWarmConversations);
  evictForCapacity(cap, options.conversationId);
  const spawned = spawnPersistentProcess(adapterFor(options.provider), options);
  globalState().processes.set(options.conversationId, spawned);
  return spawned;
}

export function runPersistentChatTurn(
  options: PersistentChatTurnOptions,
): PersistentChatTurnHandle {
  const existing = globalState().processes.get(options.conversationId);
  const wasWarm = Boolean(
    existing && existing.provider === options.provider && existing.configurationKey === configurationKey(options) && !existing.closing,
  );
  let process: PersistentProcess | null = null;
  let cancelled = false;
  const promise = Promise.resolve().then(async () => {
    if (cancelled) throw new Error("Persistent chat turn was cancelled");
    const adapter = adapterFor(options.provider);
    const preflight = adapter.preflight?.();
    const blocked = preflight instanceof Promise ? await preflight : preflight;
    if (blocked) throw new Error(blocked);
    if (cancelled) throw new Error("Persistent chat turn was cancelled");
    process = getOrSpawn(options);
    if (cancelled) {
      process.terminate("turn cancelled");
      throw new Error("Persistent chat turn was cancelled");
    }
    await process.send(options.prompt, options.onChunk, options.onCliSessionId);
  });
  // The caller (the SSE route) only attaches its handler once the response
  // body starts being read, several ticks later. A turn that fails before
  // then — a stall deadline, a spawn error — would otherwise reject with no
  // handler attached. This marks it handled without consuming it: `promise`
  // itself still rejects for whoever awaits it.
  void promise.catch(() => {});
  return {
    wasWarm,
    promise,
    kill: () => {
      cancelled = true;
      process?.terminate("turn cancelled");
    },
  };
}

export function isPersistentChatSessionWarm(conversationId: string): boolean {
  const process = globalState().processes.get(conversationId);
  return Boolean(process && !process.closing);
}

export function getPersistentChatSessionState(
  conversationId: string,
): PersistentSessionState {
  return isPersistentChatSessionWarm(conversationId) ? "hot" : "cold";
}

export function restartPersistentChatSession(conversationId: string): boolean {
  const process = globalState().processes.get(conversationId);
  if (!process) return false;
  process.terminate("restarted by user");
  return true;
}

/** Test-only cleanup. Production callers should restart one conversation. */
export function resetPersistentChatRunnerForTests(): void {
  for (const process of [...globalState().processes.values()]) {
    process.terminate("test cleanup");
  }
  globalState().processes.clear();
}
