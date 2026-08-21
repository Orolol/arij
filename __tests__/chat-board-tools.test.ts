import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

import {
  dbMockState,
  resetDbMockState,
  getDbChainMock,
} from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

import {
  CHAT_BOARD_TOOL_DEFINITIONS,
  buildBoardToolsSystemSection,
  executeChatBoardTool,
  type ChatBoardToolContext,
} from "@/lib/chat/board-tools";
import type { OpenAiToolCall } from "@/lib/openai/client";

const EXPECTED_TOOL_NAMES = [
  "list_tickets",
  "get_ticket",
  "create_ticket",
  "update_ticket",
  "update_ticket_status",
  "post_comment",
  "get_agent_status",
  "start_build",
];

const WRITABLE_STATUSES = ["backlog", "todo", "in_progress", "review", "done"];

const ctx: ChatBoardToolContext = {
  projectId: "proj1",
  baseUrl: "http://localhost:3000",
  mcpToken: "mcp-token-1",
};

function toolCall(name: string, args?: unknown): OpenAiToolCall {
  return {
    id: "call_1",
    type: "function",
    function: {
      name,
      arguments:
        args === undefined
          ? ""
          : typeof args === "string"
            ? args
            : JSON.stringify(args),
    },
  };
}

function toolDef(name: string) {
  const def = CHAT_BOARD_TOOL_DEFINITIONS.find((d) => d.function.name === name);
  if (!def) throw new Error(`Tool definition ${name} not found`);
  return def;
}

/** Seeds the ticket-resolution select (`.get()` on the epics table). */
function seedTicket(
  overrides: Partial<{ id: string; readableId: string | null; title: string }> = {},
) {
  dbMockState.getQueue.push({
    id: "epic1",
    readableId: "E-arij-042",
    title: "Ship the thing",
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function fetchCallAt(fetchMock: ReturnType<typeof vi.fn>, index = 0): FetchCall {
  const call = fetchMock.mock.calls[index] as [string, RequestInit];
  const [url, init] = call;
  return {
    url,
    method: init.method,
    headers: (init.headers ?? {}) as Record<string, string>,
    body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
  };
}

describe("CHAT_BOARD_TOOL_DEFINITIONS", () => {
  it("exposes exactly the 8 board tools", () => {
    expect(CHAT_BOARD_TOOL_DEFINITIONS).toHaveLength(8);
    expect(CHAT_BOARD_TOOL_DEFINITIONS.map((d) => d.function.name).sort()).toEqual(
      [...EXPECTED_TOOL_NAMES].sort(),
    );
  });

  it("gives every tool a function shape with name, description and parameters", () => {
    for (const def of CHAT_BOARD_TOOL_DEFINITIONS) {
      expect(def.type).toBe("function");
      expect(def.function.name).toBeTruthy();
      expect(typeof def.function.description).toBe("string");
      expect(def.function.description.length).toBeGreaterThan(0);
      expect(def.function.parameters).toMatchObject({ type: "object" });
    }
  });

  it("lists the required fields per tool", () => {
    const requiredOf = (name: string) =>
      (toolDef(name).function.parameters as { required?: string[] }).required;

    expect(requiredOf("get_ticket")).toEqual(["ticket_id"]);
    expect(requiredOf("create_ticket")).toEqual(["title"]);
    expect(requiredOf("update_ticket")).toEqual(["ticket_id"]);
    expect(requiredOf("update_ticket_status")).toEqual(["ticket_id", "status"]);
    expect(requiredOf("post_comment")).toEqual(["ticket_id", "body"]);
    expect(requiredOf("start_build")).toEqual(["ticket_id"]);
    // Read-only tools have no required fields.
    expect(requiredOf("list_tickets")).toBeUndefined();
    expect(requiredOf("get_agent_status")).toBeUndefined();
  });

  it('never offers "released" as a writable status value', () => {
    const statusEnum = (name: string) => {
      const params = toolDef(name).function.parameters as {
        properties: Record<string, { enum?: string[] }>;
      };
      return params.properties.status?.enum;
    };

    // The two tools that write a status only advertise the writable columns.
    expect(statusEnum("create_ticket")).toEqual(WRITABLE_STATUSES);
    expect(statusEnum("update_ticket_status")).toEqual(WRITABLE_STATUSES);
    expect(statusEnum("create_ticket")).not.toContain("released");
    expect(statusEnum("update_ticket_status")).not.toContain("released");
    // update_ticket cannot touch status at all.
    const updateParams = toolDef("update_ticket").function.parameters as {
      properties: Record<string, unknown>;
    };
    expect(updateParams.properties.status).toBeUndefined();
    // list_tickets' status is a read filter, so it may include released.
    expect(statusEnum("list_tickets")).toContain("released");
  });
});

describe("buildBoardToolsSystemSection", () => {
  it("names the project and includes its description when present", () => {
    const section = buildBoardToolsSystemSection({
      name: "Arij",
      description: "  An orchestrator.  ",
    });
    expect(section).toContain('"Arij"');
    expect(section).toContain("Project description: An orchestrator.");
  });

  it("omits the description line when it is empty", () => {
    const section = buildBoardToolsSystemSection({ name: null, description: "   " });
    expect(section).toContain('"this project"');
    expect(section).not.toContain("Project description:");
  });
});

describe("executeChatBoardTool", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("dispatch", () => {
    it("returns an {error} for an unknown tool name", async () => {
      const result = JSON.parse(await executeChatBoardTool(toolCall("drop_database", {}), ctx));
      expect(result).toEqual({ error: "Unknown tool: drop_database" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns an {error} for invalid JSON arguments without throwing", async () => {
      const result = JSON.parse(
        await executeChatBoardTool(toolCall("list_tickets", "{not json"), ctx),
      );
      expect(result).toEqual({ error: "Invalid JSON arguments for list_tickets." });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects non-object JSON arguments (arrays, scalars)", async () => {
      for (const bad of ["[1,2]", '"str"', "null"]) {
        const result = JSON.parse(await executeChatBoardTool(toolCall("get_ticket", bad), ctx));
        expect(result.error).toBe("Invalid JSON arguments for get_ticket.");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("treats empty arguments as {} (get_agent_status works without args)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
      const result = JSON.parse(await executeChatBoardTool(toolCall("get_agent_status"), ctx));
      expect(result).toEqual({ count: 0, activities: [] });
    });

    it("converts a thrown fetch error into an {error} result instead of throwing", async () => {
      fetchMock.mockRejectedValue(new Error("boom: network down"));
      const result = JSON.parse(
        await executeChatBoardTool(toolCall("list_tickets", {}), ctx),
      );
      expect(result).toEqual({ error: "boom: network down" });
    });
  });

  describe("ticket resolution", () => {
    it("resolves a mixed-case readable id to the epic id before calling the API", async () => {
      seedTicket({ id: "epic1", readableId: "E-arij-042" });
      fetchMock.mockResolvedValue(jsonResponse({ ticket: { id: "epic1" } }));

      await executeChatBoardTool(toolCall("get_ticket", { ticket_id: "e-ARIJ-042" }), ctx);

      const call = fetchCallAt(fetchMock);
      expect(call.url).toBe("http://localhost:3000/api/mcp/get-ticket");
      // The MCP route receives the resolved nanoid, not the readable ref.
      expect(call.body).toEqual({ ticket_id: "epic1" });
    });

    it("matches readable ids case-insensitively and scopes to the project", () => {
      seedTicket();
      // Trigger a resolution via update_ticket_status (fetch response irrelevant here).
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      return executeChatBoardTool(
        toolCall("update_ticket_status", { ticket_id: "e-arij-042", status: "todo" }),
        ctx,
      ).then(() => {
        const whereArg = getDbChainMock().where.mock.calls[0][0];
        const query = new SQLiteSyncDialect().sqlToQuery(whereArg);
        // Both sides of the readable-id comparison are lower()ed.
        expect(query.sql.match(/lower\(/g)?.length).toBe(2);
        expect(query.params).toContain("proj1");
        expect(query.params).toContain("e-arij-042");
      });
    });

    it.each(["get_ticket", "post_comment", "update_ticket_status"])(
      "%s returns an error pointing at list_tickets for an unknown ref, with no fetch",
      async (tool) => {
        // getQueue empty: resolution finds nothing.
        const result = JSON.parse(
          await executeChatBoardTool(
            toolCall(tool, { ticket_id: "E-arij-999", status: "todo", body: "hi" }),
            ctx,
          ),
        );
        expect(result.error).toContain('No ticket "E-arij-999" found');
        expect(result.error).toContain("list_tickets");
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  describe("list_tickets", () => {
    const boardRows = [
      {
        id: "epic1",
        readableId: "E-arij-001",
        title: "First",
        status: "todo",
        type: "feature",
        priority: 2,
        usDone: 1,
        usCount: 3,
        prStatus: "open",
        latestSessionOutcome: "success",
        internalNoise: "should not leak",
      },
      {
        id: "epic2",
        readableId: null,
        title: "Second",
        status: "todo",
        type: "bug",
        priority: 0,
      },
      {
        id: "epic3",
        readableId: "E-arij-003",
        title: "Third",
        status: "done",
        type: "feature",
        priority: 1,
      },
    ];

    it("maps board rows to compact snake_case fields and computes by_status", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: boardRows }));

      const result = JSON.parse(await executeChatBoardTool(toolCall("list_tickets", {}), ctx));

      expect(fetchCallAt(fetchMock).url).toBe("http://localhost:3000/api/projects/proj1/epics");
      expect(result.count).toBe(3);
      expect(result.by_status).toEqual({ todo: 2, done: 1 });
      expect(result.tickets[0]).toEqual({
        id: "epic1",
        readable_id: "E-arij-001",
        title: "First",
        status: "todo",
        type: "feature",
        priority: 2,
        stories_done: 1,
        stories_total: 3,
        pr_status: "open",
        latest_session_outcome: "success",
      });
      // Missing counters default, missing readable id maps to null.
      expect(result.tickets[1]).toMatchObject({
        readable_id: null,
        stories_done: 0,
        stories_total: 0,
        pr_status: null,
        latest_session_outcome: null,
      });
      expect(result.tickets[0]).not.toHaveProperty("internalNoise");
    });

    it("applies the status filter", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: boardRows }));

      const result = JSON.parse(
        await executeChatBoardTool(toolCall("list_tickets", { status: "done" }), ctx),
      );

      expect(result.count).toBe(1);
      expect(result.by_status).toEqual({ done: 1 });
      expect(result.tickets.map((t: { id: string }) => t.id)).toEqual(["epic3"]);
    });

    it("returns an error on an unexpected response shape", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: "nope" }));
      const result = JSON.parse(await executeChatBoardTool(toolCall("list_tickets", {}), ctx));
      expect(result).toEqual({ error: "Unexpected board response shape." });
    });
  });

  describe("authentication routing", () => {
    it.each([
      ["get_ticket", { ticket_id: "E-arij-042" }, "/api/mcp/get-ticket"],
      [
        "update_ticket_status",
        { ticket_id: "E-arij-042", status: "done" },
        "/api/mcp/update-ticket-status",
      ],
    ])("%s sends the MCP bearer token to %s", async (tool, args, path) => {
      seedTicket();
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

      await executeChatBoardTool(toolCall(tool, args), ctx);

      const call = fetchCallAt(fetchMock);
      expect(call.url).toBe(`http://localhost:3000${path}`);
      expect(call.method).toBe("POST");
      expect(call.headers.Authorization).toBe("Bearer mcp-token-1");
    });

    it.each([
      ["list_tickets", {}, jsonResponse({ data: [] })],
      ["create_ticket", { title: "New" }, jsonResponse({ data: { id: "e" } })],
      [
        "update_ticket",
        { ticket_id: "E-arij-042", title: "Renamed" },
        jsonResponse({ data: {} }),
      ],
      [
        "post_comment",
        { ticket_id: "E-arij-042", body: "hello" },
        jsonResponse({ data: { id: "c1" } }),
      ],
      [
        "start_build",
        { ticket_id: "E-arij-042" },
        jsonResponse({ data: { sessionId: "s1", branchName: "b1" } }),
      ],
      ["get_agent_status", {}, jsonResponse({ data: [] })],
    ])("%s does not send an Authorization header", async (tool, args, response) => {
      seedTicket();
      fetchMock.mockResolvedValue(response);

      await executeChatBoardTool(toolCall(tool, args), ctx);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchCallAt(fetchMock);
      expect(call.headers.Authorization).toBeUndefined();
      expect(call.url).not.toContain("/api/mcp/");
    });

    it("post_comment posts an agent-authored comment via the epic comments route", async () => {
      seedTicket({ id: "epic1" });
      fetchMock.mockResolvedValue(jsonResponse({ data: { id: "c1" } }));

      const result = JSON.parse(
        await executeChatBoardTool(
          toolCall("post_comment", { ticket_id: "E-arij-042", body: "hello" }),
          ctx,
        ),
      );

      const call = fetchCallAt(fetchMock);
      // The MCP comment route would link the chat turn's session id, which
      // has no agent_sessions row (FK) — the comments route is the target.
      expect(call.url).toBe(
        "http://localhost:3000/api/projects/proj1/epics/epic1/comments",
      );
      expect(call.body).toEqual({ author: "agent", content: "hello" });
      expect(result).toEqual({ posted: true, ticket_id: "E-arij-042" });
    });

    it("start_build posts the instruction as an agent comment, never as the build route's user comment", async () => {
      seedTicket({ id: "epic1" });
      fetchMock.mockResolvedValue(
        jsonResponse({ data: { sessionId: "s1", branchName: "b1" } }),
      );

      const result = JSON.parse(
        await executeChatBoardTool(
          toolCall("start_build", { ticket_id: "E-arij-042", comment: "focus on the API" }),
          ctx,
        ),
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const commentCall = fetchCallAt(fetchMock, 0);
      expect(commentCall.url).toBe(
        "http://localhost:3000/api/projects/proj1/epics/epic1/comments",
      );
      expect(commentCall.body).toEqual({ author: "agent", content: "focus on the API" });
      const buildCall = fetchCallAt(fetchMock, 1);
      expect(buildCall.url).toBe(
        "http://localhost:3000/api/projects/proj1/epics/epic1/build",
      );
      expect(buildCall.body).toEqual({});
      expect(result.started).toMatchObject({ instruction_posted: true });
    });
  });

  describe("error passthrough", () => {
    it("surfaces a 409 route error (message + code) in the tool result", async () => {
      seedTicket();
      fetchMock.mockResolvedValue(
        jsonResponse(
          { error: "Cannot move to done: review not approved.", code: "REVIEW_REQUIRED" },
          409,
        ),
      );

      const result = JSON.parse(
        await executeChatBoardTool(
          toolCall("update_ticket_status", { ticket_id: "E-arij-042", status: "done" }),
          ctx,
        ),
      );

      expect(result).toEqual({
        error: "Cannot move to done: review not approved.",
        detail: { code: "REVIEW_REQUIRED", status: 409 },
      });
    });

    it("falls back to the HTTP status when the body has no error text", async () => {
      seedTicket();
      fetchMock.mockResolvedValue(jsonResponse({}, 500));
      const result = JSON.parse(
        await executeChatBoardTool(toolCall("get_ticket", { ticket_id: "E-arij-042" }), ctx),
      );
      expect(result).toEqual({ error: "Request failed (500)", detail: { status: 500 } });
    });
  });

  describe("truncation", () => {
    it("truncates results whose JSON exceeds 12000 chars to {truncated, preview}", async () => {
      seedTicket();
      const huge = { description: "x".repeat(13000) };
      fetchMock.mockResolvedValue(jsonResponse(huge));

      const raw = await executeChatBoardTool(
        toolCall("get_ticket", { ticket_id: "E-arij-042" }),
        ctx,
      );
      const result = JSON.parse(raw);

      expect(result.truncated).toBe(true);
      expect(result.note).toContain("12000");
      expect(result.preview).toBe(JSON.stringify(huge).slice(0, 12000));
      expect(result.preview.length).toBe(12000);
    });

    it("returns small results untouched", async () => {
      seedTicket();
      fetchMock.mockResolvedValue(jsonResponse({ ticket: { id: "epic1" } }));
      const result = JSON.parse(
        await executeChatBoardTool(toolCall("get_ticket", { ticket_id: "E-arij-042" }), ctx),
      );
      expect(result).toEqual({ ticket: { id: "epic1" } });
    });
  });

  describe("create_ticket", () => {
    it("maps snake_case user_stories to the route's camelCase userStories", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          data: { id: "epicN", readableId: "E-arij-100", title: "New", status: "backlog" },
        }),
      );

      const result = JSON.parse(
        await executeChatBoardTool(
          toolCall("create_ticket", {
            title: "New",
            description: "Body",
            type: "bug",
            priority: 3,
            status: "todo",
            user_stories: [
              {
                title: "As a user",
                description: "I want",
                acceptance_criteria: "It works",
              },
              { title: "Bare story" },
              { description: "no title, dropped" },
            ],
          }),
          ctx,
        ),
      );

      const call = fetchCallAt(fetchMock);
      expect(call.url).toBe("http://localhost:3000/api/projects/proj1/epics");
      expect(call.method).toBe("POST");
      expect(call.body).toEqual({
        title: "New",
        description: "Body",
        type: "bug",
        priority: 3,
        status: "todo",
        userStories: [
          { title: "As a user", description: "I want", acceptanceCriteria: "It works" },
          { title: "Bare story" },
        ],
      });
      expect(result).toEqual({
        created: {
          id: "epicN",
          readable_id: "E-arij-100",
          title: "New",
          status: "backlog",
        },
      });
    });

    it("omits userStories entirely when none are passed", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: { id: "epicN" } }));
      await executeChatBoardTool(toolCall("create_ticket", { title: "Solo" }), ctx);
      expect(fetchCallAt(fetchMock).body).not.toHaveProperty("userStories");
    });
  });

  describe("update_ticket", () => {
    it("returns an {error} and performs no fetch when no editable field is given", async () => {
      seedTicket();
      const result = JSON.parse(
        await executeChatBoardTool(toolCall("update_ticket", { ticket_id: "E-arij-042" }), ctx),
      );
      expect(result).toEqual({
        error: "Nothing to update: pass title, description and/or priority.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("PATCHes only the provided fields to the epic route", async () => {
      seedTicket();
      fetchMock.mockResolvedValue(jsonResponse({ data: {} }));

      const result = JSON.parse(
        await executeChatBoardTool(
          toolCall("update_ticket", { ticket_id: "E-arij-042", title: "Renamed", priority: 1 }),
          ctx,
        ),
      );

      const call = fetchCallAt(fetchMock);
      expect(call.url).toBe("http://localhost:3000/api/projects/proj1/epics/epic1");
      expect(call.method).toBe("PATCH");
      expect(call.body).toEqual({ title: "Renamed", priority: 1 });
      expect(result).toEqual({
        updated: { id: "epic1", readable_id: "E-arij-042", title: "Renamed", priority: 1 },
      });
    });
  });
});
