#!/usr/bin/env node
/**
 * Arij MCP shim — a stdio Model Context Protocol server that gives spawned
 * CLI agents (claude-code, codex) a structured channel back into Arij.
 *
 * Every tool call is a thin HTTP bridge: POST ${ARIJ_BASE_URL}/api/mcp/<tool>
 * with the session-scoped bearer token from ARIJ_MCP_TOKEN. All failures —
 * network, timeout, non-2xx — surface as tool-level `isError` results, never
 * as protocol crashes.
 *
 * Deliberate constraints:
 * - Low-level SDK API (Server + raw JSON Schema), NOT McpServer/registerTool:
 *   the SDK bundles zod@3 while the repo uses zod@4, and the low-level API
 *   needs no zod at all.
 * - Zero imports from lib/ — the shim must run standalone under any cwd
 *   (agent sessions run in per-ticket worktrees, not the app root).
 */

import process from "node:process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const baseUrl = (process.env.ARIJ_BASE_URL ?? "").replace(/\/+$/, "");
const token = process.env.ARIJ_MCP_TOKEN ?? "";

if (!baseUrl || !token) {
  process.stderr.write(
    "arij-mcp: ARIJ_BASE_URL and ARIJ_MCP_TOKEN environment variables are required\n"
  );
  process.exit(1);
}

const TICKET_ID_PROPERTY = {
  ticket_id: {
    type: "string",
    minLength: 1,
    description:
      "Optional: id of another ticket in the same project. Defaults to the ticket this session was launched for.",
  },
};

const TOOLS = [
  {
    name: "get_ticket",
    description:
      "Read the Arij ticket this session was launched for: status, description, user stories with acceptance criteria, comment thread, and open review findings. Optional ticket_id targets another ticket in the same project.",
    inputSchema: {
      type: "object",
      properties: { ...TICKET_ID_PROPERTY },
      additionalProperties: false,
    },
  },
  {
    name: "update_ticket_status",
    description:
      "Move the ticket on the Arij board (backlog, todo, in_progress, review, done). Transitions are validated by Arij's workflow engine; review→done needs human approval and will be rejected — finish, report, and let the user approve. Call this instead of announcing a status change in prose.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
          description: "Target board column.",
        },
        reason: {
          type: "string",
          maxLength: 500,
          description: "Short reason recorded in the ticket activity log.",
        },
        ...TICKET_ID_PROPERTY,
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
  {
    name: "post_comment",
    description:
      "Post a progress/result comment to the ticket's activity feed (what changed, decisions, blockers). Not for questions — use ask_question.",
    inputSchema: {
      type: "object",
      properties: {
        body: {
          type: "string",
          minLength: 1,
          maxLength: 8000,
          description: "Markdown comment body.",
        },
        ...TICKET_ID_PROPERTY,
      },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_question",
    description:
      "Ask the user a blocking question and stop working on the blocked part. This reliably marks the session as awaiting a reply and holds the ticket from advancing. Include full context and concrete options in one call, then end your turn.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description:
            "The blocking question, with full context and concrete options.",
        },
        ...TICKET_ID_PROPERTY,
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_findings",
    description:
      "(Review sessions) File structured review findings: each finding anchors to file_path+line and becomes an open review comment that blocks approval until resolved; include an overall verdict and summary. Still end your final message with the required '**Overall Verdict: …**' line.",
    inputSchema: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          enum: ["approved", "approved_with_minor_issues", "changes_requested"],
          description: "Overall review verdict.",
        },
        summary: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description:
            "Overall review summary; also the place for general findings without a file+line anchor.",
        },
        findings: {
          type: "array",
          maxItems: 50,
          description: "File+line anchored findings.",
          items: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                minLength: 1,
                description: "Repo-relative path of the file.",
              },
              line: {
                type: "integer",
                minimum: 1,
                description: "1-indexed line number the finding anchors to.",
              },
              body: {
                type: "string",
                minLength: 1,
                maxLength: 2000,
                description: "The finding itself.",
              },
              severity: {
                type: "string",
                enum: ["critical", "major", "minor", "info"],
              },
            },
            required: ["file_path", "line", "body", "severity"],
            additionalProperties: false,
          },
        },
      },
      required: ["verdict", "summary", "findings"],
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

/** Wrap a message as a tool-level error result (never a protocol failure). */
function toolError(text) {
  return { content: [{ type: "text", text }], isError: true };
}

async function callArijApi(name, args) {
  const endpoint = name.replace(/_/g, "-");
  let response;
  try {
    response = await fetch(`${baseUrl}/api/mcp/${endpoint}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args ?? {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Error (NETWORK): ${message}`);
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON body — fall through to status-based reporting.
  }

  if (response.ok) {
    return { content: [{ type: "text", text: JSON.stringify(json?.data ?? null) }] };
  }

  return toolError(
    `Error (${json?.code ?? response.status}): ${json?.error ?? response.statusText}`
  );
}

const server = new Server(
  { name: "arij", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!TOOL_NAMES.has(name)) {
    return toolError(`Error (UNKNOWN_TOOL): "${name}" is not an Arij tool`);
  }
  return callArijApi(name, args);
});

const transport = new StdioServerTransport();
await server.connect(transport);
