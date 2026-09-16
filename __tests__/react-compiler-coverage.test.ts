// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { ESLint } from "eslint";
import {
  EFFECT_RULE,
  bailReason,
  createEslint,
  probeFile,
  probeTargets,
  read,
  sourceFiles,
  withProbes,
  type ProbeTarget,
} from "./helpers/react-compiler-probe";

/**
 * Which components and hooks the React Compiler's lint rules actually READ.
 *
 * The rules in `eslint-plugin-react-hooks` 7.x are the React Compiler with
 * `noEmit`: it compiles every function it takes for a component or a hook and
 * turns the errors it logs into diagnostics. When it stops on a function —
 * a `finally` clause, a `throw` inside `try/catch`, an `eslint-disable` of
 * `exhaustive-deps`, state derived in an effect — nothing downstream runs, so
 * `set-state-in-effect`, `refs`, `immutability`, `purity` and the rest are
 * silent on that whole function. The categories that describe the stop
 * (`todo`, `rule-suppression`, `no-deriving-state-in-effects`) are off in the
 * plugin's preset, so the silence had no diagnostic at all. A component the
 * compiler never read and a clean one both reported zero errors.
 *
 * Not every `todo` is that kind of stop. One raised while lowering to HIR
 * (`finally`, a `throw` inside `try/catch`, a `try` without `catch`) or a
 * rule suppression comes before the validations and silences them; a value
 * block (`??`, `?.`, a ternary) inside `try/catch` is raised afterwards, in
 * `buildReactiveFunction`, once `set-state-in-effect` has already reported —
 * measured on a synthetic component: both diagnostics appear side by side.
 * That second kind costs the optimisation, not the lint, and this test
 * rightly counts such a function as read.
 *
 * That is not a namespace problem (`react-compiler-namespaced-hooks.test.ts`
 * pins that one): every function here calls its hooks bare. It is a second
 * blind spot with the same symptom. The original probe found 79 of the 485
 * functions the compiler took for a component or hook were dark, in 77
 * files, and neutralising the constructs in memory surfaced 44 real
 * violations behind them — 37 `set-state-in-effect`, 6 `refs`, 1
 * `immutability`.
 *
 * This test is the only thing that distinguishes "clean" from "unread". It
 * enumerates every function the compiler would consider under `app/`,
 * `components/`, `hooks/` and `lib/` (the helper replicates the compiler's
 * own inference with the TypeScript parser), plants a self-contained
 * violation in each, lints with the repository's ESLint config, and requires
 * the diagnostic back. A function whose probe is silent must be listed in
 * `KNOWN_BAILED` with a reason naming the construct — and once it reports
 * again, its entry has to go: shrinking the list is the win this test is for.
 *
 * `npm run lint` now warns on the same stops (`react-hooks/todo` and
 * siblings are enabled in `eslint.config.mjs`); this is the gate, because CI
 * runs Vitest, and because the `ESLint` class used here ignores
 * `eslint-suppressions.json`, so nothing can be baselined past it.
 */

/**
 * `file#Function` → the construct the compiler stops on, in its own words
 * where it has any, and what opening the function would cost when that is
 * known. Every entry is a debt, not a permission.
 *
 * "opening surfaces …" names the violations the compiler reports the moment
 * the construct is rewritten — measured by linting an in-memory copy with the
 * construct neutralised. Rewriting one of these without fixing what it
 * uncovers turns a silent component into a red `npm run lint`, so the two are
 * one change, filed as its own ticket.
 */
const KNOWN_BAILED: Record<string, string> = {};

/** A reason has to name a construct; `try/finally` is the shortest that does. */
const REASON_FLOOR = 8;

let eslint: ESLint;
let population: { file: string; text: string; targets: ProbeTarget[] }[];

beforeAll(() => {
  eslint = createEslint();
  population = sourceFiles()
    .map((file) => {
      const text = read(file);
      return { file, text, targets: probeTargets(file, text) };
    })
    .filter((entry) => entry.targets.length > 0);
});

describe("React Compiler coverage", () => {
  it("keeps the rules that name a bail switched on", async () => {
    const config = await eslint.calculateConfigForFile(
      path.join(process.cwd(), "components/piscine/TopBar.tsx"),
    );
    // The preset leaves these off; `eslint.config.mjs` turns them on so a
    // stop has a diagnostic in `npm run lint`. Switching one back off would
    // not fail the sweep below, only make its findings harder to read.
    expect(config.rules?.[EFFECT_RULE]?.[0]).toBe(2);
    expect(config.rules?.["react-hooks/todo"]?.[0]).toBeGreaterThanOrEqual(1);
    expect(config.rules?.["react-hooks/rule-suppression"]?.[0]).toBeGreaterThanOrEqual(1);
    expect(config.rules?.["react-hooks/no-deriving-state-in-effects"]?.[0]).toBeGreaterThanOrEqual(1);
  });

  it("enumerates the app rather than a fixed list", () => {
    const keys = population.flatMap((entry) => entry.targets.map((t) => t.key));

    // Floors, not exact counts: an enumerator that lost a directory or a
    // function shape would pass an exact count just as silently as it would
    // a vacuous one. The named members are the ones this epic is about.
    expect(population.length).toBeGreaterThanOrEqual(250);
    expect(keys.length).toBeGreaterThanOrEqual(400);
    expect(keys).toContain("app/projects/[projectId]/sessions/page.tsx#SessionsPage");
    expect(keys).toContain("components/piscine/TopBar.tsx#TopBar");
    expect(keys).toContain("components/desk/NowDesk.tsx#NowDesk");
    expect(keys).toContain("hooks/useAgentPolling.ts#useAgentPolling");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("probe control: reports inside a component it reads, and only there", async () => {
    /*
      The probe's own regression test, on synthetic sources under a real path
      so the repository config applies. A probe the compiler also bails on
      would prove nothing, so both directions are pinned: a plain component
      reports, and the same component with a `finally` clause — the construct
      behind most of the debt below — goes dark with no error of its own.
    */
    const file = "components/__probe_control__.tsx";
    const open = `"use client";\nimport { useState, useEffect } from "react";\n\nexport function Control() {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    void 0;\n  }, []);\n  return <button onClick={() => setN(n + 1)}>{n}</button>;\n}\n`;
    const dark = open.replace(
      "  useEffect(() => {\n    void 0;\n  }, []);",
      "  useEffect(() => {\n    try {\n      void 0;\n    } catch {\n      void 0;\n    } finally {\n      void 0;\n    }\n  }, []);",
    );
    expect(dark).not.toBe(open);

    const openTargets = probeTargets(file, open);
    expect(openTargets.map((t) => t.key)).toEqual([`${file}#Control`]);
    const onOpen = await probeFile(eslint, file, open, openTargets);
    expect(onOpen.parseErrors).toEqual([]);
    expect(onOpen.bailed).toEqual([]);

    const darkTargets = probeTargets(file, dark);
    const onDark = await probeFile(eslint, file, dark, darkTargets);
    expect(onDark.parseErrors).toEqual([]);
    expect(onDark.bailed.map((t) => t.key)).toEqual([`${file}#Control`]);
    await expect(bailReason(file, dark, darkTargets[0])).resolves.toMatch(/finally/);
  }, 30_000);

  it("plants every probe on its own line and finds it again", () => {
    const entry = population.find((e) => e.targets.length >= 3)!;
    const probed = withProbes(entry.text, entry.targets);
    const lines = probed.text.split("\n");
    for (const target of entry.targets) {
      const line = probed.probeLine.get(target.key)!;
      expect(lines[line - 1]).toContain("__setProbe(1)");
    }
    expect(new Set(probed.probeLine.values()).size).toBe(entry.targets.length);
  });

  it("reads every component and hook, or says which it cannot", async () => {
    const bailed: ProbeTarget[] = [];
    const parseErrors: string[] = [];
    let analysed = 0;
    for (const entry of population) {
      const verdict = await probeFile(eslint, entry.file, entry.text, entry.targets);
      parseErrors.push(...verdict.parseErrors);
      analysed += verdict.analysed.length;
      bailed.push(...verdict.bailed);
    }
    expect(parseErrors).toEqual([]);

    const probeable = analysed + bailed.length;
    const files = population.length;
    // The population, for the record — the counts a review should quote are
    // these, not the delta from the last sweep.
    console.info(
      `react-compiler coverage: ${files} files, ${probeable} probeable functions, ${analysed} analysed, ${bailed.length} bailed`,
    );

    const known = new Set(Object.keys(KNOWN_BAILED));
    const unexpected = bailed.filter((t) => !known.has(t.key));
    const explained: string[] = [];
    for (const target of unexpected) {
      const text = population.find((e) => e.file === target.file)!.text;
      explained.push(`${target.key} (line ${target.line}): ${await bailReason(target.file, text, target)}`);
    }
    /*
      A function here is one the compiler stopped on — its own reason is
      printed beside it. Either rewrite the construct (and fix whatever the
      newly-read function then reports), or add the entry to `KNOWN_BAILED`
      with that reason. Silence is not an option; that was the bug.
    */
    expect(explained, "components the compiler stopped reading").toEqual([]);

    const bailedKeys = new Set(bailed.map((t) => t.key));
    const stale = [...known].filter((key) => !bailedKeys.has(key));
    // Shrinking the debt must fail this test on purpose: delete the entry and
    // keep the win, so the list never claims more darkness than there is.
    expect(stale, "KNOWN_BAILED entries whose probe reports again — delete them").toEqual([]);
  }, 180_000);

  it("keeps a default export the compiler cannot name in the population", async () => {
    /*
      The enumeration used to agree with the compiler about which functions
      HAVE a name, and that is the one thing it must not do. `getFunctionName`
      returns null for `export default function () {}` and for
      `export default () => {}`, so `getComponentOrHookLike` never takes them
      for a component and no compiler rule ever runs inside them — and the
      walk here, mirroring the same inference, dropped them from the
      population instead of reporting them as unread. Renaming any page to an
      anonymous default export therefore silenced every compiler rule in it
      and left this sweep green, which is precisely the bug the sweep exists
      to make impossible.

      The mutation is applied in memory to a real page, so the loss is
      measured on a file it could actually happen to. A lowercase name is the
      same hole with a name attached: `export default function page()` is
      neither PascalCase nor `use`-prefixed, so the compiler declines it just
      as silently.
    */
    const file = "app/projects/new/page.tsx";
    const named = read(file);
    const declaration = "export default function NewProjectPage(";
    expect(named).toContain(declaration);

    const before = probeTargets(file, named);
    expect(before.map((t) => t.key)).toContain(`${file}#NewProjectPage`);

    const mutants: [string, string, RegExp][] = [
      ["anonymous declaration", "export default function (", /anonymous/i],
      ["lowercase declaration", "export default function page(", /page/],
    ];
    for (const [label, replacement, reason] of mutants) {
      const mutated = named.replace(declaration, replacement);
      expect(mutated, label).not.toBe(named);

      // The population must not shrink: the component is still a component,
      // it is merely one the compiler will not read.
      const after = probeTargets(file, mutated);
      expect(after.length, `${label} lost a target`).toBe(before.length);
      const target = after.find((t) => t.line === before[0].line)!;
      expect(target, label).toBeDefined();
      expect(target.key, label).not.toBe(`${file}#NewProjectPage`);
      expect(target.key, label).toMatch(/^(app|components|hooks|lib)\/.+#\S+$/);

      // ...and it has to come back as unread, not as clean, so an entry in
      // `KNOWN_BAILED` is the only way to a green sweep.
      const verdict = await probeFile(eslint, file, mutated, [target]);
      expect(verdict.parseErrors, label).toEqual([]);
      expect(verdict.bailed.map((t) => t.key), label).toEqual([target.key]);
      expect(Object.keys(KNOWN_BAILED), label).not.toContain(target.key);
      await expect(bailReason(file, mutated, target), label).resolves.toMatch(reason);
    }

    // The arrow form of the same loss.
    const arrow = `"use client";\nimport { useState, useEffect } from "react";\n\nexport default () => {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    void 0;\n  }, []);\n  return <button onClick={() => setN(n + 1)}>{n}</button>;\n};\n`;
    const arrowFile = "app/projects/__probe_anon__/page.tsx";
    const arrowTargets = probeTargets(arrowFile, arrow);
    expect(arrowTargets).toHaveLength(1);
    const onArrow = await probeFile(eslint, arrowFile, arrow, arrowTargets);
    expect(onArrow.parseErrors).toEqual([]);
    expect(onArrow.bailed.map((t) => t.key)).toEqual(arrowTargets.map((t) => t.key));
  }, 60_000);

  it("names the construct behind every recorded bail", () => {
    for (const [key, reason] of Object.entries(KNOWN_BAILED)) {
      expect(reason.trim().length, `${key} needs a reason naming the construct`).toBeGreaterThanOrEqual(
        REASON_FLOOR,
      );
      expect(key).toMatch(/^(app|components|hooks|lib)\/.+#\S+$/);
    }
  });

  it("reads the Sessions page in particular", async () => {
    /*
      B-arij-212: a textbook `set-state-in-effect` planted here drew nothing
      while the same injection in `hooks/useAgentPolling.ts` was reported. Two
      stops hid it — an `eslint-disable` of `exhaustive-deps` on the load
      effect and a `finally` in `loadSessions` — and behind them an
      `immutability` error (the effect called `loadSessions` before its
      declaration). All three are gone; this keeps them gone by name, since
      the page's own lint result is what a review cites.
    */
    const file = "app/projects/[projectId]/sessions/page.tsx";
    const entry = population.find((e) => e.file === file)!;
    const page = entry.targets.filter((t) => t.name === "SessionsPage");
    expect(page).toHaveLength(1);
    const verdict = await probeFile(eslint, file, entry.text, page);
    expect(verdict.parseErrors).toEqual([]);
    expect(verdict.bailed).toEqual([]);
    expect(Object.keys(KNOWN_BAILED)).not.toContain(page[0].key);
  }, 30_000);
});
