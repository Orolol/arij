/**
 * End-to-end tests for bin/arij-mcp.mjs — the stdio MCP shim.
 *
 * Spawns the real shim as a child process (exactly how a CLI agent's MCP
 * client would) and drives the JSON-RPC handshake over stdio:
 * initialize → notifications/initialized → tools/list → tools/call, against a
 * stub node:http backend standing in for the Arij server. Asserts the bearer
 * header, the 5-tool registry shape, kebab-case endpoint mapping, and the
 * error → isError tool-result mapping (never a protocol crash).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SHIM_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "bin",
  "arij-mcp.mjs"
);

const EXPECTED_TOOL_NAMES = [
  "get_ticket",
  "update_ticket_status",
  "post_comment",
  "ask_question",
  "submit_findings",
];

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  body: unknown;
}

/* ------------------------------------------------------------------ */
/* Stub Arij HTTP backend                                              */
/* ------------------------------------------------------------------ */

let httpServer: HttpServer;
let baseUrl: string;
let capturedRequests: CapturedRequest[] = [];
let nextResponse: { status: number; body: unknown } = {
  status: 200,
  body: { data: null },
};

function startStubServer(): Promise<void> {
  httpServer = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      capturedRequests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        contentType: req.headers["content-type"],
        body: raw ? JSON.parse(raw) : null,
      });
      res.writeHead(nextResponse.status, { "content-type": "application/json" });
      res.end(JSON.stringify(nextResponse.body));
    });
  });
  return new Promise((resolvePromise) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const { port } = httpServer.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolvePromise();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Minimal JSON-RPC stdio client                                       */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
class McpStdioClient {
  readonly child: ChildProcess;
  stderr = "";
  private buffer = "";
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (err: Error) => void }
  >();

  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [SHIM_PATH], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout!.on("data", (chunk: Buffer) => this.handleData(chunk));
    this.child.stderr!.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (typeof message.id === "number" && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) {
          entry.reject(
            new Error(`JSON-RPC error ${message.error.code}: ${message.error.message}`)
          );
        } else {
          entry.resolve(message.result);
        }
      }
    }
  }

  request(method: string, params?: unknown, timeoutMs = 10000): Promise<any> {
    const id = this.nextId++;
    const promise = new Promise<any>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Timed out waiting for ${method} response`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          rejectPromise(err);
        },
      });
    });
    this.child.stdin!.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
    );
    return promise;
  }

  notify(method: string, params?: unknown): void {
    this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async initialize(): Promise<any> {
    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "arij-shim-test", version: "0.0.0" },
    });
    this.notify("notifications/initialized");
    return result;
  }

  callTool(name: string, args: unknown): Promise<any> {
    return this.request("tools/call", { name, arguments: args });
  }

  kill(): void {
    this.child.kill();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* Suite                                                               */
/* ------------------------------------------------------------------ */

let client: McpStdioClient;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let initResult: any;

beforeAll(async () => {
  await startStubServer();
  client = new McpStdioClient({
    ...process.env,
    ARIJ_BASE_URL: baseUrl,
    ARIJ_MCP_TOKEN: "test-token",
  });
  initResult = await client.initialize();
}, 20000);

afterAll(async () => {
  client?.kill();
  await new Promise<void>((resolvePromise) =>
    httpServer.close(() => resolvePromise())
  );
});

beforeEach(() => {
  capturedRequests = [];
  nextResponse = { status: 200, body: { data: null } };
});

describe("startup", () => {
  it("exits 1 with a stderr message when env vars are missing", async () => {
    const env = { ...process.env };
    delete env.ARIJ_BASE_URL;
    delete env.ARIJ_MCP_TOKEN;

    const child = spawn(process.execPath, [SHIM_PATH], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const [code] = (await once(child, "exit")) as [number | null];

    expect(code).toBe(1);
    expect(stderr).toContain("ARIJ_BASE_URL");
    expect(stderr).toContain("ARIJ_MCP_TOKEN");
  }, 15000);

  it("identifies itself as the 'arij' server with tools capability", () => {
    expect(initResult.serverInfo.name).toBe("arij");
    expect(initResult.capabilities.tools).toBeDefined();
  });
});

describe("tools/list", () => {
  it("declares exactly the five Arij tools, in order, with schemas", async () => {
    const result = await client.request("tools/list", {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byName = new Map(result.tools.map((tool: any) => [tool.name, tool]));
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      EXPECTED_TOOL_NAMES
    );
    for (const tool of result.tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateStatus: any = byName.get("update_ticket_status");
    expect(updateStatus.inputSchema.properties.status.enum).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "review",
      "done",
    ]); // "released" is system-only and must not be offered
    expect(updateStatus.inputSchema.required).toEqual(["status"]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const submitFindings: any = byName.get("submit_findings");
    expect(submitFindings.inputSchema.required).toEqual([
      "verdict",
      "summary",
      "findings",
    ]);
    expect(submitFindings.inputSchema.properties.findings.maxItems).toBe(50);
    expect(
      submitFindings.inputSchema.properties.findings.items.required
    ).toEqual(["file_path", "line", "body", "severity"]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getTicket: any = byName.get("get_ticket");
    expect(getTicket.inputSchema.properties.ticket_id.type).toBe("string");
  });
});

describe("tools/call → HTTP bridge", () => {
  it("POSTs to the kebab-case endpoint with bearer auth and returns data as text", async () => {
    nextResponse = {
      status: 200,
      body: { data: { ticket: { id: "T-1", status: "in_progress" } } },
    };

    const result = await client.callTool("get_ticket", {});

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({
      ticket: { id: "T-1", status: "in_progress" },
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]).toMatchObject({
      method: "POST",
      url: "/api/mcp/get-ticket",
      authorization: "Bearer test-token",
      contentType: "application/json",
      body: {},
    });
  });

  it("maps tool-name underscores to endpoint dashes and forwards args verbatim", async () => {
    nextResponse = {
      status: 200,
      body: { data: { ticketId: "T-1", fromStatus: "in_progress", toStatus: "review" } },
    };

    await client.callTool("update_ticket_status", {
      status: "review",
      reason: "Implementation complete",
    });

    expect(capturedRequests[0]).toMatchObject({
      url: "/api/mcp/update-ticket-status",
      body: { status: "review", reason: "Implementation complete" },
    });
  });

  it("maps a non-2xx {error, code} envelope to an isError tool result", async () => {
    nextResponse = {
      status: 409,
      body: {
        error: "Cannot move to Done: manual approval is required.",
        code: "INVALID_TRANSITION",
      },
    };

    const result = await client.callTool("update_ticket_status", {
      status: "done",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Error (INVALID_TRANSITION): Cannot move to Done: manual approval is required."
    );
  });

  it("falls back to the HTTP status when the error body has no code", async () => {
    nextResponse = { status: 500, body: { error: "boom" } };

    const result = await client.callTool("post_comment", { body: "hi" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error (500): boom");
  });

  it("rejects unknown tools without calling the backend", async () => {
    const result = await client.callTool("not_a_tool", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("UNKNOWN_TOOL");
    expect(capturedRequests).toHaveLength(0);
  });

  it("turns connection failures into isError results, not protocol crashes", async () => {
    const isolated = new McpStdioClient({
      ...process.env,
      ARIJ_BASE_URL: "http://127.0.0.1:9",
      ARIJ_MCP_TOKEN: "test-token",
    });
    try {
      await isolated.initialize();
      const result = await isolated.callTool("get_ticket", {});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^Error \(NETWORK\): /);

      // The shim survived: it still answers requests afterwards.
      const list = await isolated.request("tools/list", {});
      expect(list.tools).toHaveLength(5);
    } finally {
      isolated.kill();
    }
  }, 20000);
});
