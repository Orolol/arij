import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  check,
  AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type {
  FrictionCategory,
  FrictionStatus,
} from "@/lib/frictions/constants";
import type { RoutineKind } from "@/lib/routines/constants";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").default("ideation"), // ideation | specifying | building | done | archived
  gitRepoPath: text("git_repo_path"),
  githubOwnerRepo: text("github_owner_repo"),
  // "github" when Arij cloned the directory itself and therefore owns it;
  // NULL for user-supplied paths, which Arij must never delete.
  cloneSource: text("clone_source"),
  gitRemoteUrl: text("git_remote_url"),
  defaultBranch: text("default_branch"),
  spec: text("spec"),
  imported: integer("imported").default(0),
  ticketCounter: integer("ticket_counter").default(0), // shared sequence across epics+bugs
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export type { RoutineKind } from "@/lib/routines/constants";

/**
 * Durable routine definitions. Daily scheduling is interpreted in the
 * server's local timezone; `lastRunAt` is written before dispatch so a
 * process restart cannot replay a routine already claimed that day.
 */
export const routines = sqliteTable(
  "routines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<RoutineKind>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    timeOfDay: text("time_of_day").notNull(),
    config: text("config").notNull().default("{}"),
    lastRunAt: text("last_run_at"),
    lastStatus: text("last_status"),
  },
  (table) => ({
    projectKindUnique: uniqueIndex("routines_project_kind_unique").on(
      table.projectId,
      table.kind
    ),
    projectIdx: index("routines_project_idx").on(table.projectId),
    enabledIdx: index("routines_enabled_idx").on(table.enabled),
  })
);

export type Routine = typeof routines.$inferSelect;
export type NewRoutine = typeof routines.$inferInsert;

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  originalFilename: text("original_filename").notNull(),
  kind: text("kind").notNull().default("text"), // text | image
  markdownContent: text("markdown_content"),
  imagePath: text("image_path"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
},
(table) => ({
  // Case-insensitive uniqueness is enforced in SQL migration via lower(original_filename).
  projectFilenameUnique: uniqueIndex("documents_project_filename_unique").on(
    table.projectId,
    table.originalFilename
  ),
  projectCreatedAtIdx: index("documents_project_created_at_idx").on(
    table.projectId,
    table.createdAt
  ),
}));

export const epics = sqliteTable("epics", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  priority: integer("priority").default(0), // 0=low, 1=medium, 2=high, 3=critical
  status: text("status").default("backlog"), // backlog | todo | in_progress | review | done | released
  position: integer("position").default(0),
  branchName: text("branch_name"),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  prStatus: text("pr_status"), // draft | open | closed | merged
  confidence: real("confidence"),
  evidence: text("evidence"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  type: text("type").default("feature"), // 'feature' | 'bug'
  linkedEpicId: text("linked_epic_id").references((): AnySQLiteColumn => epics.id, { onDelete: "set null" }),
  images: text("images"), // JSON array of image paths
  readableId: text("readable_id"), // E-project-001 or B-project-002
  githubIssueNumber: integer("github_issue_number"),
  releaseId: text("release_id").references(() => releases.id, { onDelete: "set null" }),
},
(table) => ({
  // The board reads epics project-scoped, buckets them by status and orders
  // them by position. Without this index that query SCANs the whole table on
  // the one synchronous connection every other request shares.
  projectStatusPositionIdx: index("epics_project_status_position_idx").on(
    table.projectId,
    table.status,
    table.position
  ),
}));

export const userStories = sqliteTable("user_stories", {
  id: text("id").primaryKey(),
  epicId: text("epic_id")
    .notNull()
    .references(() => epics.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  acceptanceCriteria: text("acceptance_criteria"),
  status: text("status").default("todo"), // todo | in_progress | review | done
  position: integer("position").default(0),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
},
(table) => ({
  // Stories are only ever read epic-scoped, in position order.
  epicPositionIdx: index("user_stories_epic_position_idx").on(
    table.epicId,
    table.position
  ),
}));

export const chatConversations = sqliteTable("chat_conversations", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("brainstorm"), // brainstorm | epic
  label: text("label").notNull().default("Brainstorm"),
  status: text("status").default("active"), // active | generating | generated | error
  epicId: text("epic_id").references(() => epics.id),
  provider: text("provider").default("claude-code"), // see PROVIDER_OPTIONS in lib/agent-config/constants.ts
  cliSessionId: text("cli_session_id"),
  namedAgentId: text("named_agent_id"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => chatConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

/** Durable deduplication of an epic proposal across tabs and request retries. */
export const chatEpicProposals = sqliteTable("chat_epic_proposals", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  proposalHash: text("proposal_hash").notNull(),
  // Keep a tombstone after deletion: a delayed retry must not recreate it.
  epicId: text("epic_id").references(() => epics.id, { onDelete: "set null" }),
  userStoriesCreated: integer("user_stories_created").notNull(),
  dependenciesCreated: integer("dependencies_created").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.conversationId, table.proposalHash] }),
  conversationIdx: index("chat_epic_proposals_conversation_idx").on(table.conversationId),
  epicIdx: index("chat_epic_proposals_epic_idx").on(table.epicId),
}));

/**
 * An uploaded file and, in the three owner columns, what keeps it alive.
 *
 * `chatMessageId` is set when the staged upload is sent as part of a chat
 * message; `epicId` when it is filed as a bug's screenshot. Both NULL means
 * the upload is still staged in a form nobody has submitted — the only state
 * in which discarding it is allowed. `projectId` is set at upload time and
 * outlives either claim, so deleting a project takes its files with it.
 */
export const chatAttachments = sqliteTable("chat_attachments", {
  id: text("id").primaryKey(),
  chatMessageId: text("chat_message_id").references(() => chatMessages.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  epicId: text("epic_id").references(() => epics.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  epicId: text("epic_id").references(() => epics.id),
  userStoryId: text("user_story_id").references(() => userStories.id),
  status: text("status").default("queued"), // queued | running | completed | failed | cancelled
  mode: text("mode").default("code"), // plan | code | analyze | chat
  orchestrationMode: text("orchestration_mode").default("solo"), // solo | team
  provider: text("provider").default("claude-code"), // see PROVIDER_OPTIONS in lib/agent-config/constants.ts
  prompt: text("prompt"),
  logsPath: text("logs_path"),
  branchName: text("branch_name"),
  worktreePath: text("worktree_path"),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  completedAt: text("completed_at"),
  lastNonEmptyText: text("last_non_empty_text"),
  error: text("error"),
  // Delivery verdict, set once at session end:
  // answered | asked_question | silent | error. NULL while running/queued,
  // for user-cancelled sessions, and for legacy rows.
  outcome: text("outcome"),
  // Structured review verdict submitted through the MCP `submit_findings`
  // tool: approved | approved_with_minor_issues | changes_requested. The
  // authoritative transition signal for a review stage — see
  // lib/pipeline/findings.ts. NULL for non-review sessions, for reviewers
  // that never called the tool (providers without MCP), and for legacy rows;
  // NULL is what selects the prose-verdict fallback.
  reviewVerdict: text("review_verdict"),
  // What Arij actually wired for this session's MCP tool channel (0041):
  // 'injected' | 'unavailable'. NULL for legacy rows and for spawns injection
  // never applies to. The unverifiable-review rule reads this BEFORE the
  // provider list, because injection can degrade silently — see
  // MCP_CHANNEL_INJECTED in lib/claude/mcp-injection.ts.
  mcpChannel: text("mcp_channel"),
  // Usage reported by the CLI at session end. NULL for legacy rows,
  // non-terminal sessions, and providers that do not report usage.
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalCostUsd: real("total_cost_usd"),
  // Estimated prompt tokens and section breakdown calculated at dispatch time.
  // NULL for legacy rows and sessions where estimation was not run.
  estimatedPromptTokens: integer("estimated_prompt_tokens"),
  estimatedPromptBreakdown: text("estimated_prompt_breakdown"),
  // Batch/night run that dispatched this session (see lib/night); NULL for
  // standalone dispatches.
  batchRunId: text("batch_run_id"),
  cliSessionId: text("cli_session_id"),
  namedAgentId: text("named_agent_id"),
  // The COMPOSITE that dispatched this session, when one did; NULL for a
  // simple-agent dispatch. `namedAgentId` above keeps naming the member that
  // actually ran, because getNamedAgentDispatchReliability() groups by it —
  // recording the composite there would measure a list instead of an agent.
  compositeAgentId: text("composite_agent_id"),
  agentType: text("agent_type"),
  namedAgentName: text("named_agent_name"),
  model: text("model"),
  // Per-CLI options in effect for this run, resolved from the named agent at
  // spawn time. JSON object; NULL for legacy rows and for sessions dispatched
  // without a named agent.
  cliOptions: text("cli_options"),
  // Selected board-refinement actions, JSON array. NULL preserves legacy full passes.
  refinementActions: text("refinement_actions"),
  cliCommand: text("cli_command"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
},
(table) => ({
  // The sessions list is project-scoped and keyset-paged on creation time.
  // The leading key prunes the scan; the route's `coalesce(created_at, '')`
  // sort still needs a temp b-tree, since SQLite cannot match an expression
  // to a plain column index.
  projectCreatedAtIdx: index("agent_sessions_project_created_at_idx").on(
    table.projectId,
    table.createdAt
  ),
  // Ticket detail, pipeline ownership checks and the Full Auto sweep all ask
  // which sessions belong to one epic.
  epicIdx: index("agent_sessions_epic_idx").on(table.epicId),
  // The registry's cost sort (app/api/tickets/route.ts) sums total_cost_usd
  // per done/released epic BEFORE its LIMIT, so the aggregate runs once per
  // terminal candidate on every request. The trailing column is what makes it
  // index-only: without it the planner reads each matching session's table
  // row — and these rows are wide (`prompt` averages ~78 KB) — to fetch one
  // REAL. `epicIdx` is a strict prefix of this index and is kept anyway;
  // dropping it measured no write saving. See 0056.
  epicCostIdx: index("agent_sessions_epic_cost_idx").on(
    table.epicId,
    table.totalCostUsd
  ),
}));

export const agentSessionSequences = sqliteTable("agent_session_sequences", {
  sessionId: text("session_id")
    .primaryKey()
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  nextSequence: integer("next_sequence").notNull().default(1),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const agentSessionChunks = sqliteTable(
  "agent_session_chunks",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    streamType: text("stream_type").notNull(), // raw | output | response
    sequence: integer("sequence").notNull(),
    chunkKey: text("chunk_key"),
    content: text("content").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    sessionSequenceUnique: uniqueIndex(
      "agent_session_chunks_session_sequence_unique"
    ).on(table.sessionId, table.sequence),
    sessionStreamKeyUnique: uniqueIndex(
      "agent_session_chunks_session_stream_key_unique"
    ).on(table.sessionId, table.streamType, table.chunkKey),
    sessionStreamSequenceIdx: index(
      "agent_session_chunks_session_stream_sequence_idx"
    ).on(table.sessionId, table.streamType, table.sequence),
  })
);

/**
 * The `mcp__arij__*` tool calls a session made, found in its raw stream AS IT
 * WAS WRITTEN (process-manager's onChunk feeds each raw chunk to the
 * incremental scanner and inserts what it completes).
 *
 * The raw stream used to be the only record of these calls, which made the
 * Arij-actions list its one full-stream reader: up to ~56 sequential 2 MiB
 * pages for the largest session on the live database, replayed whenever a
 * process opened a finished session. Indexed here, the list is one indexed
 * read and survives the raw stream being trimmed (#235) or pruned.
 *
 * `sequence` is the call's order within the session, across resumed runs.
 */
export const agentSessionToolCalls = sqliteTable(
  "agent_session_tool_calls",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    /** Tool name without the `mcp__arij__` prefix (e.g. "get_ticket"). */
    tool: text("tool").notNull(),
    /** Emission time of the chunk that completed the call, when known. */
    at: text("at"),
    /**
     * The provider's id for the call when it is unique across the session's
     * runs (Claude tool_use id, omp toolCall id); null otherwise. Each run
     * indexes with a fresh scanner, so this is what refuses a call that a
     * resumed run replays from an earlier one.
     */
    callId: text("call_id"),
  },
  (table) => ({
    sessionSequenceUnique: uniqueIndex(
      "agent_session_tool_calls_session_sequence_unique"
    ).on(table.sessionId, table.sequence),
    sessionCallIdUnique: uniqueIndex("agent_session_tool_calls_session_call_id_unique")
      .on(table.sessionId, table.callId)
      .where(sql`${table.callId} IS NOT NULL`),
  })
);

/**
 * One row per session whose calls in `agent_session_tool_calls` are complete:
 * either indexed from its FIRST raw chunk by the write path, or — for a
 * session written before the index — persisted by the read-side scan once it
 * had walked the whole stream of a finished session. Its absence is what
 * tells a reader to fall back to scanning the raw stream: a pre-index session
 * not yet scanned to its end, and a session whose indexing failed part-way
 * (the row is deleted then, so a short list is never served as a complete
 * one).
 *
 * A table rather than a column on `agent_sessions`: that row is wide, hot and
 * rewritten on every status change, and a marker the write path inserts once
 * does not need to ride along.
 */
export const agentSessionToolCallIndex = sqliteTable(
  "agent_session_tool_call_index",
  {
    sessionId: text("session_id")
      .primaryKey()
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  }
);

/**
 * Structured DevX friction reported by an agent session.
 *
 * `agentSessionId` intentionally remains an attributed string rather than a
 * foreign key: friction is durable project memory and must survive later
 * session cleanup. The optional epic link is cleared if its ticket is
 * deleted, while deleting the project removes the project-owned report.
 */
export const frictions = sqliteTable(
  "frictions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    epicId: text("epic_id").references(() => epics.id, {
      onDelete: "set null",
    }),
    agentSessionId: text("agent_session_id").notNull(),
    category: text("category").$type<FrictionCategory>().notNull(),
    description: text("description").notNull(),
    filePath: text("file_path"),
    occurrences: integer("occurrences").notNull().default(1),
    status: text("status").$type<FrictionStatus>().notNull().default("new"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    projectStatusOccurrencesIdx: index(
      "frictions_project_status_occurrences_idx"
    ).on(table.projectId, table.status, table.occurrences),
    openDedupeIdx: index("frictions_open_dedupe_idx").on(
      table.projectId,
      table.category,
      table.filePath,
      table.status
    ),
    sessionIdx: index("frictions_session_idx").on(table.agentSessionId),
    categoryCheck: check(
      "frictions_category_check",
      sql`${table.category} IN ('broken_tooling', 'misleading_docs', 'flaky_test', 'unclear_convention', 'other')`
    ),
    statusCheck: check(
      "frictions_status_check",
      sql`${table.status} IN ('new', 'triaged', 'converted', 'dismissed')`
    ),
    occurrencesCheck: check(
      "frictions_occurrences_check",
      sql`${table.occurrences} >= 1`
    ),
  })
);

/**
 * A durable visual proof copied out of a session worktree while it still
 * exists. `filename` is the generated basename below
 * data/sessions/<session-id>/artifacts/; source paths are never persisted.
 */
export const sessionArtifacts = sqliteTable(
  "session_artifacts",
  {
    id: text("id").primaryKey(),
    agentSessionId: text("agent_session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    epicId: text("epic_id")
      .notNull()
      .references(() => epics.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    caption: text("caption").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    sessionCreatedAtIdx: index("session_artifacts_session_created_at_idx").on(
      table.agentSessionId,
      table.createdAt
    ),
    epicCreatedAtIdx: index("session_artifacts_epic_created_at_idx").on(
      table.epicId,
      table.createdAt
    ),
  })
);

export const ticketComments = sqliteTable("ticket_comments", {
  id: text("id").primaryKey(),
  userStoryId: text("user_story_id").references(() => userStories.id, {
    onDelete: "cascade",
  }),
  epicId: text("epic_id").references(() => epics.id, { onDelete: "cascade" }),
  author: text("author").notNull(), // user | agent
  content: text("content").notNull(),
  agentSessionId: text("agent_session_id").references(() => agentSessions.id),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
},
(table) => ({
  // A comment hangs off exactly one of the two targets and each side is
  // queried on its own, so these stay two single-column indexes rather than
  // one composite that would only ever serve the epic lookup.
  epicIdx: index("ticket_comments_epic_idx").on(table.epicId),
  userStoryIdx: index("ticket_comments_user_story_idx").on(table.userStoryId),
}));

export const releases = sqliteTable("releases", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  title: text("title"),
  changelog: text("changelog"), // markdown
  epicIds: text("epic_ids"), // JSON array of epic IDs
  releaseBranch: text("release_branch"),
  gitTag: text("git_tag"),
  githubReleaseId: integer("github_release_id"),
  githubReleaseUrl: text("github_release_url"),
  /** When the tag and the GitHub draft were pushed — NOT when it went public. */
  pushedAt: text("pushed_at"),
  /**
   * When the GitHub release left draft. Written only by the publish route, so
   * a draft created by POST /releases stays a draft (see migration 0057).
   */
  publishedAt: text("published_at"),
  /**
   * The background `release_notes` session writing this release's changelog.
   * The release is claimed before the agent runs; while this session is live
   * the changelog on the row is the fallback and the tag does not exist yet.
   */
  // Annotated: epics → releases → agent_sessions → epics is a reference
  // cycle, and TypeScript cannot infer the three tables' types through it.
  changelogSessionId: text("changelog_session_id").references(
    (): AnySQLiteColumn => agentSessions.id,
    { onDelete: "set null" }
  ),
  /**
   * The POST's push-to-GitHub choice, kept for finalisation: the run's
   * closure dies with a queued cancellation or a restart, the row does not.
   */
  pushToGitHub: integer("push_to_github", { mode: "boolean" })
    .notNull()
    .default(false),
  /**
   * When the tag, the CHANGELOG commit and the GitHub draft were written (or
   * attempted). NULL = claimed but not finalised yet: GET /releases finishes
   * such a release once its changelog run is over.
   */
  finalizedAt: text("finalized_at"),
  /** JSON array of the finalisation failures (branch, tag push, GitHub). */
  finalizeErrors: text("finalize_errors"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const pullRequests = sqliteTable("pull_requests", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  epicId: text("epic_id").references(() => epics.id, { onDelete: "set null" }),
  number: integer("number").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("open"), // draft | open | closed | merged
  headBranch: text("head_branch").notNull(),
  baseBranch: text("base_branch").notNull().default("main"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const agentPrompts = sqliteTable(
  "agent_prompts",
  {
    id: text("id").primaryKey(),
    agentType: text("agent_type").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    scope: text("scope").notNull(), // 'global' | projectId
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    agentTypeScopeUnique: uniqueIndex("agent_prompts_agent_type_scope_unique").on(
      table.agentType,
      table.scope
    ),
  }),
);

export const namedAgents = sqliteTable(
  "named_agents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    provider: text("provider").notNull(), // see PROVIDER_OPTIONS in lib/agent-config/constants.ts
    model: text("model").notNull(),
    // Per-CLI options, JSON object of NON-DEFAULT values only. Keys and
    // accepted values are declared in lib/providers/options-registry.ts;
    // '{}' means "every option at the CLI's own default".
    options: text("options").notNull().default("{}"),
    // Free-text persona injected as the first section of the agent's prompt.
    // NULL/blank injects nothing; new agents are created with the product
    // default (see createNamedAgent).
    personaPrompt: text("persona_prompt"),
    // 'simple' | 'composite'. A composite is an ORDERED FALLBACK LIST of
    // simple agents (see compositeAgentMembers) that reuses this very table
    // so it stays assignable through every existing named_agent_id foreign
    // key. It owns no provider and no model: the two NOT NULL columns above
    // carry COMPOSITE_AGENT_PROVIDER and '' as documented sentinels, and
    // resolution unfolds to a member before either is read.
    kind: text("kind").notNull().default("simple"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    nameUnique: uniqueIndex("named_agents_name_unique").on(table.name),
  }),
);

/**
 * Ordered membership of a composite agent: attempt N of a pipeline stage runs
 * the member at `position` N-1.
 *
 * Nesting is refused at write time (a member must be `kind = 'simple'`), so
 * this is a flat list rather than a graph — there is deliberately no cycle
 * detection anywhere in the feature. Deleting a member removes it from every
 * composite it belonged to; the composite continues with what is left, and a
 * composite emptied that way resolves as UNUSABLE rather than falling back to
 * an arbitrary default agent.
 */
export const compositeAgentMembers = sqliteTable(
  "composite_agent_members",
  {
    id: text("id").primaryKey(),
    compositeId: text("composite_id")
      .notNull()
      .references((): AnySQLiteColumn => namedAgents.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references((): AnySQLiteColumn => namedAgents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    positionUnique: uniqueIndex("composite_agent_members_position_unique").on(
      table.compositeId,
      table.position
    ),
    memberUnique: uniqueIndex("composite_agent_members_member_unique").on(
      table.compositeId,
      table.memberId
    ),
    memberIdx: index("composite_agent_members_member_idx").on(table.memberId),
  }),
);

export const agentProviderDefaults = sqliteTable(
  "agent_provider_defaults",
  {
    id: text("id").primaryKey(),
    agentType: text("agent_type").notNull(),
    provider: text("provider").notNull(), // see PROVIDER_OPTIONS in lib/agent-config/constants.ts
    namedAgentId: text("named_agent_id").references(() => namedAgents.id, { onDelete: "set null" }),
    scope: text("scope").notNull(), // 'global' | projectId
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    agentTypeScopeUnique: uniqueIndex("agent_provider_defaults_agent_type_scope_unique").on(
      table.agentType,
      table.scope
    ),
  }),
);

export const ticketDependencies = sqliteTable(
  "ticket_dependencies",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => epics.id, { onDelete: "cascade" }),
    dependsOnTicketId: text("depends_on_ticket_id")
      .notNull()
      .references(() => epics.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").notNull().default("project"), // project | (future: cross-project)
    scopeId: text("scope_id").notNull(), // projectId for now; future: org/workspace id
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    dependencyUnique: uniqueIndex("ticket_dependencies_edge_unique").on(
      table.ticketId,
      table.dependsOnTicketId
    ),
    ticketIdx: index("ticket_dependencies_ticket_idx").on(table.ticketId),
    dependsOnIdx: index("ticket_dependencies_depends_on_idx").on(
      table.dependsOnTicketId
    ),
    projectIdx: index("ticket_dependencies_project_idx").on(table.projectId),
  })
);

export const reviewComments = sqliteTable(
  "review_comments",
  {
    id: text("id").primaryKey(),
    epicId: text("epic_id")
      .notNull()
      .references(() => epics.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    lineNumber: integer("line_number").notNull(),
    body: text("body").notNull(),
    author: text("author").notNull().default("user"), // user | agent
    status: text("status").notNull().default("open"), // open | resolved | dismissed
    dismissedReason: text("dismissed_reason"),
    // Review session that filed this finding (MCP submit_findings). NULL for
    // user-authored rows and for anything written before migration 0032 —
    // deliberately not backfilled, see that migration. No FK: a finding
    // outlives the session that filed it.
    agentSessionId: text("agent_session_id"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    epicFileIdx: index("review_comments_epic_file_idx").on(
      table.epicId,
      table.filePath
    ),
    // "Did this session file rows of its own?" — the escape hatch of the
    // unverifiable-review rule (0042). The epic/file index cannot serve it:
    // wrong leading column.
    sessionIdx: index("review_comments_session_idx").on(table.agentSessionId),
  })
);

/**
 * One atomic acceptance-criteria grading submitted by a grader session.
 *
 * `gradings` is the validated JSON array accepted by submit_grading. Keeping
 * the array together preserves the report boundary: downstream pipeline and
 * UI consumers can select the latest report without reconstructing one from
 * independently timestamped criterion rows.
 */
export const gradingReports = sqliteTable(
  "grading_reports",
  {
    id: text("id").primaryKey(),
    epicId: text("epic_id")
      .notNull()
      .references(() => epics.id, { onDelete: "cascade" }),
    agentSessionId: text("agent_session_id").references(
      () => agentSessions.id,
      { onDelete: "set null" }
    ),
    gradings: text("gradings").notNull(), // JSON: GradingEntry[]
    summary: text("summary").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    epicCreatedAtIdx: index("grading_reports_epic_created_at_idx").on(
      table.epicId,
      table.createdAt
    ),
    sessionIdx: index("grading_reports_session_idx").on(table.agentSessionId),
  })
);

export const gitSyncLog = sqliteTable("git_sync_log", {
  id: text("id").primaryKey(),
  // Nullable since 0029_git_sync_log_nullable_project: a clone is logged
  // before the project row exists (POST /api/projects/clone runs ahead of
  // POST /api/projects), and NOT NULL + FK made those rows un-insertable.
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  operation: text("operation").notNull(), // clone | push | pull | fetch | detect | tag_push | pr_create | pr_sync | release
  branch: text("branch"),
  status: text("status").notNull(), // success | failed
  detail: text("detail"), // JSON payload for error info
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const githubIssues = sqliteTable(
  "github_issues",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    issueNumber: integer("issue_number").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    labels: text("labels"), // JSON array
    milestone: text("milestone"),
    assignees: text("assignees"), // JSON array
    githubUrl: text("github_url").notNull(),
    createdAtGitHub: text("created_at_github"),
    updatedAtGitHub: text("updated_at_github"),
    syncedAt: text("synced_at").default(sql`CURRENT_TIMESTAMP`),
    importedEpicId: text("imported_epic_id").references(() => epics.id, { onDelete: "set null" }),
  },
  (table) => ({
    projectIssueUnique: uniqueIndex("github_issues_project_issue_unique").on(
      table.projectId,
      table.issueNumber
    ),
    projectSyncedIdx: index("github_issues_project_synced_idx").on(
      table.projectId,
      table.syncedAt
    ),
  })
);

export const qaReports = sqliteTable("qa_reports", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // running | completed | failed | cancelled | interrupted.
  // `interrupted` is written only by lib/qa/boot-cleanup.ts, for a check whose
  // session died before the one statement that finalizes this row could run.
  status: text("status").notNull().default("running"),
  agentSessionId: text("agent_session_id").references(() => agentSessions.id, { onDelete: "set null" }),
  namedAgentId: text("named_agent_id").references(() => namedAgents.id, { onDelete: "set null" }),
  promptUsed: text("prompt_used"),
  customPromptId: text("custom_prompt_id"),
  reportContent: text("report_content"),
  summary: text("summary"),
  checkType: text("check_type").notNull().default("tech_check"), // tech_check | e2e_test | failure_digest
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
});

/** Deterministic, non-agent test/lint/build results for an epic worktree. */
export const verifyReports = sqliteTable(
  "verify_reports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    epicId: text("epic_id")
      .notNull()
      .references(() => epics.id, { onDelete: "cascade" }),
    agentSessionId: text("agent_session_id").references(
      () => agentSessions.id,
      { onDelete: "set null" }
    ),
    status: text("status").notNull(), // pass | fail
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at").notNull(),
    commands: text("commands").notNull(), // JSON VerifyCommandResult[]
  },
  (table) => ({
    epicFinishedIdx: index("verify_reports_epic_finished_idx").on(
      table.epicId,
      table.finishedAt
    ),
  })
);

export const qaPrompts = sqliteTable(
  "qa_prompts",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    nameUnique: uniqueIndex("qa_prompts_name_unique").on(table.name),
  }),
);

export type GitSyncLog = typeof gitSyncLog.$inferSelect;
export type NewGitSyncLog = typeof gitSyncLog.$inferInsert;
export type GitHubIssue = typeof githubIssues.$inferSelect;
export type NewGitHubIssue = typeof githubIssues.$inferInsert;

export type QaReport = typeof qaReports.$inferSelect;
export type NewQaReport = typeof qaReports.$inferInsert;

export type VerifyReport = typeof verifyReports.$inferSelect;
export type NewVerifyReport = typeof verifyReports.$inferInsert;

export type QaPrompt = typeof qaPrompts.$inferSelect;
export type NewQaPrompt = typeof qaPrompts.$inferInsert;

export type AgentPrompt = typeof agentPrompts.$inferSelect;
export type NewAgentPrompt = typeof agentPrompts.$inferInsert;


export type AgentProviderDefault = typeof agentProviderDefaults.$inferSelect;
export type NewAgentProviderDefault = typeof agentProviderDefaults.$inferInsert;

export type NamedAgent = typeof namedAgents.$inferSelect;
export type NewNamedAgent = typeof namedAgents.$inferInsert;

export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;

export type Release = typeof releases.$inferSelect;
export type NewRelease = typeof releases.$inferInsert;

export type TicketDependency = typeof ticketDependencies.$inferSelect;
export type NewTicketDependency = typeof ticketDependencies.$inferInsert;

export type ReviewComment = typeof reviewComments.$inferSelect;
export type NewReviewComment = typeof reviewComments.$inferInsert;

export type GradingReport = typeof gradingReports.$inferSelect;
export type NewGradingReport = typeof gradingReports.$inferInsert;

export type Friction = typeof frictions.$inferSelect;
export type NewFriction = typeof frictions.$inferInsert;

export type SessionArtifact = typeof sessionArtifacts.$inferSelect;
export type NewSessionArtifact = typeof sessionArtifacts.$inferInsert;

export const ticketActivityLog = sqliteTable(
  "ticket_activity_log",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    epicId: text("epic_id")
      .notNull()
      .references(() => epics.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    actor: text("actor").notNull(), // user | agent | system
    reason: text("reason"),
    sessionId: text("session_id"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    epicIdx: index("ticket_activity_log_epic_idx").on(table.epicId),
    projectIdx: index("ticket_activity_log_project_idx").on(table.projectId),
    toStatusCreatedAtIdx: index("ticket_activity_log_to_status_created_at_idx").on(
      table.toStatus,
      table.createdAt,
    ),
  })
);

export type TicketActivityLog = typeof ticketActivityLog.$inferSelect;
export type NewTicketActivityLog = typeof ticketActivityLog.$inferInsert;

// ---------------------------------------------------------------------------
// Ticket read cursors
// ---------------------------------------------------------------------------

/**
 * Per-epic read cursor. Single-user local app: one row per epic, everything
 * up to last_read_at counts as read. No FK to epics — cursors are pure
 * bookkeeping and stale rows are harmless.
 */
export const ticketReadCursors = sqliteTable("ticket_read_cursors", {
  epicId: text("epic_id").primaryKey(),
  lastReadAt: text("last_read_at").notNull(), // ISO timestamp
  updatedAt: text("updated_at").notNull(), // ISO timestamp
});

export type TicketReadCursor = typeof ticketReadCursors.$inferSelect;
export type NewTicketReadCursor = typeof ticketReadCursors.$inferInsert;

// ---------------------------------------------------------------------------
// Desk dismissals
// ---------------------------------------------------------------------------

/**
 * A "Your turn" signal the user has waved off.
 *
 * The three coral families are DERIVED, never marked: an asks-you row lives as
 * long as `isAwaitingReply` holds, a failure until a newer session supersedes
 * it, a conflict until it is resolved. So there was no way to say "I handled
 * this elsewhere" — hence this table.
 *
 * `signal_at` is the timestamp of the DISMISSED signal, not the moment of the
 * dismissal: the row stays hidden only while the epic's current signal is no
 * newer than the one waved off. A new question, a new failure or a fresh
 * conflict on the same epic therefore comes back. A permanent dismissal would
 * hide real failures, which is exactly what this stratum exists to prevent.
 *
 * No FK, on the same reasoning as `ticket_read_cursors` above: this is pure
 * bookkeeping, and a row left behind by a deleted epic is inert.
 */
export const deskDismissals = sqliteTable(
  "desk_dismissals",
  {
    epicId: text("epic_id").notNull(),
    /** One of `asks` | `failed` | `conflict`. */
    kind: text("kind").notNull(),
    /** ISO timestamp of the signal that was waved off. */
    signalAt: text("signal_at"),
  },
  (table) => [primaryKey({ columns: [table.epicId, table.kind] })],
);

export type DeskDismissal = typeof deskDismissals.$inferSelect;
export type NewDeskDismissal = typeof deskDismissals.$inferInsert;

// ---------------------------------------------------------------------------
// Provider usage snapshots
// ---------------------------------------------------------------------------

// Latest provider-reported rate-limit snapshot per provider (see migration
// 0027). captured_at = provider event time (ISO UTC); resets_at = unix
// SECONDS as emitted; raw_json = the full rate_limits object.
export const providerUsageSnapshots = sqliteTable("provider_usage_snapshots", {
  provider: text("provider").primaryKey(),
  capturedAt: text("captured_at").notNull(),
  planType: text("plan_type"),
  primaryUsedPercent: real("primary_used_percent"),
  primaryWindowMinutes: integer("primary_window_minutes"),
  primaryResetsAt: integer("primary_resets_at"),
  secondaryUsedPercent: real("secondary_used_percent"),
  secondaryWindowMinutes: integer("secondary_window_minutes"),
  secondaryResetsAt: integer("secondary_resets_at"),
  rawJson: text("raw_json").notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export type ProviderUsageSnapshot = typeof providerUsageSnapshots.$inferSelect;
export type NewProviderUsageSnapshot = typeof providerUsageSnapshots.$inferInsert;

/**
 * User-declared third-party MCP servers (epic "Serveurs MCP additionnels,
 * globaux et par projet").
 *
 * `projectId` NULL = a global server injected into every project's
 * sessions; a value scopes the server to one project. The cascade FK
 * makes project deletion clean up the project's servers automatically.
 * `name` is unique PER SCOPE, enforced by two PARTIAL unique indexes
 * (migration 0049): a plain UNIQUE(project_id, name) cannot express
 * "unique among the globals" because SQLite treats NULLs as distinct, but
 * a partial index keyed on `project_id IS NULL` can. The service checks the
 * same invariant first so the API answers 409 rather than surfacing a raw
 * constraint error. The name `arij` is reserved by the service.
 *
 * `env` / `headers` values are write-only: reads mask them (see
 * maskMcpServerSecrets), and `agentTypes` NULL means "every session type"
 * (agent types AND chat turns).
 */
export const mcpServers = sqliteTable(
  "mcp_servers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    transport: text("transport", { enum: ["stdio", "http"] })
      .notNull()
      .default("stdio"),
    command: text("command"),
    args: text("args").notNull().default("[]"),
    env: text("env").notNull().default("{}"),
    url: text("url"),
    headers: text("headers").notNull().default("{}"),
    /** JSON array of agent types ("chat" names CLI chat turns); NULL = all. */
    agentTypes: text("agent_types"),
    /** JSON array of bare tool names; NULL = every tool the server exposes. */
    toolAllowlist: text("tool_allowlist"),
    usageHint: text("usage_hint"),
    lastCheckedAt: text("last_checked_at"),
    /** Tri-state: NULL = never checked. */
    lastCheckOk: integer("last_check_ok", { mode: "boolean" }),
    lastCheckError: text("last_check_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    scopeNameIdx: index("mcp_servers_scope_name_idx").on(
      table.projectId,
      table.name
    ),
    // Per-scope uniqueness (migration 0049). Two PARTIAL indexes, because the
    // scopes need different key shapes: a global is unique on `name` alone, a
    // project row on the pair.
    globalNameUq: uniqueIndex("mcp_servers_global_name_uq")
      .on(table.name)
      .where(sql`${table.projectId} IS NULL`),
    projectNameUq: uniqueIndex("mcp_servers_project_name_uq")
      .on(table.projectId, table.name)
      .where(sql`${table.projectId} IS NOT NULL`),
    transportCheck: check(
      "mcp_servers_transport_check",
      sql`${table.transport} IN ('stdio', 'http')`
    ),
  })
);

export type McpServer = typeof mcpServers.$inferSelect;
export type NewMcpServer = typeof mcpServers.$inferInsert;
