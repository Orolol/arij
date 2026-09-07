import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { GROUP_PREVIEW } from "@/lib/tickets-registry/aggregate";

/**
 * One database, four workers, and pages that span the whole workspace.
 *
 * `playwright.config.ts` runs `fullyParallel: true` with `workers: 4`, and all
 * four share a single `ARIJ_DB_PATH`. The `project` fixture keeps each spec on
 * its own board, which is why `e2e/README.md` calls the suite safe under
 * parallelism — but that safety stops at the project boundary. `/`, `/tickets`
 * with no `?project=`, `/qa` and the top bar's project chips deliberately show
 * EVERY project, so on those surfaces a concurrent spec's rows are legitimately
 * on screen. An absolute `toHaveCount(n)` there is asserting on the workspace,
 * not on the test's own data, and it fails whenever a sibling happens to
 * overlap: order-dependent, green alone, green on CI at `workers: 1`.
 *
 * It has bitten twice. `piscine-finishing`'s eight-chips test asserted
 * `toHaveCount(9)` on the top bar's chips (fixed in 315ae36 by asserting the
 * ids it owns), and `tickets-registry-filters` asserted `toHaveCount(1)` and
 * `toHaveCount(4)` on `tickets-row` after clearing the project filter.
 *
 * The repair is to narrow the locator to a marker the test owns
 * (`.filter({ hasText: … })`) before counting, as `qa-findings-responsive`
 * already practised on `/qa`. This test pins that convention so the pattern
 * cannot come back silently.
 *
 * THE SECOND HALF OF THE RULE: on a surface that TRUNCATES, narrowing the
 * locator is not enough. `RegistryTable` renders `GROUP_PREVIEW[group]` rows
 * and hides the rest behind "+ n autres", so a sibling spec's rows do not just
 * inflate a count on `/tickets` — they push the owned row out of the DOM
 * entirely, and `.filter({ hasText: … })` then finds nothing. Reproduced with
 * five interfering `review` rows in `e2e/tickets-registry-filters.spec.ts`.
 * There, the only honest repair is to narrow what the surface RENDERS, through
 * its own search field, so `TRUNCATED_COLLECTIONS` demands that instead.
 *
 * WHAT IT DOES NOT CATCH: it reads syntax, not behaviour. A count laundered
 * through a helper function, a locator built from a value it cannot resolve to
 * a `getByTestId`, or a workspace-wide assertion written with something other
 * than `toHaveCount` all pass unseen. Nor can it tell an owned search marker
 * from any other non-empty string — it checks that the field was narrowed, not
 * that the needle belongs to the test. The synthetic controls below pin what
 * the scan does see, so a parser that quietly stops matching fails here rather
 * than reporting a clean sweep.
 */

const E2E_DIR = join(__dirname, "..", "e2e");
const REPO_ROOT = join(__dirname, "..");

/**
 * Collections whose surface renders a capped preview, mapped to the search
 * field that narrows what it renders.
 *
 * One entry today: the registry's rows, capped by `GROUP_PREVIEW` and narrowed
 * by the `⌘F` field. "the truncation hazard it is keyed on" below re-reads the
 * source this claim rests on, so an entry cannot rot into a rule about a
 * surface that no longer truncates — or, worse, stay silent about one that
 * starts to.
 */
const TRUNCATED_COLLECTIONS: Record<string, string> = {
  "tickets-row": "tickets-filter-field",
};

interface Violation {
  file: string;
  line: number;
  snippet: string;
  reason: string;
}

interface ScanResult {
  violations: Violation[];
  /** How many times a test body entered workspace-wide scope. */
  globalEntries: number;
  /** Non-zero `toHaveCount` assertions examined, whatever the scope. */
  countAssertions: number;
  /** Search fields a test body narrowed, counted at the call. */
  narrowings: number;
}

/**
 * A navigation target is project-scoped when it names a project: `?project=`,
 * a `/projects/…` path, or the fixture's `boardUrl`. Everything else is the
 * workspace.
 *
 * `/projects/new` reads as scoped by this rule. It is a form rather than a
 * collection, so nothing it renders is multiplied by a sibling's data, and the
 * exemption costs no coverage. A target this cannot read at all (a loop
 * variable) is treated as workspace-wide — the conservative side.
 */
function isProjectScopedTarget(text: string): boolean {
  return /project=|\/projects\/|boardUrl/.test(text);
}

/** `expect(x).toHaveCount(n)` — the `x`, walking back through `.not` etc. */
function expectArgument(call: ts.CallExpression): ts.Expression | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  if (call.expression.name.text !== "toHaveCount") return null;

  let node: ts.Expression = call.expression.expression;
  while (ts.isPropertyAccessExpression(node)) node = node.expression;
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  const name = ts.isIdentifier(callee) ? callee.text : null;
  if (name !== "expect") return null;
  return node.arguments[0] ?? null;
}

function scanSource(fileName: string, text: string): ScanResult {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];
  let globalEntries = 0;
  let countAssertions = 0;
  let narrowings = 0;

  // `const rows = page.getByTestId("tickets-row")` — the shape both defects
  // used, so an identifier has to be expanded before it can be classified.
  const bindings = new Map<string, string>();
  const collectBindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer.getText(source));
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(source);

  const expand = (expression: ts.Expression): string => {
    let out = expression.getText(source);
    // One level is enough for the shapes the suite uses, and a fixed point
    // would need a cycle guard for no extra coverage.
    for (const [name, value] of bindings) {
      out = out.replace(new RegExp(`\\b${name}\\b`, "g"), value);
    }
    return out;
  };

  /** Which `TRUNCATED_COLLECTIONS` entry, if any, a locator resolves to. */
  const truncatedCollection = (expanded: string): string | null =>
    Object.keys(TRUNCATED_COLLECTIONS).find((testId) =>
      expanded.includes(`getByTestId("${testId}")`),
    ) ?? null;

  type Event =
    | { pos: number; kind: "scope"; global: boolean }
    /** A navigation: the view re-mounts and its component state is gone. */
    | { pos: number; kind: "remount" }
    | { pos: number; kind: "narrow"; field: string; on: boolean }
    | { pos: number; kind: "count"; call: ts.CallExpression; value: number };

  const eventsIn = (body: ts.Node): Event[] => {
    const events: Event[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;

        // Every navigation re-mounts the view, and the search query is
        // component state (`TicketsRegistryView`), so it does not survive one.
        // `goto` additionally says which scope the page lands in; the history
        // moves do not, so they only drop the narrowing — the safe half.
        if (
          ts.isPropertyAccessExpression(callee) &&
          ["goto", "reload", "goBack", "goForward"].includes(callee.name.text)
        ) {
          events.push({ pos: node.getStart(source), kind: "remount" });
        }

        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "goto") {
          const target = node.arguments[0];
          const text = target ? expand(target) : "";
          events.push({
            pos: node.getStart(source),
            kind: "scope",
            global: !isProjectScopedTarget(text),
          });
        }

        // Choosing a project in the registry's own filter menu moves the page
        // between the two scopes without a navigation.
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "getByRole") {
          const options = node.arguments[1];
          if (options && ts.isObjectLiteralExpression(options)) {
            const name = options.properties.find(
              (property): property is ts.PropertyAssignment =>
                ts.isPropertyAssignment(property) &&
                ts.isIdentifier(property.name) &&
                property.name.text === "name",
            );
            if (name) {
              const literal = ts.isStringLiteral(name.initializer) || ts.isNoSubstitutionTemplateLiteral(name.initializer);
              const value = name.initializer.getText(source);
              if (literal && /Tous les projets/.test(value)) {
                events.push({ pos: node.getStart(source), kind: "scope", global: true });
              } else if (!literal && /\bproject\b/.test(value)) {
                events.push({ pos: node.getStart(source), kind: "scope", global: false });
              }
            }
          }
        }

        // `field.fill("…")` — the one control that narrows what a truncating
        // surface renders. An empty string is the app's own reset, so it puts
        // the whole workspace back on screen.
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "fill") {
          const target = expand(callee.expression);
          const field = Object.values(TRUNCATED_COLLECTIONS).find((testId) =>
            target.includes(`getByTestId("${testId}")`),
          );
          if (field) {
            const needle = node.arguments[0];
            const cleared =
              needle !== undefined && ts.isStringLiteralLike(needle) && needle.text.length === 0;
            events.push({ pos: node.getStart(source), kind: "narrow", field, on: !cleared });
            if (!cleared) narrowings += 1;
          }
        }

        const argument = expectArgument(node);
        if (argument) {
          const expected = node.arguments[0];
          if (expected && ts.isNumericLiteral(expected) && Number(expected.text) > 0) {
            events.push({ pos: node.getStart(source), kind: "count", call: node, value: Number(expected.text) });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
    return events.sort((a, b) => a.pos - b.pos);
  };

  const testBodies: ts.Node[] = [];
  const findTests = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          ? `${callee.expression.text}.${callee.name.text}`
          : null;
      if (name === "test" || name === "test.only" || name === "test.skip") {
        const body = node.arguments.find((argument) => ts.isFunctionLike(argument));
        if (body) testBodies.push(body);
      }
    }
    ts.forEachChild(node, findTests);
  };
  findTests(source);

  for (const body of testBodies) {
    let workspaceWide = false;
    const narrowed = new Set<string>();
    for (const event of eventsIn(body)) {
      if (event.kind === "scope") {
        if (event.global && !workspaceWide) globalEntries += 1;
        workspaceWide = event.global;
        continue;
      }
      if (event.kind === "remount") {
        narrowed.clear();
        continue;
      }
      if (event.kind === "narrow") {
        if (event.on) narrowed.add(event.field);
        else narrowed.delete(event.field);
        continue;
      }
      countAssertions += 1;
      if (!workspaceWide) continue;

      const argument = expectArgument(event.call)!;
      const expanded = expand(argument);
      const record = (reason: string): void => {
        violations.push({
          file: fileName,
          line: source.getLineAndCharacterOfPosition(event.call.getStart(source)).line + 1,
          snippet: event.call.getText(source).replace(/\s+/g, " ").slice(0, 120),
          reason,
        });
      };

      // A truncating surface first: `.filter()` cannot reach a row the
      // preview never rendered, so only a narrowed surface clears it.
      const truncated = truncatedCollection(expanded);
      if (truncated) {
        if (narrowed.has(TRUNCATED_COLLECTIONS[truncated])) continue;
        record(
          `counts \`${truncated}\` on a truncating surface in workspace scope — sibling rows push the ` +
            `owned row past the "+ n autres" line, where \`.filter({ hasText: … })\` cannot reach it; ` +
            `narrow the surface itself with \`getByTestId("${TRUNCATED_COLLECTIONS[truncated]}").fill(<owned marker>)\` first`,
        );
        continue;
      }

      // Only collection locators are at risk: a form field found by its label
      // is not multiplied by a sibling spec's project.
      if (!expanded.includes("getByTestId(")) continue;
      if (expanded.includes(".filter(")) continue;

      record(
        "counts a workspace-wide collection — narrow it to a marker this test owns " +
          "(`.filter({ hasText: … })`) before counting",
      );
    }
  }

  return { violations, globalEntries, countAssertions, narrowings };
}

const specFiles = readdirSync(E2E_DIR)
  .filter((entry) => entry.endsWith(".spec.ts"))
  .sort();

describe("the scan itself", () => {
  it("finds the spec files to sweep", () => {
    // An empty sweep would satisfy the rule below while proving nothing.
    expect(specFiles.length).toBeGreaterThanOrEqual(20);
  });

  it("reaches workspace-wide scope, real count assertions and a real narrowing across the suite", () => {
    const totals = specFiles.reduce(
      (accumulator, file) => {
        const result = scanSource(file, readFileSync(join(E2E_DIR, file), "utf8"));
        return {
          globalEntries: accumulator.globalEntries + result.globalEntries,
          countAssertions: accumulator.countAssertions + result.countAssertions,
          narrowings: accumulator.narrowings + result.narrowings,
        };
      },
      { globalEntries: 0, countAssertions: 0, narrowings: 0 },
    );
    // Every half of the rule has to be exercised by the real suite, or a
    // parser that stopped recognising `goto` / `toHaveCount` / `fill` would
    // report a clean sweep.
    expect(totals.globalEntries).toBeGreaterThan(0);
    expect(totals.countAssertions).toBeGreaterThan(10);
    expect(totals.narrowings).toBeGreaterThan(0);
  });

  it("flags the shape that failed, and clears the shape that fixed it", () => {
    const broken = `
      test("x", async ({ page }) => {
        await page.goto("/tickets");
        const rows = page.getByTestId("tickets-row");
        await expect(rows).toHaveCount(4);
      });
    `;
    const fixed = `
      test("x", async ({ page }) => {
        await page.goto("/qa");
        const findings = page.getByTestId("qa-finding-row");
        await expect(findings.filter({ hasText: marker })).toHaveCount(1);
      });
    `;
    const scoped = `
      test("x", async ({ page, project }) => {
        await page.goto(\`/tickets?project=\${project.id}\`);
        const rows = page.getByTestId("tickets-row");
        await expect(rows).toHaveCount(4);
      });
    `;
    const form = `
      test("x", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByLabel("Project Name *")).toHaveCount(1);
      });
    `;
    expect(scanSource("broken.spec.ts", broken).violations).toHaveLength(1);
    expect(scanSource("fixed.spec.ts", fixed).violations).toHaveLength(0);
    expect(scanSource("scoped.spec.ts", scoped).violations).toHaveLength(0);
    expect(scanSource("form.spec.ts", form).violations).toHaveLength(0);
  });

  it("is not satisfied by a locator filter on a truncating surface", () => {
    // The finding this rule was added for: identity, unnarrowed. It reads as a
    // repair, and it still loses the row to the "+ n autres" line.
    const filtered = `
      test("x", async ({ page }) => {
        await page.goto("/tickets");
        const rows = page.getByTestId("tickets-row");
        await expect(rows.filter({ hasText: review })).toHaveCount(1);
      });
    `;
    const narrowed = `
      test("x", async ({ page, project }) => {
        await page.goto("/tickets");
        const rows = page.getByTestId("tickets-row");
        const field = page.getByTestId("tickets-filter-field");
        await field.fill(project.id);
        await expect(rows.filter({ hasText: review })).toHaveCount(1);
      });
    `;
    // Clearing the field puts the whole workspace back on screen…
    const cleared = `
      test("x", async ({ page, project }) => {
        await page.goto("/tickets");
        const rows = page.getByTestId("tickets-row");
        const field = page.getByTestId("tickets-filter-field");
        await field.fill(project.id);
        await field.fill("");
        await expect(rows.filter({ hasText: review })).toHaveCount(1);
      });
    `;
    // …and so does any navigation, which re-mounts the view and its query
    // state — a reload and a history move as much as a fresh `goto`.
    const remounted = `
      test("x", async ({ page, project }) => {
        await page.goto("/tickets");
        const rows = page.getByTestId("tickets-row");
        await page.getByTestId("tickets-filter-field").fill(project.id);
        await page.goto("/tickets");
        await expect(rows.filter({ hasText: review })).toHaveCount(1);
      });
    `;
    const reloaded = `
      test("x", async ({ page, project }) => {
        await page.goto("/tickets");
        const rows = page.getByTestId("tickets-row");
        await page.getByTestId("tickets-filter-field").fill(project.id);
        await page.reload();
        await expect(rows.filter({ hasText: review })).toHaveCount(1);
      });
    `;
    expect(scanSource("filtered.spec.ts", filtered).violations).toHaveLength(1);
    expect(scanSource("filtered.spec.ts", filtered).violations[0].reason).toContain("truncating surface");
    expect(scanSource("narrowed.spec.ts", narrowed).violations).toHaveLength(0);
    expect(scanSource("cleared.spec.ts", cleared).violations).toHaveLength(1);
    expect(scanSource("remounted.spec.ts", remounted).violations).toHaveLength(1);
    expect(scanSource("reloaded.spec.ts", reloaded).violations).toHaveLength(1);
  });

  it("keeps the truncation hazard it is keyed on", () => {
    // `TRUNCATED_COLLECTIONS` is a claim about the app, not a preference. If
    // the registry stopped capping its groups, or renamed the row or the
    // field, the rule above would be enforcing a rule about nothing.
    for (const [group, cap] of Object.entries(GROUP_PREVIEW)) {
      expect(cap, `${group} renders every row, so nothing is hidden`).toBeGreaterThan(0);
      expect(cap, `${group} no longer truncates in any realistic workspace`).toBeLessThan(50);
    }
    const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");
    expect(read("components/tickets-registry/RegistryTable.tsx")).toContain("GROUP_PREVIEW[group]");
    expect(read("components/tickets-registry/RegistryRow.tsx")).toContain('data-testid="tickets-row"');
    expect(read("components/tickets-registry/RegistryFilters.tsx")).toContain(
      'data-testid="tickets-filter-field"',
    );
  });
});

describe("no e2e spec counts a workspace-wide collection", () => {
  it.each(specFiles.map((file) => [file]))("%s", (file) => {
    const { violations } = scanSource(file, readFileSync(join(E2E_DIR, file), "utf8"));
    expect(
      violations,
      violations
        .map(
          (violation) =>
            `${violation.file}:${violation.line} ${violation.reason}: ${violation.snippet}`,
        )
        .join("\n"),
    ).toEqual([]);
  });
});
