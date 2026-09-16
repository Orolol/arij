import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import allowance from "./fixtures/client-fetch-allowlist.json";

/** Existing streaming/status-specific calls may remain; new JSON consumers use lib/api/client. */
function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}
function rawFetchCount(file: string) {
  const source = fs.readFileSync(file, "utf8");
  if (file.startsWith("app/") && !source.includes('"use client"')) return 0;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let count = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") count++;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return count;
}
describe("shared client transport", () => {
  it("allows remaining legacy and streaming calls to shrink, never expand", () => {
    const allowed = allowance as Record<string, number>;
    const increases = ["hooks", "components", "app"].flatMap(files).flatMap((file) => {
      const count = rawFetchCount(file);
      return count > (allowed[file] ?? 0) ? [`${file}: ${count} raw fetch calls (allowed ${allowed[file] ?? 0}); use requestJson/fetchJson/usePolledResource`] : [];
    });
    expect(increases).toEqual([]);
  });
  it("keeps the migrated resource readers free of private fetch loops", () => {
    for (const file of ["hooks/useEpicDetail.ts", "hooks/useProjects.ts", "hooks/useUsage.ts", "components/tickets-registry/useTicketsRegistry.ts", "hooks/useDocumentUploads.ts", "hooks/useAutoModeArmed.ts", "components/auto-mode/AutoModeToggle.tsx"])
      expect(rawFetchCount(file), file).toBe(0);
  });
});
