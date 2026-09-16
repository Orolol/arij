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

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error next/dist/compiled/commander lacks type declarations
import { Command } from "next/dist/compiled/commander";
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
  it("routes the dev script through credential-aware startup", () => {
    const devScript = readPackageJson().scripts.dev;
    expect(devScript).toMatch(/node\s+(\.\/)?bin\/arij\.mjs\s+dev/);
    const plan = resolveLaunchPlan(["dev"], {});
    expect(plan.host).toBe(DEFAULT_BIND_HOST);
    expect(plan.remote).toBe(false);
  });

  it("routes the start script through credential-aware startup", () => {
    const startScript = readPackageJson().scripts.start;
    expect(startScript).toMatch(/node\s+(\.\/)?bin\/arij\.mjs\s+start/);
    const plan = resolveLaunchPlan(["start"], {});
    expect(plan.host).toBe(DEFAULT_BIND_HOST);
    expect(plan.remote).toBe(false);
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

  it("arms remote mode for dev and start script overrides", () => {
    const devPlan = resolveLaunchPlan(["dev", "-H", "0.0.0.0"], {});
    expect(devPlan.remote).toBe(true);
    expect(devPlan.childEnv.ARIJ_REMOTE_TOKEN).toBeDefined();

    const startPlan = resolveLaunchPlan(["start", "-H", "0.0.0.0"], {});
    expect(startPlan.remote).toBe(true);
    expect(startPlan.childEnv.ARIJ_REMOTE_TOKEN).toBeDefined();
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

  it("hands the credential over exactly once, as a bootstrap URL with a fragment", () => {
    const plan = resolveLaunchPlan(
      ["start", "-H", "192.168.1.10", "--port", "4000"],
      {},
    );
    const printed = plan.notices.join("\n");
    expect(printed).toContain(
      `http://192.168.1.10:4000/api/auth/remote#token=${plan.remoteToken}`,
    );
    // One handoff, not a token sprayed through every line of the banner.
    expect(printed.split(plan.remoteToken!).length - 1).toBe(1);
  });

  it("still binds the requested remote host", () => {
    const plan = resolveLaunchPlan(["dev", "-H", "0.0.0.0"], {});
    expect(plan.nextArgs).toEqual(["dev", "-H", "0.0.0.0"]);
  });

  it("parses compact -H<host> flags and emits one authoritative host", () => {
    const plan = resolveLaunchPlan(["start", "-H0.0.0.0"], {});
    expect(plan.remote).toBe(true);
    expect(plan.host).toBe("0.0.0.0");
    expect(plan.nextArgs).toEqual(["start", "-H", "0.0.0.0"]);
    expect(plan.remoteToken).toBeDefined();
  });

  it("parses equals -H=... and --hostname=... flags", () => {
    const plan1 = resolveLaunchPlan(["start", "-H=0.0.0.0"], {});
    expect(plan1.remote).toBe(true);
    expect(plan1.host).toBe("0.0.0.0");
    expect(plan1.nextArgs).toEqual(["start", "-H", "0.0.0.0"]);

    const plan2 = resolveLaunchPlan(["dev", "--hostname=0.0.0.0"], {});
    expect(plan2.remote).toBe(true);
    expect(plan2.host).toBe("0.0.0.0");
    expect(plan2.nextArgs).toEqual(["dev", "-H", "0.0.0.0"]);

    const plan3 = resolveLaunchPlan(["dev", "--host=0.0.0.0"], {});
    expect(plan3.remote).toBe(true);
    expect(plan3.host).toBe("0.0.0.0");
    expect(plan3.nextArgs).toEqual(["dev", "-H", "0.0.0.0"]);
  });

  it("resolves repeated host flags with the last flag taking precedence", () => {
    const plan1 = resolveLaunchPlan(
      ["start", "-H", "127.0.0.1", "-H0.0.0.0"],
      {}
    );
    expect(plan1.remote).toBe(true);
    expect(plan1.host).toBe("0.0.0.0");
    expect(plan1.nextArgs).toEqual(["start", "-H", "0.0.0.0"]);

    const plan2 = resolveLaunchPlan(
      ["start", "-H0.0.0.0", "-H", "127.0.0.1"],
      {}
    );
    expect(plan2.remote).toBe(false);
    expect(plan2.host).toBe("127.0.0.1");
    expect(plan2.nextArgs).toEqual(["start", "-H", "127.0.0.1"]);
  });

  it("resolves hostname identically when parsed by Next.js Commander parser", () => {
    for (const testArgs of [
      ["start", "-H0.0.0.0"],
      ["start", "-H", "127.0.0.1", "-H0.0.0.0"],
      ["start", "-H0.0.0.0", "-H", "127.0.0.1"],
      ["dev", "--hostname=0.0.0.0"],
      ["dev", "--host=0.0.0.0"],
      ["dev", "-H=0.0.0.0"],
    ]) {
      const plan = resolveLaunchPlan(testArgs, {});
      const program = new Command();
      program.option("-H, --hostname <hostname>").option("-p, --port <port>");
      program.parse(["node", "next", ...plan.nextArgs]);
      expect(program.opts().hostname).toBe(plan.host);
      // Ensure only one -H option exists in nextArgs
      const hostFlagMatches = plan.nextArgs.filter(
        (arg: string) => arg === "-H" || arg.startsWith("-H") || arg.startsWith("--host")
      );
      expect(hostFlagMatches).toEqual(["-H"]);
    }
  });

  it("rejects missing host flag arguments", () => {
    expect(() => resolveLaunchPlan(["start", "-H"], {})).toThrow(
      /argument missing/i
    );
    expect(() => resolveLaunchPlan(["start", "--hostname"], {})).toThrow(
      /argument missing/i
    );
    expect(() => resolveLaunchPlan(["start", "--host"], {})).toThrow(
      /argument missing/i
    );
  });

  it("extracts port correctly for compact and equals forms", () => {
    const plan1 = resolveLaunchPlan(["start", "-p3000"], {});
    expect(plan1.port).toBe("3000");

    const plan2 = resolveLaunchPlan(["start", "-p=3000"], {});
    expect(plan2.port).toBe("3000");

    const plan3 = resolveLaunchPlan(["start", "--port=3000"], {});
    expect(plan3.port).toBe("3000");
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
    const pkg = readPackageJson() as { files?: string[]; private?: boolean };
    if (pkg.private) {
      expect(pkg.files).toBeUndefined();
    } else {
      expect(pkg.files).toContain("bin");
    }
    expect(
      fs.existsSync(path.join(projectRoot, "bin", "launch-plan.mjs")),
    ).toBe(true);
  });
});

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function runDirectNext(
  args: string[],
  env: Record<string, string> = {},
  options: { timeoutMs?: number; waitForReady?: boolean } = {}
): Promise<{ code: number | null; output: string }> {
  const { timeoutMs = 6000, waitForReady = false } = options;
  return new Promise((resolve) => {
    const nextBin = path.join(
      projectRoot,
      "node_modules",
      "next",
      "dist",
      "bin",
      "next"
    );
    const childEnv = { ...process.env, ...env };
    if (!("ARIJ_REMOTE_TOKEN" in env)) {
      delete childEnv.ARIJ_REMOTE_TOKEN;
    }

    const cp = spawn(process.execPath, [nextBin, ...args], {
      cwd: projectRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let settled = false;

    const timer = setTimeout(() => {
      cp.kill("SIGTERM");
      setTimeout(() => {
        if (!cp.killed) cp.kill("SIGKILL");
      }, 500);
      finish(null);
    }, timeoutMs);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output });
    };

    cp.stdout.on("data", (d) => {
      output += d.toString();
      if (waitForReady && output.includes("Ready in")) {
        cp.kill("SIGTERM");
        setTimeout(() => {
          if (!cp.killed) cp.kill("SIGKILL");
        }, 500);
        finish(0);
      }
    });
    cp.stderr.on("data", (d) => {
      output += d.toString();
    });

    cp.on("close", (code) => finish(code));
    cp.on("error", () => finish(1));
  });
}

describe("direct Next startup without launcher enforces loopback binding", () => {
  it("refuses next dev -H 0.0.0.0 without credentials across worker boundary", async () => {
    const port = await getFreePort();
    const res = await runDirectNext(["dev", "-H", "0.0.0.0", "--port", String(port)]);
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/Arij refuses to bind remote interface.*0\.0\.0\.0/);
  }, 10000);

  it("refuses direct next start when Next defaults to wildcard interface despite ARIJ_HOST", async () => {
    const port = await getFreePort();
    const res = await runDirectNext(["start", "--port", String(port)], {
      ARIJ_HOST: "127.0.0.1",
    });
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/Arij refuses to bind remote interface/);
  }, 10000);

  it("refuses direct next dev without host flags (Next default 0.0.0.0)", async () => {
    const port = await getFreePort();
    const res = await runDirectNext(["dev", "--port", String(port)]);
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/Arij refuses to bind remote interface/);
  }, 10000);

  it("allows direct next dev with explicit loopback binding (-H 127.0.0.1)", async () => {
    const port = await getFreePort();
    const res = await runDirectNext(
      ["dev", "-H", "127.0.0.1", "--port", String(port)],
      {},
      { waitForReady: true }
    );
    expect(res.output).toMatch(/Ready in/);
    expect(res.output).toMatch(/127\.0\.0\.1/);
  }, 10000);

  it("allows direct next dev -H 0.0.0.0 when ARIJ_REMOTE_TOKEN is provided", async () => {
    const port = await getFreePort();
    const res = await runDirectNext(
      ["dev", "-H", "0.0.0.0", "--port", String(port)],
      { ARIJ_REMOTE_TOKEN: "valid-operator-secret-token" },
      { waitForReady: true }
    );
    expect(res.output).toMatch(/Ready in/);
    expect(res.output).toMatch(/0\.0\.0\.0/);
  }, 10000);

  it("refuses direct next start -H 0.0.0.0 without credentials", async () => {
    const port = await getFreePort();
    const res = await runDirectNext(["start", "-H", "0.0.0.0", "--port", String(port)]);
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/Arij refuses to bind remote interface.*0\.0\.0\.0/);
  }, 10000);

  it("refuses direct next start without host flags (Next default 0.0.0.0)", async () => {
    const port = await getFreePort();
    const res = await runDirectNext(["start", "--port", String(port)]);
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/Arij refuses to bind remote interface/);
  }, 10000);

  it("allows direct next start with explicit loopback binding (-H 127.0.0.1)", async () => {
    const port = await getFreePort();
    const res = await runDirectNext(
      ["start", "-H", "127.0.0.1", "--port", String(port)],
      {},
      { waitForReady: true }
    );
    expect(res.output).toMatch(/Ready in/);
    expect(res.output).toMatch(/127\.0\.0\.1/);
  }, 10000);

  it("allows direct next start -H 0.0.0.0 when ARIJ_REMOTE_TOKEN is provided", async () => {
    const port = await getFreePort();
    const res = await runDirectNext(
      ["start", "-H", "0.0.0.0", "--port", String(port)],
      { ARIJ_REMOTE_TOKEN: "valid-operator-secret-token" },
      { waitForReady: true }
    );
    expect(res.output).toMatch(/Ready in/);
    expect(res.output).toMatch(/0\.0\.0\.0/);
  }, 10000);
});
