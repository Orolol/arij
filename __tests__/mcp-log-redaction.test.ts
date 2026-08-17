/**
 * The NDJSON session log must never contain a per-session Arij MCP bearer
 * token.
 *
 * `createStreamLog(identifier, cliArgs, prompt)` writes the full argv into the
 * log header, and the codex spawn path has no choice but to carry the token in
 * argv (`-c mcp_servers.arij.env={…}` — codex's `-c` mechanism has no file
 * form). The log file is durable and world-readable, so the mask is applied at
 * this boundary: `redactMcpToken` runs inside `createStreamLog`, which is the
 * single point every provider's logging funnels through.
 *
 * The claude path now passes a file path instead of inline JSON, but the
 * inline shape is still asserted here as a regression net — the redaction must
 * not silently stop covering it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("fs", () => ({ ...fsMock, default: fsMock }));

import {
  createStreamLog,
  redactMcpToken,
  MCP_TOKEN_MASK,
} from "@/lib/claude/logger";

const TOKEN = "arij-mcp-Ab3xQ9zK1mNp7RtV2wYs";

/** A realistic codex argv with MCP injection, as built by CodexProvider. */
const CODEX_ARGV = [
  "codex",
  "exec",
  "--dangerously-bypass-approvals-and-sandbox",
  "-C",
  "/work",
  "--skip-git-repo-check",
  "-o",
  "/tmp/codex-out-1.txt",
  "--color",
  "never",
  "-c",
  'developer_instructions="be terse"',
  "-c",
  'mcp_servers.arij.command="/usr/bin/node"',
  "-c",
  'mcp_servers.arij.args=["/app/bin/arij-mcp.mjs"]',
  "-c",
  `mcp_servers.arij.env={ARIJ_BASE_URL="http://localhost:3000",ARIJ_MCP_TOKEN="${TOKEN}"}`,
  "PROMPT TEXT",
];

/** The legacy claude inline-JSON shape (now replaced by a file path). */
const CLAUDE_INLINE_ARGV = [
  "claude",
  "--permission-mode",
  "bypassPermissions",
  "--mcp-config",
  JSON.stringify({
    mcpServers: {
      arij: {
        type: "stdio",
        command: "/usr/bin/node",
        args: ["/app/bin/arij-mcp.mjs"],
        env: {
          ARIJ_BASE_URL: "http://localhost:3000",
          ARIJ_MCP_TOKEN: TOKEN,
        },
      },
    },
  }),
  "--strict-mcp-config",
];

function headerFromLastWrite(): Record<string, unknown> {
  const [, contents] = fsMock.writeFileSync.mock.calls.at(-1)!;
  return JSON.parse(String(contents).trim());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("redactMcpToken", () => {
  it("masks the token inside a codex -c mcp_servers env override", () => {
    const redacted = redactMcpToken(CODEX_ARGV);

    expect(redacted.join(" ")).not.toContain(TOKEN);
    expect(redacted).toContain(
      `mcp_servers.arij.env={ARIJ_BASE_URL="http://localhost:3000",ARIJ_MCP_TOKEN="${MCP_TOKEN_MASK}"}`,
    );
    // the surrounding argv is untouched — the log stays useful
    expect(redacted.filter((_, i) => i !== CODEX_ARGV.length - 2)).toEqual(
      CODEX_ARGV.filter((_, i) => i !== CODEX_ARGV.length - 2),
    );
  });

  it("masks the token inside claude inline --mcp-config JSON", () => {
    const redacted = redactMcpToken(CLAUDE_INLINE_ARGV);

    expect(redacted.join(" ")).not.toContain(TOKEN);
    const parsed = JSON.parse(redacted[redacted.indexOf("--mcp-config") + 1]);
    expect(parsed.mcpServers.arij.env.ARIJ_MCP_TOKEN).toBe(MCP_TOKEN_MASK);
    // the non-secret parts of the config survive
    expect(parsed.mcpServers.arij.env.ARIJ_BASE_URL).toBe("http://localhost:3000");
    expect(parsed.mcpServers.arij.args).toEqual(["/app/bin/arij-mcp.mjs"]);
  });

  it("masks a bare token literal wherever it appears", () => {
    expect(redactMcpToken([TOKEN, `Bearer ${TOKEN}`, `ARIJ_MCP_TOKEN=${TOKEN}`])).toEqual([
      MCP_TOKEN_MASK,
      `Bearer ${MCP_TOKEN_MASK}`,
      `ARIJ_MCP_TOKEN=${MCP_TOKEN_MASK}`,
    ]);
  });

  it("is idempotent — masking twice does not corrupt the mask", () => {
    const once = redactMcpToken(CODEX_ARGV);
    expect(redactMcpToken(once)).toEqual(once);
  });

  it("leaves token-free argv byte-identical", () => {
    const plain = ["claude", "--permission-mode", "plan", "--print", "-p", "hi"];
    expect(redactMcpToken(plain)).toEqual(plain);
  });
});

describe("createStreamLog — masks at the logging boundary", () => {
  it("writes a codex argv header with the token masked", () => {
    createStreamLog("codex-session-1", CODEX_ARGV, "PROMPT TEXT");

    const header = headerFromLastWrite();
    expect(header._type).toBe("session_start");
    expect(JSON.stringify(header)).not.toContain(TOKEN);
    expect(header.cliArgs).toContain(
      `mcp_servers.arij.env={ARIJ_BASE_URL="http://localhost:3000",ARIJ_MCP_TOKEN="${MCP_TOKEN_MASK}"}`,
    );
  });

  it("writes a claude inline-JSON argv header with the token masked", () => {
    createStreamLog("claude-session-1", CLAUDE_INLINE_ARGV, "PROMPT");

    expect(JSON.stringify(headerFromLastWrite())).not.toContain(TOKEN);
  });

  it("does not mutate the caller's argv array", () => {
    const argv = [...CODEX_ARGV];
    createStreamLog("codex-session-2", argv, "PROMPT");
    expect(argv).toEqual(CODEX_ARGV);
  });
});
