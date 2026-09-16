import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { excludeInstrumentationRuntimeFiles } from "@/bin/build-traces.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "arij-build-trace-"));
  roots.push(projectDir);
  const distDir = path.join(projectDir, "custom-build");
  await mkdir(path.join(distDir, "server"), { recursive: true });
  return { projectDir, distDir, manifestPath: path.join(distDir, "server", "instrumentation.js.nft.json") };
}

describe("instrumentation deployment trace", () => {
  it("excludes runtime data, preserving application assets and files on disk", async () => {
    const { projectDir, distDir, manifestPath } = await fixture();
    const kept = [
      "./chunks/server.js",
      "../../lib/db/migrations/0001.sql",
      "../../node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      "../../node_modules/example/data/asset.json",
      "../../database/source.json",
      "../../data-backup/asset.json",
      "../../../data/external.json",
    ];
    const runtime = ["../../data/arij.db", "../../data/sessions/s1/logs.json", "../../data/backups/old.db"];
    await mkdir(path.join(projectDir, "data"));
    await writeFile(path.join(projectDir, "data", "arij.db"), "user data");
    await writeFile(manifestPath, JSON.stringify({ version: 1, files: [...kept, ...runtime], extra: true }));

    await excludeInstrumentationRuntimeFiles({ projectDir, distDir });

    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toEqual({ version: 1, files: kept, extra: true });
    expect(await readFile(path.join(projectDir, "data", "arij.db"), "utf8")).toBe("user data");
    await excludeInstrumentationRuntimeFiles({ projectDir, distDir });
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toEqual({ version: 1, files: kept, extra: true });
  });

  it("allows a build without an instrumentation trace", async () => {
    const { projectDir, distDir } = await fixture();
    await expect(excludeInstrumentationRuntimeFiles({ projectDir, distDir })).resolves.toBeUndefined();
  });

  it("does not silently accept an unreadable manifest", async () => {
    const { projectDir, distDir, manifestPath } = await fixture();
    await writeFile(manifestPath, "invalid json");
    await expect(excludeInstrumentationRuntimeFiles({ projectDir, distDir })).rejects.toThrow();
  });
});
