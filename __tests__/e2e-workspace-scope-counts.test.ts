import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

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
 * The repair both times is the same, and `qa-findings-responsive` already
 * practised it on `/qa`: narrow the locator to a marker the test owns
 * (`.filter({ hasText: … })`) before counting. This test pins that convention
 * so the pattern cannot come back silently.
 *
 * WHAT IT DOES NOT CATCH: it reads syntax, not behaviour. A count laundered
 * through a helper function, a locator built from a value it cannot resolve to
 * a `getByTestId`, or a workspace-wide assertion written with something other
 * than `toHaveCount` all pass unseen. The synthetic controls below pin what the
 * scan does see, so a parser that quietly stops matching fails here rather than
 * reporting a clean sweep.
 */

const E2E_DIR = join(__dirname, "..", "e2e");

interface Violation {
  file: string;
  line: number;
  snippet: string;
}

interface ScanResult {
  violations: Violation[];
  /** How many times a test body entered workspace-wide scope. */
  globalEntries: number;
  /** Non-zero `toHaveCount` assertions examined, whatever the scope. */
  countAssertions: number;
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

  type Event =
    | { pos: number; kind: "scope"; global: boolean }
    | { pos: number; kind: "count"; call: ts.CallExpression; value: number };

  const eventsIn = (body: ts.Node): Event[] => {
    const events: Event[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;

        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "goto") {
          const target = node.arguments[0];
          const text = target ? expand(target) : "";
          events.push({ pos: node.getStart(source), kind: "scope", global: !isProjectScopedTarget(text) });
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
    for (const event of eventsIn(body)) {
      if (event.kind === "scope") {
        if (event.global && !workspaceWide) globalEntries += 1;
        workspaceWide = event.global;
        continue;
      }
      countAssertions += 1;
      if (!workspaceWide) continue;

      const argument = expectArgument(event.call)!;
      const expanded = expand(argument);
      // Only collection locators are at risk: a form field found by its label
      // is not multiplied by a sibling spec's project.
      if (!expanded.includes("getByTestId(")) continue;
      if (expanded.includes(".filter(")) continue;

      violations.push({
        file: fileName,
        line: source.getLineAndCharacterOfPosition(event.call.getStart(source)).line + 1,
        snippet: event.call.getText(source).replace(/\s+/g, " ").slice(0, 120),
      });
    }
  }

  return { violations, globalEntries, countAssertions };
}

const specFiles = readdirSync(E2E_DIR)
  .filter((entry) => entry.endsWith(".spec.ts"))
  .sort();

describe("the scan itself", () => {
  it("finds the spec files to sweep", () => {
    // An empty sweep would satisfy the rule below while proving nothing.
    expect(specFiles.length).toBeGreaterThanOrEqual(20);
  });

  it("reaches workspace-wide scope and real count assertions across the suite", () => {
    const totals = specFiles.reduce(
      (accumulator, file) => {
        const result = scanSource(file, readFileSync(join(E2E_DIR, file), "utf8"));
        return {
          globalEntries: accumulator.globalEntries + result.globalEntries,
          countAssertions: accumulator.countAssertions + result.countAssertions,
        };
      },
      { globalEntries: 0, countAssertions: 0 },
    );
    // Both halves of the rule have to be exercised by the real suite, or a
    // parser that stopped recognising `goto` / `toHaveCount` would report a
    // clean sweep.
    expect(totals.globalEntries).toBeGreaterThan(0);
    expect(totals.countAssertions).toBeGreaterThan(10);
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
        await page.goto("/tickets");
        const rows = page.getByTestId("tickets-row");
        await expect(rows.filter({ hasText: title })).toHaveCount(1);
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
});

describe("no e2e spec counts a workspace-wide collection", () => {
  it.each(specFiles.map((file) => [file]))("%s", (file) => {
    const { violations } = scanSource(file, readFileSync(join(E2E_DIR, file), "utf8"));
    expect(
      violations,
      violations
        .map(
          (violation) =>
            `${violation.file}:${violation.line} counts a workspace-wide collection — ` +
            `narrow it to a marker this test owns (\`.filter({ hasText: … })\`) before counting: ${violation.snippet}`,
        )
        .join("\n"),
    ).toEqual([]);
  });
});
