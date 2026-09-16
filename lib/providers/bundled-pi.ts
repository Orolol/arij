import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { PiProvider } from "./pi";
import { STDIN_PAYLOAD_KEY, type ProviderSpawnContext, type ProviderExitInfo, type BaseProviderChunkCallbacks } from "./base-provider";
import type { StreamLogContext } from "@/lib/claude/logger";
import { piToolPolicy } from "./pi-policy";
import { piStreamEvent, extractPiUsage } from "./pi-events";
import { buildProviderOptionArgs } from "./options-registry";
import type { McpSpawnConfig, ProviderSpawnOptions } from "./types";

export function bundledPiLauncher(): string {
  return path.join(process.cwd(), "bin", "arij-pi.mjs");
}

/** Preserve per-server allowlists, including the narrower Arij chat toolset. */
export function buildPiMcpConfig(mcp: McpSpawnConfig | undefined): string {
  return JSON.stringify({
    mcpServers: Object.fromEntries((mcp?.servers ?? []).map((server) => {
      const { name, toolAllowlist, ...transport } = server;
      return [name, {
        ...transport,
        toolAllowlist: name === "arij"
          ? mcp!.allowedToolNames
              .filter((tool) => tool.startsWith("mcp__arij__"))
              .map((tool) => tool.slice("mcp__arij__".length))
          : toolAllowlist ?? undefined,
      }];
    })),
  });
}

/** The pinned fork shipped with Arij, always launched with Arij's Node runtime. */
export class BundledPiProvider extends PiProvider {
  readonly type = "pi" as const;

  get binaryName(): string { return process.execPath; }

  buildEnv(_options: ProviderSpawnOptions): NodeJS.ProcessEnv {
    const env = { ...process.env };
    // The control channel belongs only to the configured MCP child.
    delete env.ARIJ_MCP_TOKEN;
    delete env.ARIJ_MCP_TOOLSET;
    delete env.ARIJ_BASE_URL;
    delete env.ARIJ_PI_CHILD_DEPTH;
    return env;
  }

  async isAvailable(): Promise<boolean> {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 19) || !existsSync(bundledPiLauncher())) return false;
    try {
      const entry = createRequire(path.join(process.cwd(), "package.json")).resolve("@arij/pi");
      return existsSync(path.join(path.dirname(entry), "cli.js"));
    } catch {
      return false;
    }
  }

  protected preflight(): string | undefined {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 19)) {
      return "Arij's bundled Pi requires Node.js >=22.19. Restart Arij with a supported Node.js version.";
    }
  }

  prepareSpawn(options: ProviderSpawnOptions): ProviderSpawnContext {
    const configDir = mkdtempSync(path.join(tmpdir(), "arij-pi-"));
    try {
      const configPath = path.join(configDir, "mcp.json");
      writeFileSync(configPath, JSON.stringify({ ...JSON.parse(buildPiMcpConfig(options.mcp)), arij: piToolPolicy(options) }), { mode: 0o600 });
      return { configDir, configPath, [STDIN_PAYLOAD_KEY]: options.prompt };
    } catch (error) {
      rmSync(configDir, { recursive: true, force: true });
      throw error;
    }
  }

  cleanupSpawnContext(context?: ProviderSpawnContext): void {
    if (typeof context?.configDir === "string") {
      rmSync(context.configDir, { recursive: true, force: true });
    }
  }

  buildArgs(options: ProviderSpawnOptions, context?: ProviderSpawnContext): string[] {
    const tools = piToolPolicy(options).builtinTools;
    const args = [bundledPiLauncher(), "--mode", "json", "--no-extensions", "--builtin-tools", tools.join(",")];
    if (typeof context?.configPath === "string") {
      // Start with no built-ins; the trusted runtime activates the exact policy
      // plus Task/questions. --builtin-tools filters custom tools out of Pi's
      // registry, so it cannot be used together with those runtime tools.
      args.splice(args.indexOf("--builtin-tools"), 2, "--no-builtin-tools");
      args.push("--mcp-config", context.configPath,
        "--extension", path.join(process.cwd(), "bin", "arij-pi-runtime.mjs"), "--arij-config", context.configPath);
    }
    if (options.resumeSession && options.cliSessionId) args.push("--session", options.cliSessionId);
    if (options.model) args.push("--model", options.model);
    args.push(...buildProviderOptionArgs(this.type, options.cliOptions, { resume: !!options.resumeSession }));
    // Stdin carries every prompt: no argv size cap or @file/leading-dash interpretation.
    args.push("-p");
    return args;
  }

  buildDisplayCommand(args: string[]): string {
    return `arij pi ${args.slice(1).join(" ")} <prompt via stdin>`;
  }

  protected notAuthenticatedMessage(): string {
    return "Pi is not authenticated. Run `arij pi` and use /login, or configure a provider API key.";
  }

  buildChunkCallbacks(options: ProviderSpawnOptions): BaseProviderChunkCallbacks {
    const base = super.buildChunkCallbacks(options);
    let pending = "";
    let streamed = false;
    let index = 0;
    return {
      ...base,
      onRawChunk: (chunk) => {
        base.onRawChunk?.(chunk);
        if (chunk.source !== "stdout") return;
        pending += chunk.text;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          let event;
          try { event = piStreamEvent(JSON.parse(line)); } catch { continue; }
          if (!event) continue;
          options.onEvent?.(event);
          if (event.type === "text") {
            streamed = true;
            options.onChunk?.({ streamType: "response", text: event.text, chunkKey: `delta:${++index}`, emittedAt: chunk.emittedAt });
          }
        }
      },
      onResponseChunk: (chunk) => { if (!streamed) base.onResponseChunk?.(chunk); },
    };
  }

  protected handleExit(info: ProviderExitInfo, callbacks: BaseProviderChunkCallbacks, log: StreamLogContext | null) {
    return { ...super.handleExit(info, callbacks, log), usage: extractPiUsage(info.stdout) };
  }

  detectEndedWithQuestion(stdout: string): boolean {
    // Do not classify a user prompt merely mentioning AskUserQuestion as a call.
    return stdout.split("\n").some((line) => {
      try { return piStreamEvent(JSON.parse(line))?.type === "questions"; } catch { return false; }
    });
  }

  protected buildSpawnErrorMessage(error: Error): string {
    return `Unable to start Arij's bundled Pi: ${error.message}`;
  }
}
