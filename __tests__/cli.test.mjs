import { execFileSync } from "node:child_process";
import { readFileSync, accessSync, constants } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolveLaunchPlan } from "../bin/launch-plan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const cliBin = resolve(projectRoot, "bin", "arij.mjs");
const pkg = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf-8")
);

describe("package.json configuration", () => {
  it("should have package name set to 'arij'", () => {
    expect(pkg.name).toBe("arij");
  });

  it("should have a bin field pointing to the CLI entry script", () => {
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin.arij).toBe("./bin/arij.mjs");
  });

  it("should be marked as private for git-clone distribution", () => {
    expect(pkg.private).toBe(true);
  });
});

describe("CLI entry script", () => {
  it("should exist at bin/arij.mjs", () => {
    expect(() => accessSync(cliBin, constants.F_OK)).not.toThrow();
  });

  it("should be executable", () => {
    expect(() => accessSync(cliBin, constants.X_OK)).not.toThrow();
  });

  it("should have a node shebang line", () => {
    const content = readFileSync(cliBin, "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("should print help with --help flag", () => {
    const output = execFileSync("node", [cliBin, "--help"], {
      encoding: "utf-8",
    });
    expect(output).toContain("arij");
    expect(output).toContain("Usage");
  });

  it("should print version with --version flag", () => {
    const output = execFileSync("node", [cliBin, "--version"], {
      encoding: "utf-8",
    });
    expect(output.trim()).toBe(pkg.version);
  });

  it("should exit with error for unknown commands", () => {
    expect(() =>
      execFileSync("node", [cliBin, "nonexistent"], {
        encoding: "utf-8",
        stdio: "pipe",
      })
    ).toThrow();
  });
});

describe("start command launches Next.js server", () => {
  /*
   * These used to grep `bin/arij.mjs` for `command === "dev"` and friends.
   * The dispatch now lives in `bin/launch-plan.mjs` — extracted so the host it
   * binds could be asserted on without spawning a server (B-arij-247) — so ask
   * the plan directly. Stronger than the grep it replaces: it pins the argv
   * that actually reaches `next`, not the shape of the code that builds it.
   *
   * The loopback default itself, and the credentialled remote opt-in, are
   * pinned in `__tests__/loopback-binding.test.ts`.
   */
  it("should invoke next start when run with no arguments", () => {
    expect(resolveLaunchPlan([], {}).nextArgs[0]).toBe("start");
  });

  it("should invoke next start when run with 'start' argument", () => {
    expect(resolveLaunchPlan(["start"], {}).nextArgs[0]).toBe("start");
  });

  it("should invoke next dev when run with 'dev' argument", () => {
    expect(resolveLaunchPlan(["dev"], {}).nextArgs[0]).toBe("dev");
  });

  it("should invoke next build when run with 'build' argument", () => {
    expect(resolveLaunchPlan(["build"], {}).nextArgs).toEqual(["build"]);
  });

  it("should route 'pi' to the bundled Pi launcher, not to next", () => {
    const plan = resolveLaunchPlan(["pi", "--version", "-H", "0.0.0.0"], {});
    expect(plan.command).toBe("pi");
    // Every argument after `pi` belongs to Pi, host flags included.
    expect(plan.piArgs).toEqual(["--version", "-H", "0.0.0.0"]);
    expect(plan.nextArgs).toEqual([]);
    expect(plan.remote).toBe(false);
    expect(plan.childEnv).toEqual({});
  });

  it("should spawn bin/arij-pi.mjs with the plan's Pi arguments", () => {
    const content = readFileSync(cliBin, "utf-8");
    expect(content).toContain('resolve(projectRoot, "bin", "arij-pi.mjs"), ...plan.piArgs');
  });

  it("should hand that argv to the next binary", () => {
    const content = readFileSync(cliBin, "utf-8");
    expect(content).toContain("execFileSync(getNextBin(), plan.nextArgs");
  });
});
