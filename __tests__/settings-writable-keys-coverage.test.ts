/**
 * The drift guard for `lib/settings/writable-keys.ts`.
 *
 * That allowlist is a hand-written COPY of constants that live next to the
 * features that read them, and this project has been bitten before by exactly
 * that shape: an invariant duplicated across two layers, where changing one
 * side leaves the other silently enforcing the old contract. Here the two
 * failure directions are asymmetric and both bad — a new setting that nobody
 * adds to the list is a settings screen that mysteriously refuses to save, and
 * a key that only ever appears in the list is an allowlist that has quietly
 * widened past anything the app defines.
 *
 * So the subject set is derived, not typed: every `*_SETTING_KEY` constant
 * declared under `lib/`, read out of the source. A key must then be classified
 * — writable, scopable, or explicitly server-managed. Nothing may be merely
 * absent.
 *
 * WHAT THIS DOES NOT GUARD: the VALUE side. It proves each key is classified,
 * never that the classification is the right one. Putting a dangerous key in
 * the writable list passes this file, and is a code-review question.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SERVER_MANAGED_SETTING_KEYS,
  WRITABLE_SCOPED_SETTING_KEYS,
  WRITABLE_SETTING_KEYS,
  isWritableSettingKey,
} from "@/lib/settings/writable-keys";

/**
 * `lib/` AND `components/`: four keys (`global_prompt` among them) are
 * declared client-side on purpose, because the module that would otherwise
 * own them imports better-sqlite3 and would drag the database into the client
 * bundle. Scanning only `lib/` would call those four orphans.
 */
const SCAN_ROOTS = ["lib", "components"].map((dir) =>
  path.resolve(__dirname, "..", dir),
);

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      yield full;
  }
}

/**
 * `export const SOMETHING_SETTING_KEY[_PREFIX] = "value";`, with the value
 * allowed to sit on the next line — several of them do, and a single-line
 * regex silently missed those, which is the "source-scanning loses sites"
 * trap this codebase keeps re-learning.
 */
const DECLARATION =
  /export const ([A-Z0-9_]+_SETTING(?:_KEY)?(?:_PREFIX)?)\s*=\s*"([^"]+)"/g;

function declaredSettingKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      const source = fs.readFileSync(file, "utf8").replace(/=\s*\n\s*"/g, '= "');
      for (const match of source.matchAll(DECLARATION)) {
        const [, constant, value] = match;
        // `webhook_url:` and `memory_provenance:` are declared as prefixes.
        found.set(
          value.replace(/:$/, ""),
          `${constant} (${path.relative(path.dirname(root), file)})`,
        );
      }
    }
  }
  return found;
}

describe("every settings key Arij defines is classified", () => {
  const declared = declaredSettingKeys();

  it("finds the constants at all", () => {
    // A scanner that matches nothing passes every assertion below it. Compare
    // against a hand-count floor before trusting its verdict.
    expect(declared.size).toBeGreaterThan(30);
    expect(declared.has("verify_commands")).toBe(true);
    expect(declared.has("webhook_url")).toBe(true);
  });

  it("classifies each one as writable or deliberately server-managed", () => {
    const classified = new Set([
      ...WRITABLE_SETTING_KEYS,
      ...SERVER_MANAGED_SETTING_KEYS,
    ]);
    const unclassified = [...declared.entries()]
      .filter(([key]) => !classified.has(key))
      .map(([key, where]) => `${key} — ${where}`);
    expect(unclassified).toEqual([]);
  });

  it("allowlists nothing the app does not define", () => {
    const orphans = WRITABLE_SETTING_KEYS.filter((key) => !declared.has(key));
    expect(orphans).toEqual([]);
  });

  it("keeps the scoped list a subset of the writable one", () => {
    const bare = new Set(WRITABLE_SETTING_KEYS);
    expect(
      WRITABLE_SCOPED_SETTING_KEYS.filter((key) => !bare.has(key)),
    ).toEqual([]);
  });

  it("never classifies a key as both writable and server-managed", () => {
    const writable = new Set(WRITABLE_SETTING_KEYS);
    expect(SERVER_MANAGED_SETTING_KEYS.filter((k) => writable.has(k))).toEqual(
      [],
    );
  });

  it("refuses the server-managed keys in both bare and scoped form", () => {
    for (const key of SERVER_MANAGED_SETTING_KEYS) {
      expect(isWritableSettingKey(key), key).toBe(false);
      expect(isWritableSettingKey(`${key}:proj1`), key).toBe(false);
    }
  });
});

describe("every per-project key the deletion sweep knows is writable", () => {
  it("accepts each one", async () => {
    // `perProjectSettingKeys` is the OTHER hand-maintained list of scoped
    // keys. If one of them is not writable here, the surface that sets it is
    // broken while the sweep that deletes it still works — a state nobody
    // would think to look for.
    const { perProjectSettingKeys } = await import(
      "@/lib/projects/project-settings-keys"
    );
    for (const key of perProjectSettingKeys("proj1")) {
      const base = key.slice(0, key.indexOf(":"));
      if (SERVER_MANAGED_SETTING_KEYS.includes(base)) continue;
      expect(isWritableSettingKey(key), key).toBe(true);
    }
  });
});
