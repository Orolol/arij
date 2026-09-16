/**
 * Codex has no read-only posture: the one flag that opens its MCP approval
 * gate also drops the sandbox, so a "plan" spawn has full write access to its
 * cwd. The documented containment is the disposable per-ticket worktree —
 * and before this gate five request paths and six background dispatches
 * spawned codex in plan mode on the main checkout (or on Arij's own repo).
 *
 * These tests pin the enforcement: a restricted mode outside `.arij-worktrees`
 * is refused before any process starts, a restricted mode inside one runs,
 * and code mode is untouched everywhere.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import path from "path";
import fs from "node:fs";
import os from "node:os";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock("child_process", () => ({
  spawn: mockSpawn,
  execFile: vi.fn(),
  default: { spawn: mockSpawn, execFile: vi.fn() },
}));

import { CodexProvider } from "@/lib/providers/codex";
import {
  ARIJ_WORKTREES_DIR_NAME,
  isDisposableWorktreePath,
  isRestrictedMode,
  unsandboxedSpawnBlockReason,
} from "@/lib/providers/spawn-containment";
import type { ProviderSpawnOptions } from "@/lib/providers/types";

type Listener = (...args: unknown[]) => void;

function createFakeChild() {
  const listeners = new Map<string, Listener[]>();
  return {
    pid: 4242,
    exitCode: null as number | null,
    signalCode: null as string | null,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { on: vi.fn(), end: vi.fn() },
    on: (event: string, fn: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    kill: vi.fn(),
  };
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "arij-containment-"));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));
const WORKTREE_CWD = path.join(
  scratch,
  ARIJ_WORKTREES_DIR_NAME,
  "feature-epic-abc-do-the-thing",
);
fs.mkdirSync(path.join(WORKTREE_CWD, "packages", "web"), { recursive: true });
const MAIN_CLONE_CWD = path.join(scratch, "owner-repo");
fs.mkdirSync(MAIN_CLONE_CWD);
/** What lib/chat/title-generation.ts used to pass: Arij's own checkout. */
const ARIJ_SERVER_CWD = "/home/user/workspace/arij";

function options(overrides: Partial<ProviderSpawnOptions>): ProviderSpawnOptions {
  return {
    sessionId: "s-1",
    prompt: "Summarise the repository",
    cwd: MAIN_CLONE_CWD,
    mode: "plan",
    ...overrides,
  };
}

describe("spawn containment", () => {
  it("recognises an Arij worktree by its parent directory, wherever it sits", () => {
    expect(isDisposableWorktreePath(WORKTREE_CWD)).toBe(true);
    expect(isDisposableWorktreePath(`${WORKTREE_CWD}/packages/web`)).toBe(true);
    expect(isDisposableWorktreePath(MAIN_CLONE_CWD)).toBe(false);
    expect(isDisposableWorktreePath(ARIJ_SERVER_CWD)).toBe(false);
    // A look-alike segment does not count: only the exact directory name.
    expect(isDisposableWorktreePath("/home/user/.arij-worktrees-backup/x")).toBe(false);
    expect(isDisposableWorktreePath(undefined)).toBe(false);
    expect(isDisposableWorktreePath("")).toBe(false);
  });

  it("rejects the worktree container itself and symlinks into the main checkout", () => {
    const root = path.dirname(WORKTREE_CWD);
    fs.symlinkSync(MAIN_CLONE_CWD, path.join(root, "escape"));
    expect(isDisposableWorktreePath(root)).toBe(false);
    expect(isDisposableWorktreePath(path.join(root, "escape"))).toBe(false);
  });

  it("treats plan, chat and analyze as restricted and code as unrestricted", () => {
    expect(isRestrictedMode("plan")).toBe(true);
    expect(isRestrictedMode("chat")).toBe(true);
    expect(isRestrictedMode("analyze")).toBe(true);
    expect(isRestrictedMode("code")).toBe(false);
  });

  it("blocks a restricted mode outside a worktree and names the alternatives", () => {
    const reason = unsandboxedSpawnBlockReason("Codex", {
      mode: "plan",
      cwd: MAIN_CLONE_CWD,
    });
    expect(reason).toContain(MAIN_CLONE_CWD);
    expect(reason).toContain('"plan"');
    expect(reason).toMatch(/claude-code, oh-my-pi or agy/);
    expect(
      unsandboxedSpawnBlockReason("Codex", { mode: "plan", cwd: WORKTREE_CWD }),
    ).toBeNull();
    expect(
      unsandboxedSpawnBlockReason("Codex", { mode: "code", cwd: MAIN_CLONE_CWD }),
    ).toBeNull();
  });
});

describe("CodexProvider preflight", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("refuses a plan spawn on the main clone before any process starts", async () => {
    const provider = new CodexProvider();
    const session = provider.spawn(options({ mode: "plan" }));
    const result = await session.promise;

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot run a "plan" session/);
    expect(result.error).toContain(MAIN_CLONE_CWD);
  });

  it.each(["chat", "analyze"] as const)(
    "refuses a %s spawn outside a worktree too",
    async (mode) => {
      const result = await new CodexProvider().spawn(options({ mode })).promise;
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain(`"${mode}"`);
    },
  );

  it("refuses a plan spawn whose cwd is the server's own directory", async () => {
    // lib/chat/title-generation.ts used to pass process.cwd(): Arij's repo.
    const result = await new CodexProvider()
      .spawn(options({ mode: "plan", cwd: ARIJ_SERVER_CWD }))
      .promise;
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("lets a plan spawn run inside a disposable worktree", () => {
    mockSpawn.mockImplementation(() => createFakeChild());
    const session = new CodexProvider().spawn(
      options({ mode: "plan", cwd: WORKTREE_CWD }),
    );
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0][0]).toBe("codex");
    expect(mockSpawn.mock.calls[0][2]).toMatchObject({ cwd: WORKTREE_CWD });
    session.kill();
  });

  it("lets a code spawn run anywhere — it restricts nothing and claims nothing", () => {
    mockSpawn.mockImplementation(() => createFakeChild());
    const session = new CodexProvider().spawn(
      options({ mode: "code", cwd: MAIN_CLONE_CWD }),
    );
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    session.kill();
  });
});
