/**
 * Ask the React Compiler's lint rules whether they READ a component or hook —
 * by mutation, because nothing else can tell.
 *
 * `eslint-plugin-react-hooks` 7.x runs the React Compiler over every file and
 * turns the errors it logs into lint diagnostics. Whenever the compiler stops
 * on a function — an unimplemented construct, a suppressed sibling rule, a
 * validation that throws before the others run — every compiler-backed rule
 * is silent on that function, and the categories that describe the stop are
 * off in the plugin's preset. A function nobody read and a clean one both
 * report zero errors. Measured on 7.0.1, still true of 7.1.1.
 *
 * So this helper injects a self-contained violation
 *
 *     const [__probe, __setProbe] = useState(0);
 *     useEffect(() => { __setProbe(1); }, []);
 *
 * at the top of each function the compiler ought to analyse, lints the result
 * with the repository's own ESLint config, and asks one question per
 * function: did `react-hooks/set-state-in-effect` fire on the probe's line?
 * Yes means the compiler entered the function and ran its validations. No
 * means the function is dark, and `bailReason` then asks the compiler itself
 * why, through the plugin's event log.
 *
 * WHICH FUNCTIONS. The compiler decides what to compile by inference — a
 * PascalCase or `use*` name, own-level hook calls or JSX, props-shaped
 * parameters, a node-shaped last return — and never descends into a function
 * it has queued. `probeTargets` replicates that walk with the TypeScript
 * parser (already a direct dependency; a regex over TSX drops sites without
 * saying so, see `class-list-scan.ts`), so the population it reports is the
 * population the compiler would consider, minus nothing. A candidate with
 * the name and the hooks or JSX that the inference then rejects (a rest
 * parameter, a bare last `return;`) is still listed — with the rejection as
 * its reason — because a component the compiler declines to recognise is
 * exactly as unread as one it stops on. The same goes for a default export
 * the compiler cannot name at all (`export default function () {}`) or names
 * outside its conventions: mirroring the inference is the point, agreeing
 * with it about what EXISTS would let a rename delete a component from the
 * population and take every rule inside it with it.
 *
 * It lives in `__tests__/helpers/` on purpose: vitest's include glob is
 * `**\/*.test.{ts,tsx,mjs}`, so nothing here is collected as a test.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ESLint, type Linter, type Rule } from "eslint";
import nextVitals from "eslint-config-next/core-web-vitals";

export const ROOTS = ["app", "components", "hooks", "lib"] as const;

export const EFFECT_RULE = "react-hooks/set-state-in-effect";

/* ------------------------------------------------------------------ */
/* Enumeration                                                         */
/* ------------------------------------------------------------------ */

export interface ProbeTarget {
  /** Repository-relative path, forward slashes. */
  file: string;
  /** `file#name` — the key `KNOWN_BAILED` uses. */
  key: string;
  name: string;
  kind: "Component" | "Hook";
  /** 1-based line of the function keyword / arrow start. */
  line: number;
  /** 1-based line of the function's closing brace or expression end. */
  endLine: number;
  /**
   * Why the compiler's own inference would decline this function, if it
   * would. Empty for a function the compiler queues.
   */
  declined: string[];
  /** Where the probe goes: `block` after the `{` and any directives. */
  body:
    | { kind: "block"; insertAt: number }
    | { kind: "expression"; start: number; end: number };
}

const isHookName = (name: string) => /^use[A-Z0-9]/.test(name);
const isComponentName = (name: string) => /^[A-Z]/.test(name);

type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

const isCandidateFn = (node: ts.Node): node is Fn =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node);

/**
 * The compiler skips nested functions when it looks for hooks, JSX and
 * returns: this walks a function's own level and stops at any inner function
 * or class, like its `skipNestedFunctions`.
 */
function walkOwn(node: ts.Node, visit: (child: ts.Node) => void): void {
  ts.forEachChild(node, (child) => {
    if (ts.isFunctionLike(child) || ts.isClassLike(child)) return;
    visit(child);
    walkOwn(child, visit);
  });
}

/** `useX(...)` or `Namespace.useX(...)` — the compiler's `isHook`. */
function isHookCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return isHookName(callee.text);
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.name) &&
    isHookName(callee.name.text) &&
    ts.isIdentifier(callee.expression) &&
    isComponentName(callee.expression.text)
  );
}

const isJsx = (node: ts.Node) =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);

function callsHooksOrCreatesJsx(fn: Fn): boolean {
  let found = false;
  walkOwn(fn, (node) => {
    if (isHookCall(node) || isJsx(node)) found = true;
  });
  return found;
}

function functionName(fn: Fn): string | null {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? null;
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === fn && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === fn &&
    ts.isIdentifier(parent.left)
  ) {
    return parent.left.text;
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === fn && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return null;
}

const isReactApiCall = (node: ts.Node, api: string): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ((ts.isIdentifier(node.expression) && node.expression.text === api) ||
    (ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "React" &&
      node.expression.name.text === api));

const NON_NODE_TYPES = new Set([
  ts.SyntaxKind.ArrayType,
  ts.SyntaxKind.BigIntKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.ConstructorType,
  ts.SyntaxKind.FunctionType,
  ts.SyntaxKind.LiteralType,
  ts.SyntaxKind.NeverKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.SymbolKeyword,
  ts.SyntaxKind.TupleType,
]);

/** The compiler's `isValidComponentParams`, returning why it fails. */
function invalidParams(fn: Fn): string | null {
  const params = fn.parameters;
  if (params.length === 0) return null;
  if (params.length > 2) return `${params.length} parameters (a component takes props and an optional ref)`;
  const first = params[0];
  if (first.type && NON_NODE_TYPES.has(first.type.kind)) {
    return `first parameter typed ${ts.SyntaxKind[first.type.kind]}, which is not a props object`;
  }
  if (params.length === 1) {
    return first.dotDotDotToken ? "a rest parameter where props should be" : null;
  }
  const second = params[1];
  if (ts.isIdentifier(second.name) && /ref|Ref/.test(second.name.text)) return null;
  return "a second parameter that is not named as a ref";
}

/**
 * `export default function …`, named or not — including
 * `export default () => …`.
 *
 * The compiler names a function through `getFunctionName`, and a function it
 * cannot name is one `getComponentOrHookLike` never takes for a component. So
 * is one whose name is neither PascalCase nor `use`-prefixed. Mirroring that
 * inference is right; agreeing with it about what EXISTS is not — the
 * function would vanish from the population instead of being reported as
 * unread, and renaming any page to `export default function ()` would silence
 * every compiler rule inside it with the sweep still green. A default export
 * is a top-level entry point, never a callback the compiler folds into a
 * queued parent, so enumerating it costs nothing and closes that hole.
 */
function isDefaultExport(fn: Fn): boolean {
  if (ts.isFunctionDeclaration(fn)) {
    const modifiers = ts.getModifiers(fn) ?? [];
    return (
      modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    );
  }
  return ts.isExportAssignment(fn.parent) && fn.parent.isExportEquals !== true;
}

const unparen = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ? unparen(node.expression) : node;

/** The compiler's `isNonNode`: what it refuses to accept as a rendered value. */
function nonNode(expr: ts.Expression | undefined): string | null {
  if (expr === undefined) return "a bare `return;`";
  const inner = unparen(expr);
  if (ts.isObjectLiteralExpression(inner)) return "an object literal";
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return "a function";
  if (ts.isBigIntLiteral(inner)) return "a bigint";
  if (ts.isClassExpression(inner)) return "a class";
  if (ts.isNewExpression(inner)) return "a `new` expression";
  return null;
}

/**
 * The compiler's `returnsNonNode` — note it keeps only the LAST own-level
 * return's verdict, so an early `return;` is harmless and a trailing one is
 * not.
 */
function returnsNonNode(fn: Fn): string | null {
  let verdict: string | null = null;
  let line: number | null = null;
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
    verdict = nonNode(fn.body);
    line = lineOf(fn.body);
  }
  walkOwn(fn, (node) => {
    if (ts.isReturnStatement(node)) {
      verdict = nonNode(node.expression);
      line = lineOf(node);
    }
  });
  return verdict ? `last return (line ${line}) is ${verdict}, not a node` : null;
}

function lineOf(node: ts.Node): number {
  return node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

/**
 * Mirrors `getComponentOrHookLike`: the compiler's own answer to "is this a
 * component or a hook", plus the reasons it would say no.
 */
function inferType(fn: Fn): { kind: "Component" | "Hook"; name: string; declined: string[] } | null {
  const name = functionName(fn);
  // The compiler's first gate, and this population's: a PascalCase function
  // with no own-level hook call or JSX is not a component — a Next route
  // handler named `GET` or `POST` would otherwise count as an unread one.
  if (!callsHooksOrCreatesJsx(fn)) return null;
  if (name !== null && isComponentName(name)) {
    const declined: string[] = [];
    const params = invalidParams(fn);
    if (params) declined.push(params);
    const returns = returnsNonNode(fn);
    if (returns) declined.push(returns);
    return { kind: "Component", name, declined };
  }
  if (name !== null && isHookName(name)) {
    return { kind: "Hook", name, declined: [] };
  }
  if (
    (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) &&
    (isReactApiCall(fn.parent, "memo") || isReactApiCall(fn.parent, "forwardRef"))
  ) {
    const api = isReactApiCall(fn.parent, "memo") ? "memo" : "forwardRef";
    return { kind: "Component", name: name ?? `(${api}-callback)`, declined: [] };
  }
  // Everything above is the compiler's inference; this is the population's
  // own floor. A default export that renders is a component whatever the
  // compiler manages to call it, so it is listed — with the naming as its
  // reason — rather than dropped.
  if (isDefaultExport(fn)) {
    return {
      kind: "Component",
      name: name ?? "(anonymous-default)",
      declined: [
        name === null
          ? "an anonymous `export default`: the compiler names a function before it takes it for a component, and there is no name to take"
          : `an \`export default\` named \`${name}\`, which is neither PascalCase nor \`use\`-prefixed`,
      ],
    };
  }
  return null;
}

function probeBody(fn: Fn, sf: ts.SourceFile): ProbeTarget["body"] | null {
  const body = fn.body;
  if (!body) return null;
  if (ts.isBlock(body)) {
    // Directives (`"use client"` inside a body) must stay first.
    let insertAt = body.getStart(sf) + 1;
    for (const statement of body.statements) {
      if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
        insertAt = statement.getEnd();
      } else break;
    }
    return { kind: "block", insertAt };
  }
  return { kind: "expression", start: body.getStart(sf), end: body.getEnd() };
}

/**
 * Every function in `text` the compiler would consider, outermost only — a
 * candidate nested in a queued one is compiled as part of its parent, and a
 * probe inside it would be a hook call in a nested function: a violation of
 * its own that stops the parent.
 */
export function probeTargets(file: string, text: string): ProbeTarget[] {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const targets: ProbeTarget[] = [];
  const seen = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node)) return;
    if (isCandidateFn(node)) {
      const inferred = inferType(node);
      if (inferred) {
        const body = probeBody(node, sf);
        if (body) {
          // Two same-named functions in one file (an overload, a re-export
          // shim) get distinct keys rather than one masking the other.
          const n = (seen.get(inferred.name) ?? 0) + 1;
          seen.set(inferred.name, n);
          const name = n === 1 ? inferred.name : `${inferred.name}#${n}`;
          targets.push({
            file,
            key: `${file}#${name}`,
            name,
            kind: inferred.kind,
            line: lineOf(node),
            endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
            declined: inferred.declined,
            body,
          });
          // The compiler queues it and does not descend; neither do we.
          if (inferred.declined.length === 0) return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return targets;
}

const IGNORED_FILE = /(\.test\.tsx?|\.d\.ts)$/;

/** Every `.ts`/`.tsx` source file under `ROOTS`, sorted, forward slashes. */
export function sourceFiles(cwd = process.cwd()): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(cwd, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name) && !IGNORED_FILE.test(entry.name)) out.push(rel);
    }
  };
  for (const root of ROOTS) walk(root);
  return out.sort();
}

/* ------------------------------------------------------------------ */
/* Probing                                                             */
/* ------------------------------------------------------------------ */

const PROBE =
  "const [__probe, __setProbe] = useState(0); useEffect(() => { __setProbe(1); }, []); void __probe;";

/**
 * The same source with the probe planted in every target at once — one lint
 * per file. Each probe sits on its own line, which is how a diagnostic is
 * attributed back to its target.
 */
export function withProbes(
  text: string,
  targets: ProbeTarget[],
): { text: string; probeLine: Map<string, number> } {
  // Splice from the end so earlier offsets stay valid.
  const ordered = [...targets].sort((a, b) => offsetOf(b) - offsetOf(a));
  let out = text;
  for (const target of ordered) {
    if (target.body.kind === "block") {
      const at = target.body.insertAt;
      out = `${out.slice(0, at)}\n${PROBE}\n${out.slice(at)}`;
    } else {
      const { start, end } = target.body;
      out = `${out.slice(0, start)}{\n${PROBE}\nreturn (${out.slice(start, end)}); }${out.slice(end)}`;
    }
  }
  // Probes were inserted in source order, and each sits alone on its line.
  const probeLine = new Map<string, number>();
  const lines = out.split("\n");
  const inOrder = [...targets].sort((a, b) => offsetOf(a) - offsetOf(b));
  let cursor = 0;
  for (const target of inOrder) {
    const index = lines.findIndex((line, i) => i >= cursor && line === PROBE);
    if (index < 0) throw new Error(`probe for ${target.key} lost in the splice`);
    probeLine.set(target.key, index + 1);
    cursor = index + 1;
  }
  return { text: out, probeLine };
}

const offsetOf = (target: ProbeTarget) =>
  target.body.kind === "block" ? target.body.insertAt : target.body.start;

export interface ProbeVerdict {
  /** Targets whose probe drew the diagnostic. */
  analysed: ProbeTarget[];
  /** Targets whose probe drew nothing — the compiler never validated them. */
  bailed: ProbeTarget[];
  /** A parse failure would read as silence, so it is surfaced instead. */
  parseErrors: string[];
}

export function createEslint(cwd = process.cwd()): ESLint {
  return new ESLint({ cwd });
}

export async function probeFile(
  eslint: ESLint,
  file: string,
  text: string,
  targets: ProbeTarget[],
  cwd = process.cwd(),
): Promise<ProbeVerdict> {
  const probed = withProbes(text, targets);
  const [result] = await eslint.lintText(probed.text, { filePath: path.join(cwd, file) });
  const parseErrors = result.messages
    .filter((m) => !m.ruleId && m.severity === 2)
    .map((m) => `${file}:${m.line} ${m.message}`);
  const reported = new Set(
    result.messages.filter((m) => m.ruleId === EFFECT_RULE).map((m) => m.line),
  );
  const analysed: ProbeTarget[] = [];
  const bailed: ProbeTarget[] = [];
  for (const target of targets) {
    (reported.has(probed.probeLine.get(target.key)!) ? analysed : bailed).push(target);
  }
  return { analysed, bailed, parseErrors };
}

/* ------------------------------------------------------------------ */
/* Reasons                                                             */
/* ------------------------------------------------------------------ */

/**
 * The plugin logs every compiler event — `CompileSuccess`, `CompileError`
 * with its category and reason, `CompileSkip` — to the `logger` in a rule's
 * first option, and reports only the categories its preset maps to rules.
 * Rule options are structured-cloned by ESLint, so a function cannot ride in
 * config; a local plugin whose rule delegates to the real one with an injected
 * options object gets the same events without touching the config.
 */
interface CompilerEvent {
  kind: string;
  fnLoc?: { start: { line: number } } | null;
  fnName?: string | null;
  reason?: string;
  data?: unknown;
  detail?: {
    category: string;
    reason?: string | null;
    loc?: { start: { line: number } } | null;
    primaryLocation?: () => { start: { line: number } } | null | symbol;
  };
}

function reactHooksPlugin(): { rules: Record<string, Rule.RuleModule> } {
  for (const entry of nextVitals as Linter.Config[]) {
    const plugin = entry.plugins?.["react-hooks"];
    if (plugin?.rules) return plugin as { rules: Record<string, Rule.RuleModule> };
  }
  throw new Error("eslint-config-next no longer registers eslint-plugin-react-hooks");
}

/**
 * Why the compiler did not validate `target`: its own words, from the event
 * log of a lint of the file with the probe in that one function. Returns the
 * inference's objection when the compiler never even entered the function.
 */
export async function bailReason(
  file: string,
  text: string,
  target: ProbeTarget,
  cwd = process.cwd(),
): Promise<string> {
  if (target.declined.length > 0) {
    return `never entered — the compiler does not take it for a ${target.kind.toLowerCase()}: ${target.declined.join("; ")}`;
  }
  const events: CompilerEvent[] = [];
  const logger = { logEvent: (_file: string, event: CompilerEvent) => void events.push(event) };
  const real = reactHooksPlugin().rules["set-state-in-effect"];
  const probe: Rule.RuleModule = {
    meta: real.meta,
    create(context) {
      const delegated = Object.create(context, { options: { value: [{ logger }] } });
      return real.create(delegated);
    },
  };
  const eslint = new ESLint({
    cwd,
    overrideConfig: [{ plugins: { "compiler-probe": { rules: { events: probe } } }, rules: { "compiler-probe/events": "error" } }],
  });
  const probed = withProbes(text, [target]);
  await eslint.lintText(probed.text, { filePath: path.join(cwd, file) });

  const probeLine = probed.probeLine.get(target.key)!;
  // The probe adds two lines inside the function, so its end moves by two.
  const own = events.filter((event) => {
    const line = event.fnLoc?.start.line ?? event.detail?.loc?.start.line;
    return line != null && line >= target.line && line <= target.endLine + 2;
  });
  const describe = (event: CompilerEvent): string => {
    if (event.kind === "CompileError" && event.detail) {
      const loc = event.detail.loc?.start.line;
      const line = loc == null ? "" : ` @L${loc > probeLine ? loc - 2 : loc}`;
      return `${event.detail.category}: ${(event.detail.reason ?? "").replace(/\s+/g, " ")}${line}`;
    }
    if (event.kind === "CompileSuccess") return `CompileSuccess: ${event.fnName ?? ""}`;
    if (event.kind === "CompileSkip") return `CompileSkip: ${event.reason ?? ""}`;
    return `${event.kind}: ${String(event.data ?? "").split("\n")[0]}`;
  };
  const reasons = [...new Set(own.map(describe))];
  if (reasons.length === 0) {
    return "no compiler event for this function — the plugin never entered it (its Babel parse of the file may have failed, or the function sits inside one it already queued)";
  }
  return reasons.join(" | ");
}

export const read = (file: string, cwd = process.cwd()) =>
  readFileSync(path.join(cwd, file), "utf8");
