/**
 * Availability probes run inside request handlers (GET /api/providers/
 * available, the default chat mode, reviewer segregation). They used to be
 * `execSync` calls — `which`, `codex login status`, up to a five-second
 * timeout when a CLI hung — and every concurrent request and SSE stream
 * stalled for their duration. These tests pin the asynchronous shape: the
 * probe goes through `execFile` with a timeout, and a failure answers "no"
 * without throwing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));

vi.mock("child_process", () => ({
  spawn: vi.fn(),
  execFile: mockExecFile,
  execSync: () => {
    throw new Error("execSync must not be used by availability probes");
  },
  default: { spawn: vi.fn(), execFile: mockExecFile },
}));

import {
  PROVIDER_PROBE_TIMEOUT_MS,
  runProbe,
} from "@/lib/providers/base-provider";
import { AgyProvider } from "@/lib/providers/agy";
import { CodexProvider } from "@/lib/providers/codex";

type Callback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

function answer(
  table: Record<string, { error?: Error; stdout?: string; stderr?: string }>,
) {
  mockExecFile.mockImplementation(
    (file: string, args: string[], _opts: unknown, cb: Callback) => {
      const key = [file, ...args].join(" ");
      const entry = table[key];
      if (!entry) {
        cb(new Error(`unexpected probe: ${key}`), "", "");
        return;
      }
      cb(entry.error ?? null, entry.stdout ?? "", entry.stderr ?? "");
    },
  );
}

describe("runProbe", () => {
  // Braces on purpose: a hook that RETURNS the mock hands vitest a "cleanup
  // function" it then calls with no arguments.
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("returns the combined output and passes a timeout", async () => {
    answer({ "which codex": { stdout: "/usr/bin/codex\n" } });
    await expect(runProbe("which", ["codex"])).resolves.toBe("/usr/bin/codex\n");
    expect(mockExecFile.mock.calls[0][2]).toMatchObject({
      timeout: PROVIDER_PROBE_TIMEOUT_MS,
    });
  });

  it("answers null on a non-zero exit instead of throwing", async () => {
    answer({ "which nope": { error: new Error("exit 1") } });
    await expect(runProbe("which", ["nope"])).resolves.toBeNull();
  });

  it("answers null when execFile itself throws synchronously", async () => {
    mockExecFile.mockImplementation(() => {
      throw new Error("EAGAIN");
    });
    await expect(runProbe("which", ["codex"])).resolves.toBeNull();
  });
});

describe("provider isAvailable", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("is a `which` probe for a plain CLI provider", async () => {
    answer({ "which agy": { stdout: "/usr/local/bin/agy\n" } });
    await expect(new AgyProvider().isAvailable()).resolves.toBe(true);
    answer({ "which agy": { error: new Error("exit 1") } });
    await expect(new AgyProvider().isAvailable()).resolves.toBe(false);
  });

  it("requires codex to be both installed and logged in, reading stderr", async () => {
    answer({
      "which codex": { stdout: "/usr/bin/codex\n" },
      "codex login status": { stderr: "Logged in using ChatGPT\n" },
    });
    await expect(new CodexProvider().isAvailable()).resolves.toBe(true);

    answer({
      "which codex": { stdout: "/usr/bin/codex\n" },
      "codex login status": { stderr: "Not logged in\n" },
    });
    await expect(new CodexProvider().isAvailable()).resolves.toBe(false);

    mockExecFile.mockClear();
    answer({ "which codex": { error: new Error("exit 1") } });
    await expect(new CodexProvider().isAvailable()).resolves.toBe(false);
    // Not installed: the login probe is never attempted.
    expect(
      mockExecFile.mock.calls.filter((c) => c[0] === "codex"),
    ).toHaveLength(0);
  });
});
