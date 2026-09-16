// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
import runtime from "../bin/arij-pi-runtime.mjs";

const roots = [];
const argv = [...process.argv];
afterEach(() => {
  process.argv = [...argv];
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(depth = "0") {
  const root = mkdtempSync(path.join(tmpdir(), "arij-pi-runtime-test-"));
  roots.push(root);
  const file = path.join(root, "config.json");
  writeFileSync(file, JSON.stringify({ mcpServers: {}, arij: { builtinTools: ["read", "write"], delegation: true, questions: true } }));
  process.argv = [process.execPath, "pi", "--arij-config", file];
  vi.stubEnv("ARIJ_PI_CHILD_DEPTH", depth);
  const tools = new Map();
  const events = new Map();
  const pi = {
    registerFlag: vi.fn(), registerTool: (tool) => tools.set(tool.name, tool),
    on: (name, fn) => events.set(name, fn),
    getActiveTools: () => ["read", "bash", "mcp__extra__query"],
    setActiveTools: vi.fn(), getThinkingLevel: () => "high",
  };
  runtime(pi);
  return { root, tools, events, pi };
}

function child() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stdout.setEncoding = vi.fn();
  process.stderr = new EventEmitter();
  process.stderr.setEncoding = vi.fn();
  process.stdin = new EventEmitter();
  process.stdin.end = vi.fn();
  process.kill = vi.fn(() => { queueMicrotask(() => process.emit("close", 143)); });
  return process;
}

it("activates only the policy tools and rejects unauthorized tool calls", () => {
  const { pi, events, tools } = setup();
  events.get("session_start")();
  expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "write", "AskUserQuestion", "Task", "mcp__extra__query"]);
  expect(events.get("tool_call")({ toolName: "bash" })).toMatchObject({ block: true });
  expect(events.get("tool_call")({ toolName: "read" })).toBeUndefined();
  expect(tools.has("AskUserQuestion")).toBe(true);
  expect(events.get("tool_result")({ toolName: "Task", details: { failed: true } })).toEqual({ isError: true });
});

it("removes delegation entirely from child agents", () => {
  const { tools, events } = setup("1");
  expect(tools.has("Task")).toBe(false);
  expect(events.get("tool_call")({ toolName: "Task" })).toMatchObject({ block: true });
});

it("caps concurrent children, inherits policy, pipes large prompts and cancels active children", async () => {
  const { root, tools } = setup();
  const children = [];
  spawn.mockImplementation(() => { const c = child(); children.push(c); return c; });
  const controller = new AbortController();
  const prompt = "- " + "instruction ".repeat(20000);
  const execute = () => tools.get("Task").execute("call", { prompt, description: "test", cwd: root }, controller.signal, undefined, { cwd: root, model: { provider: "fixture", id: "test" } });
  const pending = Array.from({ length: 4 }, execute);
  await expect(execute()).rejects.toThrow("Four Pi sub-agents");
  expect(spawn).toHaveBeenCalledTimes(4);
  const [, args, options] = spawn.mock.calls[0];
  expect(args).not.toContain(prompt);
  expect(args).toContain("--no-builtin-tools");
  expect(options.env.ARIJ_PI_CHILD_DEPTH).toBe("1");
  expect(options.cwd).toBe(root);
  expect(options.detached).toBeUndefined();
  expect(children[0].stdin.end).toHaveBeenCalledWith(prompt);
  controller.abort();
  const results = await Promise.all(pending);
  expect(children.every((c) => c.kill.mock.calls[0][0] === "SIGTERM")).toBe(true);
  expect(results.every((result) => result.details.failed)).toBe(true);
  await expect(execute()).rejects.toThrow("cancelled");
});
