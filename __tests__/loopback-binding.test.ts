/**
 * B-arij-247, half one: Arij must not offer its unauthenticated `/api/*`
 * surface to the LAN by default.
 *
 * `next dev` and `next start` bind `0.0.0.0` when no `-H` is passed, and
 * `proxy.ts` decides "local" from the `Host` header — which any non-browser
 * client sets freely. Binding loopback is the fix that needs no trust in a
 * header at all, and it has to hold on BOTH launch paths: the package scripts
 * a checkout runs, and `bin/arij.mjs`, the launcher an `npm i -g arij` install
 * actually starts.
 *
 * The launch plan is a pure function precisely so this file can assert on it
 * without spawning a server: `bin/arij.mjs` is a thin shell around it, pinned
 * below by reading its source.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BIND_HOST,
  resolveLaunchPlan,
} from "../bin/launch-plan.mjs";

const projectRoot = path.resolve(__dirname, "..");

function readPackageJson(): {
  scripts: Record<string, string>;
  files: string[];
} {
  return JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  );
}

describe("default binding is loopback", () => {
  it("binds the dev script to loopback", () => {
    // `next dev` with no -H listens on every interface. The flag is the whole
    // fix for the checkout path; asserting on the string is honest evidence
    // about the script, not about what Next then does with it.
    expect(readPackageJson().scripts.dev).toContain(`-H ${DEFAULT_BIND_HOST}`);
  });

  it("binds the start script to loopback", () => {
    expect(readPackageJson().scripts.start).toContain(`-H ${DEFAULT_BIND_HOST}`);
  });

  it("defaults the launcher to loopback for dev", () => {
    const plan = resolveLaunchPlan(["dev"], {});
    expect(plan.command).toBe("dev");
    expect(plan.host).toBe(DEFAULT_BIND_HOST);
    expect(plan.nextArgs).toEqual(["dev", "-H", DEFAULT_BIND_HOST]);
    expect(plan.remote).toBe(false);
  });

  it("defaults the launcher to loopback for start", () => {
    const plan = resolveLaunchPlan([], {});
    expect(plan.command).toBe("start");
    expect(plan.nextArgs).toEqual(["start", "-H", DEFAULT_BIND_HOST]);
    expect(plan.remote).toBe(false);
  });

  it("mints no credential for a loopback listener", () => {
    const plan = resolveLaunchPlan(["dev"], {});
    expect(plan.remoteToken).toBeNull();
    expect(plan.childEnv.ARIJ_REMOTE_TOKEN).toBeUndefined();
  });

  it("passes unrelated flags through to next", () => {
    // Playwright's webServer runs `npm run dev -- --port 3100`; the launcher
    // has to stay just as transparent.
    const plan = resolveLaunchPlan(["dev", "--port", "3100", "--turbo"], {});
    expect(plan.nextArgs).toEqual([
      "dev",
      "-H",
      DEFAULT_BIND_HOST,
      "--port",
      "3100",
      "--turbo",
    ]);
  });

  it("keeps build free of a host flag", () => {
    const plan = resolveLaunchPlan(["build"], {});
    expect(plan.nextArgs).toEqual(["build"]);
    expect(plan.host).toBeNull();
    expect(plan.remote).toBe(false);
  });

  it("treats an explicit loopback host as local, not remote", () => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) {
      const plan = resolveLaunchPlan(["dev", "--host", host], {});
      expect(plan.host).toBe(host);
      expect(plan.remote).toBe(false);
      expect(plan.remoteToken).toBeNull();
    }
  });

  it("honours ARIJ_HOST without a flag", () => {
    const plan = resolveLaunchPlan(["dev"], { ARIJ_HOST: "127.0.0.1" });
    expect(plan.host).toBe("127.0.0.1");
    expect(plan.remote).toBe(false);
  });
});

describe("remote binding is an explicit, credentialled opt-in", () => {
  it("mints a per-boot credential when asked to bind every interface", () => {
    const plan = resolveLaunchPlan(["start", "-H", "0.0.0.0"], {});
    expect(plan.remote).toBe(true);
    expect(typeof plan.remoteToken).toBe("string");
    expect(plan.remoteToken!.length).toBeGreaterThanOrEqual(32);
    expect(plan.childEnv.ARIJ_REMOTE_TOKEN).toBe(plan.remoteToken);
  });

  it("mints a different credential every boot", () => {
    const a = resolveLaunchPlan(["start", "-H", "0.0.0.0"], {});
    const b = resolveLaunchPlan(["start", "-H", "0.0.0.0"], {});
    expect(a.remoteToken).not.toBe(b.remoteToken);
  });

  it("reuses an operator-supplied credential instead of minting one", () => {
    const plan = resolveLaunchPlan(["start", "-H", "0.0.0.0"], {
      ARIJ_REMOTE_TOKEN: "operator-chosen-secret",
    });
    expect(plan.remoteToken).toBe("operator-chosen-secret");
    expect(plan.childEnv.ARIJ_REMOTE_TOKEN).toBe("operator-chosen-secret");
  });

  it("hands the credential over exactly once, as a bootstrap URL", () => {
    const plan = resolveLaunchPlan(
      ["start", "-H", "192.168.1.10", "--port", "4000"],
      {},
    );
    const printed = plan.notices.join("\n");
    expect(printed).toContain(
      `http://192.168.1.10:4000/api/auth/remote?token=${plan.remoteToken}`,
    );
    // One handoff, not a token sprayed through every line of the banner.
    expect(printed.split(plan.remoteToken!).length - 1).toBe(1);
  });

  it("still binds the requested remote host", () => {
    const plan = resolveLaunchPlan(["dev", "-H", "0.0.0.0"], {});
    expect(plan.nextArgs).toEqual(["dev", "-H", "0.0.0.0"]);
  });
});

describe("bin/arij.mjs is the launcher these rules describe", () => {
  const source = fs.readFileSync(
    path.join(projectRoot, "bin", "arij.mjs"),
    "utf8",
  );

  it("resolves its arguments through the shared plan", () => {
    // A second, drifting copy of the host logic inside arij.mjs is exactly the
    // failure this pins: the plan above would stay green while the installed
    // launcher went on binding 0.0.0.0.
    expect(source).toContain("resolveLaunchPlan");
    expect(source).toContain("./launch-plan.mjs");
  });

  it("never spawns next with a bare command list", () => {
    expect(source).not.toMatch(/getNextBin\(\),\s*\["(dev|start)"\]/);
  });

  it("ships the plan module in the published package", () => {
    expect(readPackageJson().files).toContain("bin");
    expect(
      fs.existsSync(path.join(projectRoot, "bin", "launch-plan.mjs")),
    ).toBe(true);
  });
});
