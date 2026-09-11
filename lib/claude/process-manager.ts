import { parseRefinementActions } from "@/lib/refinement/options";
import type { ClaudeOptions, ClaudeResult } from "./spawn";
import { getProvider, type ProviderType, type ProviderSession } from "@/lib/providers";
import {
  type AgentSessionLifecycleStatus,
  capSessionPrompt,
  isValidSessionTransition,
  isTerminalSessionStatus,
} from "@/lib/agent-sessions/lifecycle";
import { appendSessionChunk } from "@/lib/agent-sessions/chunks";
import {
  startArijToolCallIndex,
  type ArijToolCallIndexer,
} from "@/lib/agent-sessions/arij-action-scan";
import { notifySessionTerminal } from "@/lib/agent-sessions/terminal-hooks";
import {
  isMcpToolsEnabled,
  providerSupportsMcp,
  arijMcpToolPrefix,
  buildMcpSpawnConfig,
  cleanupMcpConfigFile,
  MCP_CHANNEL_INJECTED,
  MCP_CHANNEL_UNAVAILABLE,
} from "./mcp-injection";
import { arijToolsSection, extraMcpServersSection } from "./prompt-sections";
import {
  resolveExtraMcpServers,
  type ResolvedExtraMcpServers,
} from "@/lib/mcp/servers";
import { isMcpExemptAgentType } from "@/lib/workflow/dreaming-constants";
import {
  mintMcpToken,
  revokeMcpTokensForSession,
} from "@/lib/mcp/token-store";
import { getNamedAgentRuntimeConfig } from "@/lib/agent-config/named-agents";
import { acceptsPersonaPrompt } from "@/lib/agent-config/constants";
import { filterProviderOptionsForAgentType } from "@/lib/providers/options-registry";
import { personaSection } from "./prompt-sections";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus = AgentSessionLifecycleStatus;

export interface TrackedSession {
  sessionId: string;
  status: SessionStatus;
  provider: ProviderType;
  options: ClaudeOptions;
  startedAt: Date;
  completedAt?: Date;
  result?: ClaudeResult;
  cliSessionId?: string;
  kill: () => void;
  /** Provider session handle (PID-based for CC, thread-based for Codex). */
  providerSession?: ProviderSession;
  /** Temp `--mcp-config` file for claude-code spawns, cleared on teardown. */
  mcpConfigPath?: string;
  /** Settle promise for the underlying child process / provider spawn. */
  closePromise?: Promise<void>;
  /** Whether the underlying process has emitted close / exited. */
  processClosed?: boolean;
  projectId?: string;
  epicId?: string | null;
  userStoryId?: string | null;
  cwd?: string;
}

export interface SessionInfo {
  sessionId: string;
  status: SessionStatus;
  provider: ProviderType;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  result?: ClaudeResult;
  cliSessionId?: string;
  processClosed?: boolean;
}

/**
 * How long a terminal session stays in the map after its process closed.
 *
 * The map used to keep every session for the life of the server — each entry
 * holding the full prompt as handed to the CLI (persona and tools section
 * included, uncapped) and the full result text — with `remove()` called by
 * nothing but tests. A `next start` that chains Full Auto or night-run
 * sessions therefore grew without bound. The grace period covers everything
 * that reads a finished session back: `waitForProcessCompletion` polls
 * `getStatus` right after the close, the dispatch routes read `result` from
 * it, and the worktree guards read `processClosed`.
 */
export const TERMINAL_SESSION_RETENTION_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Singleton process manager
// ---------------------------------------------------------------------------

class ClaudeProcessManager {
  private sessions: Map<string, TrackedSession> = new Map();

  private persistCliSessionId(sessionId: string, cliSessionId?: string): void {
    if (!cliSessionId) {
      return;
    }

    try {
      db.update(agentSessions)
        .set({ cliSessionId })
        .where(eq(agentSessions.id, sessionId))
        .run();
    } catch (error) {
      console.error(
        `[process-manager] Failed to persist cliSessionId for session ${sessionId}`,
        error
      );
    }
  }

  /**
   * Spawns a new provider session and tracks it under the given session ID.
   * If a session with the same ID is already running, it throws an error.
   *
   * Every provider — claude-code included — is spawned through
   * `getProvider(provider).spawn(...)`; the claude-specific argv and MCP
   * config file live behind ClaudeCodeProvider, not in a branch here.
   *
   * Returns the session info immediately. The process runs in the background
   * and updates the session state on completion.
   */
  start(
    sessionId: string,
    options: ClaudeOptions,
    provider: ProviderType = "claude-code",
  ): SessionInfo {
    const existing = this.sessions.get(sessionId);
    if (existing && existing.status === "running") {
      throw new Error(
        `Session ${sessionId} is already running. Cancel it before starting a new one.`,
      );
    }

    // Work on a COPY. Both blocks below rewrite `prompt`, and a retry ladder
    // that re-dispatches the same options object would otherwise stack a
    // second persona and a second tools section onto an already-injected
    // prompt.
    options = { ...options };

    // One read of the session row for both blocks below. `agentType` is what
    // scopes the persona and the agent-type-restricted options; the project
    // and ticket ids are what the MCP token binds to. Best-effort: a session
    // must never fail to spawn because its own row could not be read.
    let sessionRow:
      | {
          projectId: string;
          epicId: string | null;
          userStoryId: string | null;
          agentType: string | null;
          namedAgentId: string | null;
          refinementActions: string | null;
        }
      | undefined;
    try {
      sessionRow = db
        .select({
          projectId: agentSessions.projectId,
          epicId: agentSessions.epicId,
          userStoryId: agentSessions.userStoryId,
          agentType: agentSessions.agentType,
          namedAgentId: agentSessions.namedAgentId,
          refinementActions: agentSessions.refinementActions,
        })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .get();
    } catch (error) {
      console.warn(
        `[process-manager] Session row unreadable for ${sessionId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    // Named-agent configuration — the second thing this wiring point owns,
    // alongside the MCP channel below. Every dispatch path (manual routes,
    // pipeline stages, night runs, Full Auto, grading, merge resolution)
    // reaches the CLI through here, so resolving the agent's per-CLI options
    // and persona once, HERE, is what keeps automated modes from needing a
    // parallel plumbing of their own.
    //
    // The persona is PREPENDED (the tools section is appended), which puts it
    // ahead of the role prompt, the specification and the ticket — see
    // docs/architecture/named-agent-cli-options.md for the full order.
    //
    // BOTH halves are scoped by the session's agent TYPE, not by its spawn
    // mode. Reviews, grading and the second-opinion gate all spawn in mode
    // "code" on purpose (plan mode refuses the mutating MCP tools they exist
    // to call), so a mode-based gate would not tell them apart from a build.
    try {
      const agentRow = sessionRow;

      const { options: resolvedOptions, personaPrompt } =
        getNamedAgentRuntimeConfig(agentRow?.namedAgentId, provider);

      // Options the agent type may not carry (claude's permission mode) are
      // dropped here, where the type is known; the registry declares which.
      const cliOptions = filterProviderOptionsForAgentType(
        provider,
        resolvedOptions,
        agentRow?.agentType,
      );

      // Strict document-rewrite and fixed-contract sessions get NO persona.
      // spec_generation replaces projects.spec with its response verbatim,
      // the memory writers replace the memory document, release_notes becomes
      // CHANGELOG.md — free-form persona text ("answer in French, summarise
      // your reasoning") would be written into the stored artifact and then
      // feed every later prompt. See PERSONA_AGENT_TYPES.
      const persona = acceptsPersonaPrompt(agentRow?.agentType)
        ? personaSection(personaPrompt)
        : "";
      const patch: { cliOptions?: string; prompt?: string } = {};

      if (Object.keys(cliOptions).length > 0) {
        options.cliOptions = cliOptions;
        // Audit trail: the agent can be edited or deleted after this run, so
        // the options that were actually in effect belong on the session row.
        // NULL stays NULL when nothing was configured — legacy rows and
        // unconfigured agents read the same.
        patch.cliOptions = JSON.stringify(cliOptions);
      }

      if (persona) {
        options.prompt = persona + options.prompt;
        // The queued row stored the prompt as the dispatch route built it,
        // before this injection. Re-persist it so the session detail shows
        // the persona the agent actually received — it is configuration, not
        // a secret, and a prompt display that omits it is misleading.
        //
        // Capped on the way into the row, never on the way into the spawn:
        // `options.prompt` above is what the CLI is handed, whole.
        patch.prompt = capSessionPrompt(options.prompt);
      }

      if (patch.cliOptions !== undefined || patch.prompt !== undefined) {
        db.update(agentSessions)
          .set(patch)
          .where(eq(agentSessions.id, sessionId))
          .run();
      }
    } catch (error) {
      // Same posture as MCP injection: a session must never fail to spawn
      // because its optional configuration could not be read.
      console.warn(
        `[process-manager] Named-agent options skipped for session ${sessionId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    // Arij MCP tool channel — mint a per-session bearer token, attach the
    // MCP server config for the provider to inject, and append the tools
    // prompt section. This is the single wiring point for AGENT sessions:
    // every dispatch route threads through here. Routes that spawn a
    // provider directly (generate-spec, import, QA epic extraction) never get
    // injection; CLI chat turns get their own chat-toolset channel from
    // lib/chat/cli-tool-channel.ts.
    // Strictly best-effort: a session must never fail to spawn because
    // injection did. Gates: settings toggle (absent row = enabled),
    // provider support (claude-code/codex/oh-my-pi), an agent_sessions row —
    // the row is the authority for the project scope the token binds to —
    // and the agent type not being one of the strict document rewriters.
    // The tool spelling and prompt prefix follow the provider (omp says
    // mcp__arij_*, one underscore short — see arijMcpToolPrefix).
    // Whether this spawn was supposed to get the tool channel at all — the
    // question `agent_sessions.mcp_channel` answers for the review gate.
    //
    // It starts TRUE for every MCP-capable provider and is cleared only when
    // we positively learn the channel does not apply (toggle off, no session
    // row, MCP-exempt agent type). That default is what makes a THROWN
    // injection recordable: the failure paths below leave the flag set, so
    // the row says `unavailable` and the gate judges such a review by prose
    // instead of blaming it for a tool call it could not make. Clearing it
    // first and setting it late would leave exactly the silent gap this
    // column exists to close.
    let mcpChannelIntended = providerSupportsMcp(provider);
    try {
      if (mcpChannelIntended && !isMcpToolsEnabled()) {
        // Not a failure: the operator turned the channel off, and the
        // judgement-time fallback reads the same toggle.
        mcpChannelIntended = false;
      }
      if (mcpChannelIntended) {
        // Already read once at the top of this wiring point, for the
        // named-agent configuration above — the token binds to the same row.
        const row = sessionRow;

        // Strict document-rewrite agents opt out entirely (no token, no
        // config, no section): the section is APPENDED, so for them it would
        // land after the "respond with the document body and nothing else"
        // contract and end the prompt with ticket-tool guidance for a session
        // that owns no ticket. See MCP_EXEMPT_AGENT_TYPES.
        if (!row || isMcpExemptAgentType(row.agentType)) {
          mcpChannelIntended = false;
        } else {
          const token = mintMcpToken({
            sessionId,
            projectId: row.projectId,
            epicId: row.epicId,
            userStoryId: row.userStoryId,
            agentType: row.agentType,
          });
          // User-declared servers ride alongside the arij channel. Resolution
          // (scope, enabled, agent_types, provider capability) lives in
          // lib/mcp/servers.ts; a failure here is caught by the same
          // best-effort try/catch as the rest of injection, so a broken extra
          // can cost the session its tools but never its spawn.
          let extras: ResolvedExtraMcpServers = {
            servers: [],
            excludedProjectScoped: [],
          };
          try {
            extras = resolveExtraMcpServers({
              projectId: row.projectId,
              provider,
              agentType: row.agentType ?? null,
            });
          } catch (error) {
            // Its OWN catch, inside the outer one: a user's third-party server
            // list must never cost the session the arij CONTROL channel. The
            // outer handler drops `options.mcp` entirely, which would leave the
            // agent with no board tools and mark the review unverifiable — far
            // too much to pay for a malformed extra. Degrade to arij-only.
            console.warn(
              `[process-manager] extra MCP servers skipped for session ${sessionId}:`,
              error instanceof Error ? error.message : error,
            );
          }
          if (extras.excludedProjectScoped.length > 0) {
            // Not silent: `${provider}` reads a user-global MCP registry that
            // Arij cannot vary per spawn, so these project-scoped servers
            // cannot reach it. The UI states the same limitation per server.
            console.info(
              `[process-manager] session ${sessionId}: provider "${provider}" ` +
                "cannot honor project-scoped MCP servers " +
                `(${extras.excludedProjectScoped.join(", ")}) — ` +
                "only global servers are injected for it",
            );
          }
          const refinementActions = row.agentType === "refinement"
            ? parseRefinementActions(row.refinementActions ?? null)
            : undefined;
          options.mcp = buildMcpSpawnConfig({
            token,
            agentType: row.agentType,
            provider,
            extraServers: extras.servers,
            refinementActions,
          });
          options.prompt +=
            "\n" +
            arijToolsSection(
              row.agentType ?? null, arijMcpToolPrefix(provider), refinementActions,
            ) +
            extraMcpServersSection(extras.servers, provider);
          // Re-persist the prompt WITH the appended section — same display
          // argument as the persona re-persist above, plus a hard requirement
          // of its own: resolveSessionOutput's echo scrub recognises an echo
          // from agent_sessions.prompt, and a CLI that echoes its prompt
          // echoes the SPAWNED prompt, tools section included. A stored
          // prompt that stops short left the section behind in ticket
          // comments (measured on E-arij-138, 2026-08-27). The write-path cap
          // does not reopen that: the section is at the very END of the
          // prompt, so it lands in the tail the cap keeps, and the scrub
          // matches a capped prompt head-to-tail. Own try/catch: a failed
          // write must not be mistaken for a failed injection by the outer
          // catch, which would drop the channel that was just built.
          try {
            db.update(agentSessions)
              .set({ prompt: capSessionPrompt(options.prompt) })
              .where(eq(agentSessions.id, sessionId))
              .run();
          } catch (error) {
            console.warn(
              `[process-manager] Failed to persist the tools section for session ${sessionId}:`,
              error instanceof Error ? error.message : error,
            );
          }
        }
      }
    } catch (error) {
      // Injection is best-effort: a session must never fail to spawn because
      // the channel could not be built. But it must not pass for a session
      // that CHOSE not to use its tools either — the review gate reads
      // mcp_channel precisely so a reviewer with no channel is judged by
      // prose instead of being blamed for a tool call it could not make.
      options.mcp = undefined;
      console.warn(
        `[process-manager] MCP injection skipped for session ${sessionId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    // Index this run's Arij tool calls as its raw chunks are written, so the
    // session's Arij-actions list never has to re-walk the raw stream (#236).
    // Needs the session row (the index rows reference it). A run that cannot
    // produce a complete index still gets an indexer: it only marks the run
    // live, which keeps the read-side scan from persisting a session whose
    // raw output is still growing. Per-spawn rather than per-session-id: a
    // re-dispatch gets its own, and the previous run's is dropped with its
    // closure — after `finish()`, which the paths below always reach.
    let toolCallIndex: ArijToolCallIndexer | null = sessionRow
      ? startArijToolCallIndex(sessionId)
      : null;

    let providerSession: ProviderSession;
    try {
      providerSession = getProvider(provider).spawn({
        sessionId,
        prompt: options.prompt,
        cwd: options.cwd || process.cwd(),
        mode: options.mode,
        allowedTools: options.allowedTools,
        model: options.model,
        cliSessionId: options.cliSessionId,
        resumeSession: options.resumeSession,
        logIdentifier: options.logIdentifier,
        mcp: options.mcp,
        cliOptions: options.cliOptions,
        killGraceMs: options.killGraceMs,
        // Every provider streams here. claude-code runs in stream-json mode
        // whenever onChunk is passed (#172) and emits each NDJSON event line
        // as a raw chunk, then its final text as output/response — so its
        // tool_use records feed the Arij tool-call index below exactly like
        // codex's and omp's do.
        onChunk: (chunk) => {
          try {
            appendSessionChunk({
              sessionId,
              streamType: chunk.streamType,
              content: chunk.text,
              chunkKey: chunk.chunkKey ?? null,
              createdAt: chunk.emittedAt,
            });
          } catch (error) {
            console.error(
              `[process-manager] Failed to persist ${provider} chunk for session ${sessionId}`,
              error
            );
          }
          // Only the running log carries tool calls; output/response are the
          // final text. Fed even when the append above failed or was trimmed
          // by the raw cap — the index is what outlives the raw stream.
          // Never throws: indexing failures give the session back to the scan.
          if (chunk.streamType === "raw") {
            toolCallIndex?.push(chunk.text, chunk.emittedAt ?? null);
          }
        },
      });
    } catch (error) {
      // No process, so no `.finally` below to release the run.
      toolCallIndex?.finish();
      throw error;
    }
    const kill = providerSession.kill;
    const promise: Promise<ClaudeResult> = providerSession.promise;
    const mcpConfigPath = providerSession.mcpConfigPath;

    // Persist CLI command
    if (providerSession.command) {
      try {
        db.update(agentSessions)
          .set({ cliCommand: providerSession.command })
          .where(eq(agentSessions.id, sessionId))
          .run();
      } catch { /* best-effort */ }
    }

    // Record what the child actually got. `options.mcp` is cleared when the
    // injection block failed; `mcpConfigPath` is absent when the claude
    // spawn could not write its config file and dropped --mcp-config. Either
    // way the session ran WITHOUT the tools, and only the row says so — the
    // child never reaches the HTTP route, so no 401 is traced.
    if (mcpChannelIntended) {
      const wired =
        !!options.mcp && (provider !== "claude-code" || !!mcpConfigPath);
      try {
        db.update(agentSessions)
          .set({
            mcpChannel: wired ? MCP_CHANNEL_INJECTED : MCP_CHANNEL_UNAVAILABLE,
          })
          .where(eq(agentSessions.id, sessionId))
          .run();
      } catch (error) {
        console.warn(
          `[process-manager] Failed to record the MCP channel state for session ${sessionId}:`,
          error instanceof Error ? error.message : error,
        );
      }
      if (!wired) {
        console.warn(
          `[process-manager] Session ${sessionId} spawned WITHOUT the Arij tool channel; its review cannot file structured findings.`,
        );
      }
    }

    let markProcessClosed!: () => void;
    const closePromise = new Promise<void>((resolve) => {
      markProcessClosed = resolve;
    });

    const session: TrackedSession = {
      sessionId,
      status: "running",
      provider,
      options,
      cliSessionId: options.cliSessionId,
      startedAt: new Date(),
      kill,
      providerSession,
      mcpConfigPath,
      closePromise,
      processClosed: false,
      projectId: sessionRow?.projectId,
      epicId: sessionRow?.epicId,
      userStoryId: sessionRow?.userStoryId,
      cwd: options.cwd,
    };

    this.sessions.set(sessionId, session);

    // Handle completion in the background
    promise
      .then((result) => {
        // Tear the tool channel down the moment the process exits.
        // Revocation keeps the token-store record (the askedQuestion flag
        // must survive until the dispatch route classifies the outcome);
        // the grace-period purge is the destructor.
        this.teardownMcpChannel(sessionId, mcpConfigPath);

        const tracked = this.sessions.get(sessionId);
        if (!tracked) return;

        const targetStatus: SessionStatus = result.success ? "completed" : "failed";
        const resolvedCliSessionId =
          result.cliSessionId ??
          tracked.cliSessionId ??
          tracked.options.cliSessionId;

        if (resolvedCliSessionId) {
          tracked.cliSessionId = resolvedCliSessionId;
          this.persistCliSessionId(sessionId, resolvedCliSessionId);
        }

        // The final text reaches the chunk store through the provider's own
        // output/response chunks (`final-output` / `final-response`), for
        // claude-code like for the rest; writing it a second time here under
        // `result-<id>` used to store every result twice.

        // Only transition if the move is valid (e.g. not already cancelled)
        if (isValidSessionTransition(tracked.status, targetStatus)) {
          tracked.status = targetStatus;
          tracked.completedAt = new Date();
          tracked.result = result;
        }
      })
      .catch((err: Error) => {
        this.teardownMcpChannel(sessionId, mcpConfigPath);

        const tracked = this.sessions.get(sessionId);
        if (!tracked) return;

        if (isValidSessionTransition(tracked.status, "failed")) {
          tracked.status = "failed";
          tracked.completedAt = new Date();
          tracked.result = {
            success: false,
            error: err.message,
            duration: Date.now() - tracked.startedAt.getTime(),
          };
        }
      })
      .finally(() => {
        // The process is gone: commit a last unterminated line, then let the
        // scanner (and its line carry) go.
        toolCallIndex?.finish();
        toolCallIndex = null;

        const tracked = this.sessions.get(sessionId);
        if (tracked) {
          tracked.processClosed = true;
          // The prompt was handed to the CLI whole and is persisted (capped)
          // on the session row; nothing reads it back from here once the
          // process is gone. Drop it now rather than at eviction.
          tracked.options = { ...tracked.options, prompt: "" };
          this.scheduleEviction(sessionId);
        }
        markProcessClosed();
        if (tracked?.status === "cancelled") {
          try {
            notifySessionTerminal({
              sessionId,
              status: "cancelled",
            });
          } catch {
            // best-effort
          }
        }
      });

    return this.toSessionInfo(session);
  }

  /**
   * Forgets a closed session after TERMINAL_SESSION_RETENTION_MS. Re-checked
   * at eviction time: a session re-dispatched under the same id in the
   * meantime is a new, running entry and must not be evicted by the previous
   * run's timer.
   */
  private scheduleEviction(sessionId: string): void {
    const timer = setTimeout(() => {
      const tracked = this.sessions.get(sessionId);
      if (
        tracked &&
        tracked.processClosed === true &&
        isTerminalSessionStatus(tracked.status)
      ) {
        this.sessions.delete(sessionId);
      }
    }, TERMINAL_SESSION_RETENTION_MS);
    timer.unref?.();
  }

  /**
   * Cancels a running session by killing the underlying process.
   * Works uniformly for both Claude Code (SIGTERM→SIGKILL) and Codex (AbortController).
   * Returns true if the session was running and has been cancelled,
   * false if the session was not found or not in a cancellable state.
   */
  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (!isValidSessionTransition(session.status, "cancelled")) {
      return false;
    }

    session.kill();
    session.status = "cancelled";
    session.completedAt = new Date();
    session.result = {
      success: false,
      error: "Process was cancelled by user.",
      duration: Date.now() - session.startedAt.getTime(),
    };

    // Cancellation is terminal for the tool channel too — don't wait for
    // the killed process's close event to invalidate the token.
    this.teardownMcpChannel(sessionId, session.mcpConfigPath);

    return true;
  }

  /**
   * Returns the current status and result for a given session.
   * Returns null if the session is not tracked.
   */
  getStatus(sessionId: string): SessionInfo | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return this.toSessionInfo(session);
  }

  /**
   * Returns the settlement promise for the session's underlying child process.
   * Resolves when the process emits close/error, regardless of whether the session
   * ended normally or was cancelled.
   */
  getClosePromise(sessionId: string): Promise<void> | null {
    return this.sessions.get(sessionId)?.closePromise ?? null;
  }

  /**
   * Whether the underlying process has exited. Unknown sessions are considered closed.
   */
  isProcessClosed(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !session || session.processClosed === true;
  }

  /**
   * Waits until the session's underlying child process has actually closed,
   * bounded by an optional grace period (defaults to 8000ms).
   */
  async waitForClose(
    sessionId: string,
    graceMs: number = 8000
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.processClosed || !session.closePromise) return;

    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, graceMs);
      timer.unref?.();
    });

    try {
      await Promise.race([session.closePromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private lookupSessionField(
    sessionId: string,
    field: "projectId" | "epicId" | "userStoryId"
  ): string | null {
    try {
      const row = db
        .select({
          projectId: agentSessions.projectId,
          epicId: agentSessions.epicId,
          userStoryId: agentSessions.userStoryId,
        })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .get();
      return row ? (row[field] ?? null) : null;
    } catch {
      return null;
    }
  }

  /**
   * Returns any tracked session currently occupying the target, meaning its underlying
   * child process or process group has not completed teardown (`processClosed !== true`).
   * Covers cancelled sessions that are still in their termination grace period.
   */
  getOccupyingSessionForTarget(target: {
    scope: "epic" | "story";
    projectId: string;
    epicId?: string | null;
    storyId?: string;
  }): TrackedSession | null {
    for (const session of this.sessions.values()) {
      if (session.processClosed) continue;
      const projId =
        session.projectId ??
        this.lookupSessionField(session.sessionId, "projectId");
      if (projId && projId !== target.projectId) continue;

      const epicId =
        session.epicId ??
        this.lookupSessionField(session.sessionId, "epicId");
      const storyId =
        session.userStoryId ??
        this.lookupSessionField(session.sessionId, "userStoryId");

      if (target.scope === "epic") {
        if (epicId === target.epicId) {
          return session;
        }
      } else {
        if (storyId === target.storyId) {
          return session;
        }
        if (target.epicId && epicId === target.epicId) {
          return session;
        }
      }
    }
    return null;
  }

  /**
   * Returns all tracked sessions in a project that are still occupying their target/worktree.
   */
  listOccupyingSessions(projectId?: string): TrackedSession[] {
    const results: TrackedSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.processClosed) continue;
      const projId =
        session.projectId ??
        this.lookupSessionField(session.sessionId, "projectId");
      if (projectId && projId && projId !== projectId) continue;
      results.push(session);
    }
    return results;
  }

  /**
   * Whether the target currently has a session whose process has not closed yet.
   */
  isTargetOccupied(target: {
    scope: "epic" | "story";
    projectId: string;
    epicId?: string | null;
    storyId?: string;
  }): boolean {
    return this.getOccupyingSessionForTarget(target) !== null;
  }

  /**
   * Returns info for all sessions that are currently running.
   */
  listActive(): SessionInfo[] {
    const active: SessionInfo[] = [];

    const sessions = Array.from(this.sessions.values());
    for (const session of sessions) {
      if (session.status === "running") {
        active.push(this.toSessionInfo(session));
      }
    }

    return active;
  }

  /**
   * Returns info for all tracked sessions regardless of status.
   */
  listAll(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) =>
      this.toSessionInfo(s),
    );
  }

  /**
   * Removes a completed/failed/cancelled session from tracking.
   * Running sessions cannot be removed -- cancel them first.
   * Returns true if the session was removed.
   */
  remove(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Only terminal sessions can be removed
    if (!isTerminalSessionStatus(session.status)) {
      return false;
    }

    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Returns the number of currently running sessions.
   */
  get activeCount(): number {
    let count = 0;
    const sessions = Array.from(this.sessions.values());
    for (const session of sessions) {
      if (session.status === "running") count++;
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Best-effort teardown of the session's MCP tool channel: revoke its bearer
   * tokens and delete the temp `--mcp-config` file that holds a copy of one.
   * A completion handler must never fail (and mark the session failed)
   * because the token store or the filesystem did. No-op for sessions that
   * never got injection.
   *
   * The config path is passed in (not read off the tracked session) so a late
   * handler from a previous run can never delete a restarted session's file.
   * Deleting is idempotent — spawnClaude already clears the file on exit;
   * this is the backstop for paths where its close event never lands.
   */
  private teardownMcpChannel(
    sessionId: string,
    mcpConfigPath?: string,
  ): void {
    try {
      revokeMcpTokensForSession(sessionId);
    } catch (error) {
      console.warn(
        `[process-manager] Failed to revoke MCP tokens for session ${sessionId}`,
        error,
      );
    }
    try {
      cleanupMcpConfigFile(mcpConfigPath);
    } catch (error) {
      console.warn(
        `[process-manager] Failed to remove MCP config file for session ${sessionId}`,
        error,
      );
    }
  }

  private toSessionInfo(session: TrackedSession): SessionInfo {
    const info: SessionInfo = {
      sessionId: session.sessionId,
      status: session.status,
      provider: session.provider,
      startedAt: session.startedAt,
    };

    if (session.completedAt) {
      info.completedAt = session.completedAt;
    }

    // Compute duration: completed sessions use stored result, running sessions
    // compute elapsed time from startedAt
    if (session.result?.duration !== undefined) {
      info.duration = session.result.duration;
    } else if (session.status === "running") {
      info.duration = Date.now() - session.startedAt.getTime();
    }

    if (session.result) {
      info.result = session.result;
    }

    if (session.cliSessionId) {
      info.cliSessionId = session.cliSessionId;
    }

    if (session.processClosed !== undefined) {
      info.processClosed = session.processClosed;
    }

    return info;
  }
}

/**
 * Singleton instance of the process manager.
 * In Next.js server-side code, module-level singletons persist across
 * requests within the same server process.
 */
export const processManager = new ClaudeProcessManager();
