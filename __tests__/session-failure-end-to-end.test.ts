/**
 * The failure story end to end, in-process:
 *
 * a build session whose provider exits non-zero WITHOUT stderr and WITHOUT
 * any captured output — the exact "Agent error" report — must end with
 *   1. a session row carrying an explicit, human error message (the history
 *      stays legible afterwards, AC3),
 *   2. the project webhook fired with that same full message, not just a
 *      title (AC1), emitted by the terminal hook exactly the way
 *      instrumentation.ts composes it,
 *   3. an on-disk log record, so the Raw Logs tab is never empty (AC3).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import { eq } from "drizzle-orm";
import { agentSessions, projects } from "@/lib/db/schema";

const testDb = vi.hoisted(() => ({
  instance: null as ReturnType<typeof import("@/lib/db/test-utils").createTestDb> | null,
}));

vi.mock("@/lib/db", async () =>
  (await import("@/__tests__/helpers/db-mock")).liveDbModule(testDb),
);

vi.mock("@/lib/webhooks/send", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webhooks/send")>(
    "@/lib/webhooks/send"
  );
  return { ...actual, sendProjectWebhook: vi.fn(() => Promise.resolve()) };
});

// ---- Import the real modules AFTER the db mock is in place ----
import { markSessionCancelled, markSessionTerminal } from "@/lib/agent-sessions/lifecycle";
import { setSessionTerminalHook } from "@/lib/agent-sessions/terminal-hooks";
import { sendTerminalSessionWebhook } from "@/lib/agent-sessions/session-outcome-webhook";
import { sendProjectWebhook } from "@/lib/webhooks/send";

const tempDirs: string[] = [];

beforeEach(() => {
  vi.mocked(sendProjectWebhook).mockClear();
  testDb.instance = createTestDb();
  testDb.instance.db.insert(projects).values({ id: "p1", name: "My Project" }).run();
});

afterEach(() => {
  setSessionTerminalHook(null);
  testDb.instance = null;
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function seedRunningBuildSession(logsPath: string | null): string {
  const id = "sess-silent-failure";
  testDb.instance!.db
    .insert(agentSessions)
    .values({
      id,
      projectId: "p1",
      status: "running",
      agentType: "build",
      provider: "claude-code",
      prompt: "Build the epic",
      logsPath,
      startedAt: new Date().toISOString(),
    })
    .run();
  return id;
}

describe("silent agent failure — full story", () => {
  it("fails with an explicit message, webhooks it, and keeps a log", () => {
    const { db } = testDb.instance!;

    // The dispatch route's log write threw away because its result was
    // empty: simulate a logsPath whose file was never written.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-silent-fail-e2e-"));
    tempDirs.push(dir);
    const logsPath = path.join(dir, "logs.json");
    const sessionId = seedRunningBuildSession(logsPath);

    // instrumentation.ts composes exactly this hook at boot.
    setSessionTerminalHook(sendTerminalSessionWebhook);

    // The reported scenario: the provider exited non-zero with NO stderr
    // and the run captured no output at all.
    markSessionTerminal(
      sessionId,
      { success: false, error: null },
      new Date().toISOString()
    );

    // 1. The session history is legible afterwards: the row keeps an
    //    explicit error, never NULL, never a bare label.
    const row = db
      .select({ status: agentSessions.status, error: agentSessions.error })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get() as { status: string; error: string | null };
    expect(row.status).toBe("failed");
    expect(row.error).toBeTruthy();
    expect(row.error).toMatch(/failed without any error message and without any output/i);
    expect(row.error).toContain(logsPath);

    // 2. The terminal hook fired the project webhook with the SAME full
    //    message — the receiver explains the failure.
    expect(sendProjectWebhook).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        event: "session.failed",
        sessionId,
        error: row.error,
        path: `/projects/p1/sessions/${sessionId}`,
      })
    );

    // 3. Traceability: the session's log record exists even though nobody
    //    ever wrote it (the backstop filled it in at finalization).
    expect(fs.existsSync(logsPath)).toBe(true);
    const record = JSON.parse(fs.readFileSync(logsPath, "utf-8"));
    expect(record.success).toBe(false);
    expect(record.error).toBe(row.error);
  });

  it("sends the real stderr when the provider DID produce an error line", () => {
    const sessionId = seedRunningBuildSession(null);

    setSessionTerminalHook(sendTerminalSessionWebhook);

    markSessionTerminal(
      sessionId,
      { success: false, error: "Claude CLI exited with code 1: Invalid API key" },
      new Date().toISOString()
    );

    // A real error stays the payload — synthesis only fills the void.
    expect(sendProjectWebhook).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        event: "session.failed",
        error: "Claude CLI exited with code 1: Invalid API key",
      })
    );
  });

  it("stays silent for a cancelled session", () => {
    const sessionId = seedRunningBuildSession(null);

    setSessionTerminalHook(sendTerminalSessionWebhook);

    // User-initiated stop: terminal, but not an alarm.
    markSessionCancelled(sessionId);

    expect(sendProjectWebhook).not.toHaveBeenCalled();
  });
});
