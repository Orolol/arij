/**
 * Every `DialogContent` in the app owes an accessible description.
 *
 * Radix points a dialog's `aria-describedby` at an id it expects a
 * `DialogDescription` to render. A `DialogContent` that renders neither a
 * `DialogDescription` nor an explicit `aria-describedby` leaves that pointer
 * dangling: the dialog announces its title to a screen reader and nothing
 * else, and Radix warns on every single open.
 *
 * WHY THIS IS A SWEEP AND NOT ONE MORE ASSERTION IN THE DISMISS TEST. The
 * defect was found in `components/qa/DismissDialog.tsx`, but nothing about it
 * is specific to that file — it is a whole class, one instance per dialog
 * anyone adds. Rendering all twelve dialogs to check them costs a fixture per
 * dialog; reading the source costs nothing and catches the thirteenth.
 *
 * IT PARSES, IT DOES NOT GREP — the same rule `scripts/i18n/check-keys.mjs`
 * and `helpers/class-list-scan.ts` both state, each after a scanner lost sites
 * to its own guesswork. A text scan for `aria-describedby` cannot tell the
 * prop on the `DialogContent` from the same prop on a form control nested six
 * levels inside it, and `BugCreateDialog` had exactly that shape: an
 * `aria-describedby` on a screenshot hint, with the dialog itself undescribed.
 * That file reads as a false OK under grep and as a real miss under the AST.
 *
 * WHAT THIS GUARD DOES NOT PROVE. It proves a description element is present
 * in the subtree, not that the accessibility tree resolves it to useful text —
 * a `DialogDescription` rendered under a falsy branch satisfies this walk.
 * The rendered half is `qa-dismiss-dialog-description.test.tsx`, which queries
 * the dialog by its accessible name and description.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";

import { sourceFiles } from "./helpers/class-list-scan";

/** `<Foo>` / `<Foo />` — the tag as written, namespaces included. */
function tagNameOf(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText();
}

function isJsx(node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

interface DialogSite {
  file: string;
  line: number;
  described: boolean;
}

function dialogSites(file: string): DialogSite[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  const sites: DialogSite[] = [];

  const visit = (node: ts.Node): void => {
    if (isJsx(node) && tagNameOf(node) === "DialogContent") {
      const attributes = (ts.isJsxElement(node) ? node.openingElement : node)
        .attributes.properties;

      // The sanctioned opt-out: an explicit `aria-describedby` — including
      // `={undefined}` — tells Radix the dialog knowingly has nothing to
      // describe, and overrides the dangling default.
      const hasAriaAttribute = attributes.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText() === "aria-describedby",
      );

      // A `DialogDescription` anywhere beneath this content — Radix resolves
      // it through context, so nesting depth is irrelevant.
      let hasDescription = false;
      const walk = (child: ts.Node): void => {
        if (isJsx(child) && tagNameOf(child) === "DialogDescription") {
          hasDescription = true;
        }
        child.forEachChild(walk);
      };
      node.forEachChild(walk);

      sites.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        described: hasAriaAttribute || hasDescription,
      });
    }
    node.forEachChild(visit);
  };

  visit(source);
  return sites;
}

describe("every DialogContent has an accessible description", () => {
  // `sourceFiles()` walks app/, components/ and hooks/ and skips the vendored
  // shadcn primitives, which is where `DialogContent` is *defined* rather than
  // mounted.
  const files = sourceFiles().filter((file) =>
    readFileSync(file, "utf8").includes("<DialogContent"),
  );

  it("finds the dialogs to check", () => {
    // A pattern that silently matches nothing is a green test guarding
    // nothing; pin that the sweep still has a subject.
    expect(files.length).toBeGreaterThan(5);
  });

  it("leaves no DialogContent without a DialogDescription or aria-describedby", () => {
    const undescribed = files
      .flatMap(dialogSites)
      .filter((site) => !site.described)
      .map((site) => `${site.file}:${site.line}`);

    expect(undescribed).toEqual([]);
  });
});
