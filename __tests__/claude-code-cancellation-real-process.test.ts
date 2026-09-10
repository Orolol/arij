import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createChildKiller, isChildAlive } from "@/lib/providers/process-signals";

describe("claude-code cancellation real process integration", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("terminates a TERM-ignoring process and its descendant via process group SIGKILL escalation", async () => {
    const worktree = fs.mkdtempSync(
      path.join(os.tmpdir(), "arij-cancel-test-")
    );
    tempDirs.push(worktree);

    const outputFile = path.join(worktree, "activity.log");
    const descendantScript = path.join(worktree, "descendant.js");
    const workerScript = path.join(worktree, "worker.js");

    // Descendant process ignores SIGTERM and writes to outputFile every 30ms
    fs.writeFileSync(
      descendantScript,
      `
      process.on('SIGTERM', () => {});
      const fs = require('fs');
      setInterval(() => {
        fs.appendFileSync(${JSON.stringify(outputFile)}, "descendant write\\n");
      }, 30);
      `
    );

    // Worker process spawns descendant and also ignores SIGTERM
    fs.writeFileSync(
      workerScript,
      `
      process.on('SIGTERM', () => {});
      const { spawn } = require('child_process');
      const child = spawn(process.execPath, [${JSON.stringify(descendantScript)}], {
        stdio: 'inherit'
      });
      setInterval(() => {}, 1000);
      `
    );

    const child = spawn(process.execPath, [workerScript], {
      detached: true,
      cwd: worktree,
      stdio: "ignore",
    });

    expect(child.pid).toBeDefined();
    expect(isChildAlive(child)).toBe(true);

    // Wait until descendant is actively writing
    let writes = 0;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 40));
      if (fs.existsSync(outputFile)) {
        const lines = fs.readFileSync(outputFile, "utf-8").trim().split("\n");
        if (lines.length >= 2) {
          writes = lines.length;
          break;
        }
      }
    }
    expect(writes).toBeGreaterThanOrEqual(2);

    // Create child killer with 200ms grace period for escalation to SIGKILL
    const killer = createChildKiller(() => child, 200);

    const closePromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.on("close", (code, signal) => {
        resolve({ code, signal });
      });
    });

    // Initiate cancellation
    killer.kill();

    // The child and its process group ignore SIGTERM, so they must be killed by SIGKILL
    const exitResult = await closePromise;
    expect(exitResult.signal).toBe("SIGKILL");
    expect(isChildAlive(child)).toBe(false);

    // Wait 150ms to ensure descendant has settled
    await new Promise((r) => setTimeout(r, 150));
    const linesAfterKill = fs.readFileSync(outputFile, "utf-8").trim().split("\n").length;

    // Wait another 150ms to verify no orphaned descendant is still writing
    await new Promise((r) => setTimeout(r, 150));
    const linesLater = fs.readFileSync(outputFile, "utf-8").trim().split("\n").length;

    expect(linesLater).toBe(linesAfterKill);

    // Demonstrate next dispatch in the same worktree can proceed safely
    fs.writeFileSync(outputFile, "dispatch-2: fresh build write\n");
    await new Promise((r) => setTimeout(r, 150));

    const finalContent = fs.readFileSync(outputFile, "utf-8");
    expect(finalContent).toBe("dispatch-2: fresh build write\n");
  });

  it("clears the escalation timer if the process exits normally before grace period", async () => {
    const worktree = fs.mkdtempSync(
      path.join(os.tmpdir(), "arij-normal-test-")
    );
    tempDirs.push(worktree);

    // Script that exits cleanly after 50ms
    const script = path.join(worktree, "quick.js");
    fs.writeFileSync(script, `setTimeout(() => process.exit(0), 50);`);

    const child = spawn(process.execPath, [script], {
      detached: true,
      cwd: worktree,
      stdio: "ignore",
    });

    const killer = createChildKiller(() => child, 300);

    const closePromise = new Promise<number | null>((resolve) => {
      child.on("close", (code) => {
        killer.clear();
        resolve(code);
      });
    });

    const exitCode = await closePromise;
    expect(exitCode).toBe(0);
    expect(isChildAlive(child)).toBe(false);

    // Wait past the 300ms grace period; no exception or spurious kill should happen
    await new Promise((r) => setTimeout(r, 350));
  });

  it("escalates to SIGKILL against surviving descendant when leader exits on SIGTERM (redirected stdio)", async () => {
    const worktree = fs.mkdtempSync(
      path.join(os.tmpdir(), "arij-desc-redir-test-")
    );
    tempDirs.push(worktree);

    const outputFile = path.join(worktree, "activity.log");
    const descendantScript = path.join(worktree, "descendant.js");
    const leaderScript = path.join(worktree, "leader.js");

    // Descendant process ignores SIGTERM and writes periodically
    fs.writeFileSync(
      descendantScript,
      `
      process.on('SIGTERM', () => {});
      const fs = require('fs');
      setInterval(() => {
        fs.appendFileSync(${JSON.stringify(outputFile)}, "descendant-write\\n");
      }, 25);
      `
    );

    // Leader process does NOT ignore SIGTERM (default behavior: exits on SIGTERM)
    // Descendant is spawned with redirected/ignored stdio
    fs.writeFileSync(
      leaderScript,
      `
      const { spawn } = require('child_process');
      spawn(process.execPath, [${JSON.stringify(descendantScript)}], {
        stdio: 'ignore'
      });
      setInterval(() => {}, 1000);
      `
    );

    const child = spawn(process.execPath, [leaderScript], {
      detached: true,
      cwd: worktree,
      stdio: "ignore",
    });

    expect(child.pid).toBeDefined();
    expect(isChildAlive(child)).toBe(true);

    // Wait until descendant is actively writing
    let writes = 0;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 40));
      if (fs.existsSync(outputFile)) {
        const lines = fs.readFileSync(outputFile, "utf-8").trim().split("\n");
        if (lines.length >= 2) {
          writes = lines.length;
          break;
        }
      }
    }
    expect(writes).toBeGreaterThanOrEqual(2);

    const killer = createChildKiller(() => child, 200);

    const closePromise = new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        child.on("close", async (code, signal) => {
          if (killer.isKilled()) {
            await killer.waitForTeardown();
          } else {
            killer.clear();
          }
          resolve({ code, signal });
        });
      }
    );

    // Initiate cancellation
    killer.kill();

    // Leader exits on SIGTERM, close handler awaits group teardown, and descendant is killed by SIGKILL
    await closePromise;
    expect(isChildAlive(child)).toBe(false);

    // Wait 150ms to ensure descendant has settled
    await new Promise((r) => setTimeout(r, 150));
    const linesAfterKill = fs.readFileSync(outputFile, "utf-8").trim().split("\n").length;

    // Verify writes have completely stopped
    await new Promise((r) => setTimeout(r, 150));
    const linesLater = fs.readFileSync(outputFile, "utf-8").trim().split("\n").length;
    expect(linesLater).toBe(linesAfterKill);

    // Verify safe worktree reuse
    fs.writeFileSync(outputFile, "reused: build complete\\n");
    await new Promise((r) => setTimeout(r, 150));
    expect(fs.readFileSync(outputFile, "utf-8")).toBe("reused: build complete\\n");
  });

  it("escalates to SIGKILL against surviving descendant when leader exits on SIGTERM (inherited stdio)", async () => {
    const worktree = fs.mkdtempSync(
      path.join(os.tmpdir(), "arij-desc-inherit-test-")
    );
    tempDirs.push(worktree);

    const outputFile = path.join(worktree, "activity.log");
    const descendantScript = path.join(worktree, "descendant.js");
    const leaderScript = path.join(worktree, "leader.js");

    // Descendant process ignores SIGTERM and writes periodically
    fs.writeFileSync(
      descendantScript,
      `
      process.on('SIGTERM', () => {});
      const fs = require('fs');
      setInterval(() => {
        fs.appendFileSync(${JSON.stringify(outputFile)}, "descendant-write\\n");
      }, 25);
      `
    );

    // Leader process does NOT ignore SIGTERM.
    // Descendant inherits stdio from leader, keeping pipes open until descendant terminates.
    fs.writeFileSync(
      leaderScript,
      `
      const { spawn } = require('child_process');
      spawn(process.execPath, [${JSON.stringify(descendantScript)}], {
        stdio: 'inherit'
      });
      setInterval(() => {}, 1000);
      `
    );

    const child = spawn(process.execPath, [leaderScript], {
      detached: true,
      cwd: worktree,
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(child.pid).toBeDefined();
    expect(isChildAlive(child)).toBe(true);

    // Wait until descendant is actively writing
    let writes = 0;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 40));
      if (fs.existsSync(outputFile)) {
        const lines = fs.readFileSync(outputFile, "utf-8").trim().split("\n");
        if (lines.length >= 2) {
          writes = lines.length;
          break;
        }
      }
    }
    expect(writes).toBeGreaterThanOrEqual(2);

    const killer = createChildKiller(() => child, 200);

    const closePromise = new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        child.on("close", async (code, signal) => {
          if (killer.isKilled()) {
            await killer.waitForTeardown();
          } else {
            killer.clear();
          }
          resolve({ code, signal });
        });
      }
    );

    // Initiate cancellation
    killer.kill();

    // Descendant keeps pipes open until SIGKILL escalation terminates it
    await closePromise;
    expect(isChildAlive(child)).toBe(false);

    // Wait 150ms to ensure descendant has settled
    await new Promise((r) => setTimeout(r, 150));
    const linesAfterKill = fs.readFileSync(outputFile, "utf-8").trim().split("\n").length;

    // Verify writes have completely stopped
    await new Promise((r) => setTimeout(r, 150));
    const linesLater = fs.readFileSync(outputFile, "utf-8").trim().split("\n").length;
    expect(linesLater).toBe(linesAfterKill);

    // Verify safe worktree reuse
    fs.writeFileSync(outputFile, "reused: build complete\\n");
    await new Promise((r) => setTimeout(r, 150));
    expect(fs.readFileSync(outputFile, "utf-8")).toBe("reused: build complete\\n");
  });
});
