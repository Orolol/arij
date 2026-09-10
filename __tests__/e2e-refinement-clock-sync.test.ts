import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const SPEC_PATH = join(process.cwd(), "e2e", "refinement-options.spec.ts");

interface AstSequenceItem {
  kind: string;
  text: string;
  line: number;
}

function extractClockAndNavSequence(sourceText: string): AstSequenceItem[] {
  const source = ts.createSourceFile(
    "refinement-options.spec.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );

  const sequence: AstSequenceItem[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const exprText = node.expression.getText(source);
      const callText = node.getText(source);
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

      if (exprText === "page.clock.install") {
        sequence.push({ kind: "clock.install", text: callText, line });
      } else if (exprText === "openRegistry") {
        sequence.push({ kind: "openRegistry", text: callText, line });
      } else if (exprText === "page.clock.fastForward") {
        sequence.push({ kind: "clock.fastForward", text: callText, line });
      } else if (exprText === "page.waitForResponse") {
        sequence.push({ kind: "waitForResponse", text: callText, line });
      }
    } else if (ts.isAwaitExpression(node)) {
      const awaitText = node.getText(source);
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (awaitText.includes("runningPoll") || awaitText.includes("runningResponse")) {
        sequence.push({ kind: "await.runningPoll", text: awaitText, line });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return sequence;
}

describe("e2e refinement clock and network synchronization (mGtTIaqBBITx)", () => {
  const fileContent = readFileSync(SPEC_PATH, "utf-8");

  it("installs page.clock before openRegistry to intercept initial polling setInterval", () => {
    const sequence = extractClockAndNavSequence(fileContent);

    const clockInstalls = sequence.filter((s) => s.kind === "clock.install");
    expect(
      clockInstalls.length,
      "Expected e2e/refinement-options.spec.ts to install page.clock"
    ).toBeGreaterThan(0);

    // In the conflicting refinement test loop, page.clock.install() must precede openRegistry
    // so that RefinementButton's useEffect registers setInterval on the mock clock rather than
    // the native browser clock.
    const conflictClockInstall = clockInstalls.find((c) =>
      sequence.some(
        (o) => o.kind === "openRegistry" && o.line > c.line
      )
    );

    expect(
      conflictClockInstall,
      "page.clock.install() must be called BEFORE openRegistry() so polling interval timers are intercepted by fake-clock"
    ).toBeDefined();
  });

  it("synchronizes the initial poll and 409 conflict responses before fastForward", () => {
    const sequence = extractClockAndNavSequence(fileContent);

    const fastForwards = sequence.filter((s) => s.kind === "clock.fastForward");
    expect(fastForwards.length).toBeGreaterThan(0);

    const ffLine = fastForwards[0].line;

    // Responses waited on before fastForward:
    // 1) initial GET poll establishing idle state
    // 2) POST 409 conflict response confirming the concurrent pass
    const responsesBeforeFf = sequence.filter(
      (s) => s.kind === "waitForResponse" && s.line < ffLine
    );

    expect(
      responsesBeforeFf.length,
      "Must set up/wait for initial poll and 409 conflict responses before advancing time"
    ).toBeGreaterThanOrEqual(2);

    const hasGetBeforeFf = responsesBeforeFf.some((r) => r.text.includes('"GET"'));
    const hasPostBeforeFf = responsesBeforeFf.some((r) => r.text.includes('"POST"'));

    expect(hasGetBeforeFf, "Must wait for initial GET response before fastForward").toBe(true);
    expect(hasPostBeforeFf, "Must wait for POST 409 conflict response before fastForward").toBe(true);
  });

  it("synchronizes and awaits the running poll response when fastForward is called", () => {
    const sequence = extractClockAndNavSequence(fileContent);

    const fastForwards = sequence.filter((s) => s.kind === "clock.fastForward");
    expect(fastForwards.length).toBeGreaterThan(0);

    const ffLine = fastForwards[0].line;

    // Total waitForResponse calls in the file must include the running GET poll
    const allResponses = sequence.filter((s) => s.kind === "waitForResponse");
    const getResponses = allResponses.filter((r) => r.text.includes('"GET"'));

    expect(
      getResponses.length,
      "Must have waitForResponse for both initial GET poll and running GET poll"
    ).toBeGreaterThanOrEqual(2);

    // And the running poll response must be awaited after fastForward
    const awaitsAfterFf = sequence.filter(
      (s) => s.kind === "await.runningPoll" && s.line > ffLine
    );

    expect(
      awaitsAfterFf.length,
      "Must await the running poll response after fastForward before asserting the running badge"
    ).toBeGreaterThanOrEqual(1);
  });
});
