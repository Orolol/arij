// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("bundled Pi distribution", () => {
  it("pins the release to the same archive and integrity as the vendored copy", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const dependency = pkg.dependencies["@arij/pi"];
    expect(dependency).toMatch(/^https:\/\/github\.com\/Orolol\/pi\/releases\/download\//);
    const archive = readFileSync(path.join("vendor", path.basename(dependency)));
    const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
    expect(lock.packages["node_modules/@arij/pi"]).toMatchObject({ resolved: dependency, integrity });
  });

  it("resolves a hoisted dependency without changing the caller's cwd", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arij-pi-launcher-test-"));
    try {
      const appBin = path.join(root, "node_modules/arij/bin");
      const bundle = path.join(root, "node_modules/@arij/pi/dist/bundle");
      mkdirSync(appBin, { recursive: true });
      mkdirSync(bundle, { recursive: true });
      const launcher = path.join(appBin, "arij-pi.mjs");
      copyFileSync("bin/arij-pi.mjs", launcher);
      writeFileSync(path.join(bundle, "../../package.json"), JSON.stringify({ name: "@arij/pi", type: "module", exports: "./dist/bundle/index.js" }));
      writeFileSync(path.join(bundle, "index.js"), "export {};");
      writeFileSync(path.join(bundle, "cli.js"), "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));");
      const output = execFileSync(process.execPath, [launcher, "--version"], { cwd: root, encoding: "utf8" });
      expect(JSON.parse(output)).toEqual({ cwd: root, args: ["--version"] });
      const update = spawnSync(process.execPath, [launcher, "update"], { cwd: root, encoding: "utf8" });
      expect(update.status).toBe(1);
      expect(update.stderr).toContain("Update Arij");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
