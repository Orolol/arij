// @vitest-environment node
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("child_process", async (original) => ({ ...await original<typeof import("child_process")>(), spawn: mockSpawn }));

import { BundledPiProvider, buildPiMcpConfig } from "@/lib/providers/bundled-pi";
import type { McpSpawnConfig, ProviderSpawnOptions } from "@/lib/providers/types";

function options(token = "private-token"): ProviderSpawnOptions {
  return {
    sessionId: "pi-test", prompt: `- ${"prompt ".repeat(30000)}`, cwd: "/tmp", mode: "plan",
    mcp: {
      servers: [
        { name: "arij", command: process.execPath, args: ["/app/shim.mjs"], env: { ARIJ_MCP_TOKEN: token } },
        { name: "extra", url: "http://localhost:1234/mcp", headers: { Authorization: "secret-header" }, toolAllowlist: ["read"] },
      ],
      allowedToolNames: ["mcp__arij__get_ticket", "mcp__arij__post_comment"],
    },
  };
}
function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    kill: vi.fn(), exitCode: null, signalCode: null,
  });
}

describe("bundled Pi provider", () => {
  it("keeps inherited control-channel credentials out of the model process", () => {
    vi.stubEnv("ARIJ_MCP_TOKEN", "parent-token");
    vi.stubEnv("ARIJ_MCP_TOOLSET", "parent-tools");
    vi.stubEnv("ARIJ_BASE_URL", "http://parent-server");
    try {
      const env = new BundledPiProvider().buildEnv(options());
      expect(env.ARIJ_MCP_TOKEN).toBeUndefined();
      expect(env.ARIJ_MCP_TOOLSET).toBeUndefined();
      expect(env.ARIJ_BASE_URL).toBeUndefined();
      expect(process.env.ARIJ_MCP_TOKEN).toBe("parent-token");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("carries exactly the Arij toolset and each extra server allowlist", () => {
    const json = JSON.parse(buildPiMcpConfig(options().mcp));
    expect(json.mcpServers.arij.toolAllowlist).toEqual(["get_ticket", "post_comment"]);
    expect(json.mcpServers.extra.toolAllowlist).toEqual(["read"]);
    expect(json.mcpServers.extra.headers.Authorization).toBe("secret-header");
    expect(JSON.parse(buildPiMcpConfig(undefined))).toEqual({ mcpServers: {} });
    const empty: McpSpawnConfig = { servers: [{ name: "extra", command: "server", args: [], env: {}, toolAllowlist: [] }], allowedToolNames: [] };
    expect(JSON.parse(buildPiMcpConfig(empty)).mcpServers.extra.toolAllowlist).toEqual([]);
  });

  it("isolates configs and passes long prompts through stdin; cleans success and errors", async () => {
    const children = [fakeChild(), fakeChild()];
    mockSpawn.mockReset().mockReturnValueOnce(children[0]).mockReturnValueOnce(children[1]);
    const provider = new BundledPiProvider();
    const first = provider.spawn(options("token-one"));
    const second = provider.spawn(options("token-two"));
    const files = mockSpawn.mock.calls.map(([binary, args, spawnOptions], index) => {
      expect(binary).toBe(process.execPath);
      expect(args[0]).toMatch(/bin\/arij-pi\.mjs$/);
      expect(args.join(" ")).not.toContain("token-");
      expect(args).not.toContain(options().prompt);
      expect(spawnOptions.env.ARIJ_MCP_TOKEN).toBeUndefined();
      const file = args[args.indexOf("--mcp-config") + 1];
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(file, "utf8")).mcpServers.arij.env.ARIJ_MCP_TOKEN).toBe(index ? "token-two" : "token-one");
      expect(children[index].stdin.end).toHaveBeenCalledWith(options().prompt);
      return file;
    });
    expect(files[0]).not.toBe(files[1]);
    expect(first.command).not.toContain("token-one");
    children[0].stdout.emit("data", Buffer.from('{"type":"session","id":"real-id"}\n{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"stop"}}\n'));
    children[0].emit("close", 0);
    expect(await first.promise).toMatchObject({ success: true, result: "done", cliSessionId: "real-id" });
    expect(existsSync(files[0])).toBe(false);
    expect(existsSync(files[1])).toBe(true);
    children[1].emit("error", new Error("spawn failure"));
    expect((await second.promise).success).toBe(false);
    expect(existsSync(files[1])).toBe(false);
  });

  it.each(["plan", "chat", "analyze", "code"] as const)("restricts built-ins in %s while retaining MCP", (mode) => {
    const provider = new BundledPiProvider();
    const args = provider.buildArgs({ ...options(), mode, model: "anthropic/example", resumeSession: true, cliSessionId: "session-id", cliOptions: { thinking: "high" } });
    const tools = args[args.indexOf("--builtin-tools") + 1].split(",");
    expect(tools.includes("write")).toBe(mode === "code" || mode === "analyze");
    expect(tools.includes("bash")).toBe(mode === "code");
    expect(tools.includes("edit")).toBe(mode === "code");
    expect(args).toContain("--no-extensions");
    expect(args.slice(args.indexOf("--session"), args.indexOf("--session") + 2)).toEqual(["--session", "session-id"]);
    expect(args.slice(args.indexOf("--thinking"), args.indexOf("--thinking") + 2)).toEqual(["--thinking", "high"]);
  });
});
