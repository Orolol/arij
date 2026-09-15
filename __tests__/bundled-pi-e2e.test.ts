// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { BundledPiProvider } from "@/lib/providers/bundled-pi";
import type { ProviderSession, ProviderSpawnOptions } from "@/lib/providers/types";

it("runs bundled Pi through the real Arij MCP shim, resumes, and cancels cleanly", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "arij-pi-e2e-"));
  const agentDir = path.join(root, "agent");
  mkdirSync(agentDir);
  const sessions: ProviderSession[] = [];
  const toolsSeen: string[][] = [];
  const boardTokens: string[] = [];
  const prompts: string[] = [];
  let modelRequests = 0;
  const http = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body || "{}");
    if (req.url === "/api/mcp/get-ticket") {
      boardTokens.push(req.headers.authorization ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { id: "ticket-test", title: "MCP works" } }));
      return;
    }
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }
    modelRequests++;
    toolsSeen.push(payload.tools.map((tool: { function: { name: string } }) => tool.function.name));
    prompts.push(JSON.stringify(payload.messages));
    const last = payload.messages.at(-1);
    if (JSON.stringify(last?.content).includes("STALL_MODEL")) return;
    if (JSON.stringify(last?.content).includes("FAIL_MODEL")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "deliberate model failure" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const toolCall = last?.role !== "tool";
    const delta = toolCall
      ? { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "mcp__arij__get_ticket", arguments: "{}" } }] }
      : { role: "assistant", content: "Ticket received" };
    for (const [content, finish] of [[delta, null], [{}, toolCall ? "tool_calls" : "stop"]]) {
      res.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: content, finish_reason: finish }] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  try {
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: `${baseUrl}/v1`, api: "openai-completions", apiKey: "fake-key", models: [{ id: "test", name: "Test", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
    writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_OFFLINE", "1");
    vi.stubEnv("PI_TELEMETRY", "0");
    const provider = new BundledPiProvider();
    expect(await provider.isAvailable()).toBe(true);
    const options: ProviderSpawnOptions = {
      sessionId: "pi-integration", prompt: `- FIRST_PROMPT ${"long ".repeat(30000)}`, cwd: root, mode: "plan", model: "fixture/test",
      mcp: { servers: [{ name: "arij", command: process.execPath, args: [path.join(process.cwd(), "bin", "arij-mcp.mjs")], env: { ARIJ_BASE_URL: baseUrl, ARIJ_MCP_TOKEN: "one-session-token" } }], allowedToolNames: ["mcp__arij__get_ticket"] },
    };
    const run = (overrides: Partial<ProviderSpawnOptions> = {}) => {
      const session = provider.spawn({ ...options, ...overrides });
      sessions.push(session);
      return session;
    };
    const first = run();
    const result = await first.promise;
    expect(result, result.error).toMatchObject({ success: true, result: "Ticket received" });
    expect(result.cliSessionId).toBeTruthy();
    expect(toolsSeen[0].sort()).toEqual(["AskUserQuestion", "find", "grep", "ls", "mcp__arij__get_ticket", "read"]);
    expect(boardTokens).toEqual(["Bearer one-session-token"]);
    const configPath = /--mcp-config (\S+)/.exec(first.command!)![1];
    expect(existsSync(configPath)).toBe(false);
    const resumed = await run({ prompt: "SECOND_PROMPT", resumeSession: true, cliSessionId: result.cliSessionId }).promise;
    expect(resumed).toMatchObject({ success: true, cliSessionId: result.cliSessionId });
    expect(prompts.at(-1)).toContain("FIRST_PROMPT");
    const failure = await run({ prompt: "FAIL_MODEL" }).promise;
    expect(failure.success).toBe(false);
    const beforeStall = modelRequests;
    const stalled = run({ prompt: "STALL_MODEL" });
    await vi.waitFor(() => expect(modelRequests).toBeGreaterThan(beforeStall), { timeout: 30_000 });
    stalled.kill();
    expect(await stalled.promise).toMatchObject({ success: false, error: "Process was cancelled." });
    expect(existsSync(/--mcp-config (\S+)/.exec(stalled.command!)![1])).toBe(false);
  } finally {
    for (const session of sessions) session.kill();
    vi.unstubAllEnvs();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
