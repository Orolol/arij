// @vitest-environment node
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { BundledPiProvider } from "@/lib/providers/bundled-pi";
import type { ProviderSession } from "@/lib/providers/types";
import type { StreamChunk } from "@/lib/claude/spawn";

const { channel } = vi.hoisted(() => ({ channel: vi.fn(() => null) }));
vi.mock("@/lib/chat/cli-tool-channel", () => ({ createChatCliToolChannel: channel }));
import { runPersistentChatTurn, resetPersistentChatRunnerForTests, getPersistentChatSessionState, restartPersistentChatSession } from "@/lib/chat/persistent-runner";

it("executes Task, accounts for child usage, reads images, asks questions and reuses a real Pi RPC process", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "arij-pi-parity-"));
  const agentDir = path.join(root, "agent");
  const worktree = path.join(root, "worktree");
  mkdirSync(agentDir);
  mkdirSync(worktree);
  const picture = path.join(root, "pixel.png");
  writeFileSync(picture, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8AAP///0EdNBEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gEOADM5Ddoh/wAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wMS0xNFQwMDo1MTo1NyswMDowMOnKzHgAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDEtMTRUMDA6NTE6NTcrMDA6MDCYl3TEAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTAxLTE0VDAwOjUxOjU3KzAwOjAwz4JVGwAAAABJRU5ErkJggg==", "base64"));
  const sessions: ProviderSession[] = [];
  const rawChunks: string[] = [];
  const requests: Array<{ marker: string; tools: string[]; messages: string }> = [];
  const questions = [{ question: "Continue?", header: "Next", options: [{ label: "Yes", description: "Proceed" }], multiSelect: false }];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    const messages = payload.messages as Array<{ role: string; content: unknown }>;
    const text = (content: unknown): string => typeof content === "string" ? content : Array.isArray(content) ? content.map((item) => item.text ?? "").join("") : "";
    let index = -1;
    for (let i = 0; i < messages.length; i++) if (messages[i].role === "user" && /^(PARENT|CHILD|IMAGE|ASK|WARM|STALL)/.test(text(messages[i].content))) index = i;
    const marker = index < 0 ? "UNKNOWN" : text(messages[index].content);
    const afterTool = messages.slice(index + 1).some((message) => message.role === "tool");
    const tools = (payload.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name);
    requests.push({ marker, tools, messages: JSON.stringify(messages) });
    if (marker.startsWith("STALL")) return;
    const taskFailure = marker.startsWith("CHILD_FAIL") || marker.startsWith("WARM_FAIL");
    if (taskFailure) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "child deliberately failed" } }));
      return;
    }
    let call: { name: string; arguments: string } | undefined;
    if (!afterTool) {
      if (marker.startsWith("PARENT")) call = { name: "Task", arguments: JSON.stringify({ description: "Child job", prompt: marker.includes("FAIL") ? "CHILD_FAIL" : "CHILD_WRITE", cwd: worktree }) };
      else if (marker.startsWith("CHILD_WRITE")) call = { name: "write", arguments: JSON.stringify({ path: "proof.txt", content: "written by Pi child" }) };
      else if (marker.startsWith("IMAGE")) call = { name: "read", arguments: JSON.stringify({ path: picture }) };
      else if (marker.startsWith("ASK")) call = { name: "AskUserQuestion", arguments: JSON.stringify({ questions }) };
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: call }] } : { role: "assistant", content: `Done ${marker}` };
    for (const [chunk, finish] of [[delta, null], [{}, call ? "tool_calls" : "stop"]]) {
      res.write(`data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: chunk, finish_reason: finish }] })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "fake", models: [{ id: "test", name: "Test", reasoning: false, input: ["text", "image"], contextWindow: 200000, maxTokens: 1024, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] } } }));
    writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_OFFLINE", "1");
    vi.stubEnv("PI_TELEMETRY", "0");
    const provider = new BundledPiProvider();
    const run = (prompt: string, mode: "plan" | "code" = "plan", onEvent?: (event: StreamChunk) => void) => {
      const session = provider.spawn({ sessionId: `test-${sessions.length}`, prompt, mode, cwd: root, model: "fixture/test", onEvent,
        onChunk: (chunk) => { if (chunk.streamType === "raw") rawChunks.push(chunk.text); },
      });
      sessions.push(session);
      return session;
    };
    const team = run("PARENT_WRITE", "code");
    const result = await team.promise;
    expect(result, result.error).toMatchObject({ success: true, result: "Done PARENT_WRITE" });
    expect(readFileSync(path.join(worktree, "proof.txt"), "utf8")).toBe("written by Pi child");
    expect(requests.find((request) => request.marker === "CHILD_WRITE")?.tools).not.toContain("Task");
    expect(result.usage?.inputTokens).toBe(400);
    expect(result.usage?.outputTokens).toBe(80);
    expect(result.usage!.totalCostUsd).toBeGreaterThan(0);
    const failure = await run("PARENT_FAIL", "code").promise;
    expect(failure.success).toBe(true); // The coordinator receives a failed tool result and can recover.
    expect(requests.filter((r) => r.marker === "PARENT_FAIL").at(-1)?.messages).toContain("Task failed:");
    const taskEvents = rawChunks.join("").split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    expect(taskEvents).toContainEqual(expect.objectContaining({ type: "tool_execution_end", toolName: "Task", isError: true }));
    const imageResult = await run("IMAGE_READ").promise;
    expect(imageResult, imageResult.error).toMatchObject({ success: true });
    expect(requests.filter((r) => r.marker === "IMAGE_READ").at(-1)?.messages).toContain("data:image/png;base64,");
    const events: StreamChunk[] = [];
    const questionResult = await run("ASK_ONESHOT", "plan", (event) => events.push(event)).promise;
    expect(questionResult).toMatchObject({ success: true, endedWithQuestion: true });
    expect(events).toContainEqual({ type: "questions", questions });

    const chunks: StreamChunk[] = [];
    const ids: string[] = [];
    const persistent = { conversationId: "pi-rpc-test", projectId: "fixture", provider: "pi-persistent" as const, cwd: root, mode: "chat" as const, model: "fixture/test", conversationType: "chat", onChunk: (chunk: StreamChunk) => chunks.push(chunk), onCliSessionId: (id: string) => ids.push(id) };
    const first = runPersistentChatTurn({ ...persistent, prompt: "WARM_FIRST" });
    expect(first.wasWarm).toBe(false);
    await first.promise;
    expect(chunks).toContainEqual({ type: "text", text: "Done WARM_FIRST" });
    expect(ids[0]).toBeTruthy();
    expect(getPersistentChatSessionState("pi-rpc-test")).toBe("hot");
    const second = runPersistentChatTurn({ ...persistent, prompt: "ASK_RPC" });
    expect(second.wasWarm).toBe(true);
    await second.promise;
    expect(chunks).toContainEqual({ type: "questions", questions });
    expect(requests.filter((r) => r.marker === "ASK_RPC")[0].messages).toContain("WARM_FIRST");
    const modelFailure = runPersistentChatTurn({ ...persistent, prompt: "WARM_FAIL" });
    await expect(modelFailure.promise).rejects.toThrow();
    const recovered = runPersistentChatTurn({ ...persistent, prompt: "WARM_RECOVERED" });
    expect(recovered.wasWarm).toBe(true);
    await recovered.promise;
    expect(chunks).toContainEqual({ type: "text", text: "Done WARM_RECOVERED" });
    restartPersistentChatSession("pi-rpc-test");
    const cold = runPersistentChatTurn({ ...persistent, cwd: worktree, prompt: "WARM_RESUMED", cliSessionId: ids[0], resumeSession: true });
    await cold.promise;
    expect(cold.wasWarm).toBe(false);
    expect(ids.at(-1)).toBe(ids[0]);
    expect(requests.filter((r) => r.marker === "WARM_RESUMED")[0].messages).toContain("WARM_FIRST");
    const stalled = runPersistentChatTurn({ ...persistent, prompt: "STALL_CANCEL" });
    await vi.waitFor(() => expect(requests.some((r) => r.marker === "STALL_CANCEL")).toBe(true), { timeout: 30_000 });
    stalled.kill();
    await expect(stalled.promise).rejects.toThrow("stopped");
    expect(getPersistentChatSessionState("pi-rpc-test")).toBe("cold");
    expect(sessions.every((session) => !existsSync(/--mcp-config (\S+)/.exec(session.command!)![1]))).toBe(true);
  } finally {
    for (const session of sessions) session.kill();
    resetPersistentChatRunnerForTests();
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
