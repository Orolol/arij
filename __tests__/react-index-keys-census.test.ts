// @vitest-environment node
/**
 * Census of JSX `key` props built from a `.map` index.
 *
 * An index key is right for a positional list (bars per day slot, lines of
 * one string) and wrong for a list that can re-sort or take an insertion:
 * React then hands one row's DOM and state to whichever item now sits at that
 * position. The two lists that could reorder (the session detail's
 * chronological action list, the usage card's model-scoped windows) key on
 * content now; every remaining index-keyed site is listed below with the
 * reason it is positional, and this test fails the moment a new one appears
 * or a listed one goes — so the decision is taken in the open rather than by
 * omission.
 *
 * The scan parses with the TypeScript compiler rather than pattern-matching
 * TSX (see __tests__/helpers/class-list-scan.ts for the two scanners that
 * lost sites to guesswork). A site is a `key={…}` whose expression mentions
 * the second parameter of the nearest enclosing `.map` / `.flatMap` callback
 * (or the mapper of `Array.from`), whatever that parameter is called.
 *
 * WHAT THIS DOES NOT PROVE: that an allowed site is still positional. The
 * reasons are the reviewer's, re-read when the file changes.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOTS = ["app", "components", "hooks", "lib"] as const;
const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next"]);

/**
 * Index-keyed sites that are positional by construction. `sites` is the
 * count in that file; the test names each site (file:line and the key
 * expression) when the count moves.
 */
const DELIBERATE: Record<string, { sites: number; why: string }> = {
  "app/projects/[projectId]/git-sync/page.tsx": {
    sites: 1,
    why: "lines of one diff string; the array is re-derived wholesale when the diff changes, never reordered",
  },
  "app/projects/import/page.tsx": {
    sites: 1,
    why: "failure messages listed once after project creation; static",
  },
  "components/chat/QuestionCards.tsx": {
    sites: 2,
    why: "step dots and options are positional — the option index is the identity the selection map is keyed on",
  },
  "components/chat-page/DraftedEpicCard.tsx": {
    sites: 1,
    why: "stories of a drafted epic, rendered once from a chat message; no reorder control",
  },
  "components/import/ImportPreview.tsx": {
    sites: 2,
    why: "preview entries carry no id and are delete-only (no reorder); every input is controlled, so a deleted row cannot leak state into its successor",
  },
  "components/piscine/CappedBarChart.tsx": {
    sites: 2,
    why: "one bar per day slot; the slot is the bar's identity",
  },
  "components/piscine/PipelineChain.tsx": {
    sites: 2,
    why: "fixed stage sequence, keyed label plus position",
  },
  "components/piscine/RatioBar.tsx": {
    sites: 1,
    why: "positional segments of one bar",
  },
  "components/releases/ChangelogCard.tsx": {
    sites: 2,
    why: "lines of one markdown string",
  },
  "components/review/FileDiffView.tsx": {
    sites: 2,
    why: "hunks and lines of one static diff",
  },
  "components/session-live/PromptComposedCard.tsx": {
    sites: 1,
    why: "split parts of one prompt string around the elision marker",
  },
  "components/sessions/SessionOutputStream.tsx": {
    sites: 2,
    why: "split parts of one output string around the elision and prune markers",
  },
  "components/ticket/AgentActivityBand.tsx": {
    sites: 1,
    why: "sub-lines of a grouped line, scoped under the group's own key; groups only append",
  },
  "components/ticket/TicketScreenshots.tsx": {
    sites: 1,
    why: "path plus index, documented in place: two identical paths stay distinct",
  },
  "components/ticket/VerifyBand.tsx": {
    sites: 1,
    why: "name plus index over one verify report's command results: the order is the configured run order, the array is replaced wholesale on every refetch, and nothing in the overlay reorders, inserts or deletes a row — the index is what keeps two identically-named commands distinct",
  },
};

interface IndexKeySite {
  line: number;
  expression: string;
}

function tsxFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) out.push(full);
    }
  };
  for (const root of ROOTS) walk(root);
  return out.sort();
}

/** The index parameter of a `.map` / `.flatMap` / `Array.from` mapper, if any. */
function indexParameter(node: ts.CallExpression): string | null {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  let callback: ts.Expression | undefined;
  if (callee.name.text === "map" || callee.name.text === "flatMap") {
    callback = node.arguments[0];
  } else if (
    callee.name.text === "from" &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Array"
  ) {
    callback = node.arguments[1];
  }
  if (!callback) return null;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
    return null;
  }
  const index = callback.parameters[1]?.name;
  return index && ts.isIdentifier(index) ? index.text : null;
}

function mentions(expr: ts.Node, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isIdentifier(n) &&
      n.text === name &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(expr);
  return found;
}

function indexKeySites(file: string): IndexKeySite[] {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );
  const sites: IndexKeySite[] = [];
  const enclosing: string[] = [];

  const visit = (node: ts.Node): void => {
    let pushed = false;
    if (ts.isCallExpression(node)) {
      const index = indexParameter(node);
      if (index !== null) {
        enclosing.push(index);
        pushed = true;
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(tree) === "key" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      const expression = node.initializer.expression;
      if (enclosing.some((name) => mentions(expression, name))) {
        const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        sites.push({
          line: line + 1,
          expression: expression.getText(tree).replace(/\s+/g, " "),
        });
      }
    }
    ts.forEachChild(node, visit);
    if (pushed) enclosing.pop();
  };
  visit(tree);
  return sites;
}

function describeSites(file: string, sites: IndexKeySite[]): string {
  return sites.map((s) => `${file}:${s.line} key={${s.expression}}`).join("\n");
}

describe("array-index React keys", () => {
  const census = new Map<string, IndexKeySite[]>();
  for (const file of tsxFiles()) {
    const sites = indexKeySites(file);
    if (sites.length > 0) census.set(file, sites);
  }

  it("scans the source tree", () => {
    expect(census.size).toBeGreaterThan(0);
  });

  it("keys only the listed positional lists by index", () => {
    const unexpected: string[] = [];
    for (const [file, sites] of census) {
      const allowed = DELIBERATE[file]?.sites ?? 0;
      if (sites.length !== allowed) {
        unexpected.push(
          `${file}: ${sites.length} index-keyed site(s), ${allowed} listed as deliberate\n` +
            describeSites(file, sites)
        );
      }
    }
    expect(unexpected, unexpected.join("\n\n")).toEqual([]);
  });

  it("lists no site that no longer exists", () => {
    const stale = Object.keys(DELIBERATE).filter((file) => !census.has(file));
    expect(stale).toEqual([]);
  });

  it("re-keyed lists no longer appear in the census", () => {
    expect(census.has("components/shared/ArijActionsList.tsx")).toBe(false);
    expect(census.has("components/usage/SubscriptionCard.tsx")).toBe(false);
  });
});
