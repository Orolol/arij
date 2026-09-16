/**
 * Convention pin: every `vi.mock("@/…")` in the suite must resolve to a real
 * module on disk.
 *
 * Vitest SILENTLY IGNORES a `vi.mock` whose module nothing imports, so a
 * typo'd or stale path is invisible: the test stays green while the guard the
 * author believes they installed does not exist. Two were found this way —
 * `@/components/monitor/AgentMonitor` (directory removed a week earlier) and
 * `@/lib/export/arji-json` (a path that never existed, in a test whose own
 * subject was the real `@/lib/sync/export`). Both had been dead since the day
 * they were written.
 *
 * The check is text-level on purpose: resolving the specifier needs no import,
 * so a mock of a server module stays as cheap as a glob. Only `@/`-rooted
 * specifiers are checked, because those are the ones this repository owns —
 * `vi.mock("fs")`, `vi.mock("next-intl")` and friends are the environment's
 * business, and a few of them are intentionally virtual.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TEST_DIRS = ["__tests__", "e2e"];

/** Specifiers this suite deliberately mocks although no file backs them. */
const VIRTUAL = new Map<string, string>([
  // None today. Add `["@/…", "why the module is intentionally absent"]`, never
  // a plain skip: a mock that does not resolve is either a typo or a hole.
]);

function collectTestFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(path.join(ROOT, dir))) return out;
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTestFiles(relative, out);
    else if (/\.(test|spec)\.(ts|tsx|mjs)$/.test(entry.name)) out.push(relative);
  }
  return out;
}

/**
 * The `vi.mock("@/…")` / `vi.doMock("@/…")` specifiers of one file.
 *
 * COMMENT LINES ARE SKIPPED, and that is not a convenience: this convention
 * has to be writable down — including in this file's own header — or the
 * next person explains it in a comment and the guard flags the explanation.
 * Only a line whose first non-space characters are `//`, `*` or `/*` is
 * dropped, so a trailing comment after real code still gets scanned.
 */
function mockerSpecifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /\bvi\.(?:do)?[mM]ock\(\s*"(@\/[^"]+)"/g;
  for (const line of source.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }
    for (const match of line.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** True when `@/x/y` resolves to a source file, a directory index, or a package. */
function resolvesAtSpecifier(specifier: string): boolean {
  const base = path.join(ROOT, specifier.slice(2));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

describe("vi.mock specifier convention", () => {
  it("resolves every @/-rooted mock target to a module that exists", () => {
    const offenders: string[] = [];

    for (const file of TEST_DIRS.flatMap((dir) => collectTestFiles(dir))) {
      const source = readFileSync(path.join(ROOT, file), "utf-8");
      for (const specifier of new Set(mockerSpecifiers(source))) {
        if (VIRTUAL.has(specifier)) continue;
        if (!resolvesAtSpecifier(specifier)) {
          offenders.push(`${file} → vi.mock("${specifier}")`);
        }
      }
    }

    expect(
      offenders,
      "These vi.mock targets do not exist on disk. Vitest ignores such a mock " +
        "silently: the test stays green and the guard the author intended is " +
        "not installed. Fix the path, mock the real module, or delete the mock " +
        "— and only add to VIRTUAL with a written reason.",
    ).toEqual([]);
  });

  it("finds the specifiers in a sample source, so the scanner is not vacuous", () => {
    const sample = [
      'vi.mock("@/lib/db", () => ({}));',
      'vi.mock("@/lib/db/schema", () => ({}));',
      'vi.mock("fs");',
      'vi.doMock("@/lib/agents/scheduler", () => ({}));',
    ].join("\n");

    expect(mockerSpecifiers(sample)).toEqual([
      "@/lib/db",
      "@/lib/db/schema",
      "@/lib/agents/scheduler",
    ]);
  });
});
