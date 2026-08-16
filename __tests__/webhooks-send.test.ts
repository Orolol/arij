import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock ignores
// column identity, so no fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

import {
  DEFAULT_APP_BASE_URL,
  WEBHOOK_TIMEOUT_MS,
  WEBHOOK_URL_SETTING_PREFIX,
  buildWebhookPayload,
  durationMsBetween,
  getAppBaseUrl,
  getProjectWebhookUrl,
  isHttpUrl,
  parseWebhookUrl,
  projectIdFromWebhookSettingKey,
  sendProjectWebhook,
  webhookSettingKey,
} from "@/lib/webhooks/send";

const originalBaseUrl = process.env.ARIJ_BASE_URL;

/** Seeds the two `.get()` reads sendProjectWebhook performs: settings, project. */
function seedConfiguredProject(url: string, projectName = "My Project") {
  dbMockState.getQueue.push({ key: "webhook_url:p1", value: JSON.stringify(url) });
  dbMockState.getQueue.push({ name: projectName });
}

function lastFetchBody(): Record<string, unknown> {
  const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  const init = mock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMockState();
  delete process.env.ARIJ_BASE_URL;
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalBaseUrl === undefined) {
    delete process.env.ARIJ_BASE_URL;
  } else {
    process.env.ARIJ_BASE_URL = originalBaseUrl;
  }
});

describe("settings key helpers", () => {
  it("round-trips a project id through the settings key", () => {
    const key = webhookSettingKey("p1");
    expect(key).toBe(`${WEBHOOK_URL_SETTING_PREFIX}p1`);
    expect(projectIdFromWebhookSettingKey(key)).toBe("p1");
  });

  it("ignores unrelated settings keys", () => {
    expect(projectIdFromWebhookSettingKey("github_pat")).toBeNull();
    expect(projectIdFromWebhookSettingKey(WEBHOOK_URL_SETTING_PREFIX)).toBeNull();
  });
});

describe("isHttpUrl()", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("http://localhost:8080/hook")).toBe(true);
    expect(isHttpUrl("https://ntfy.sh/my-topic")).toBe(true);
  });

  it("rejects other schemes and garbage", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("ntfy.sh/my-topic")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("parseWebhookUrl()", () => {
  it("parses JSON-encoded and bare string values", () => {
    expect(parseWebhookUrl(JSON.stringify("https://ntfy.sh/a"))).toBe(
      "https://ntfy.sh/a"
    );
    expect(parseWebhookUrl("https://ntfy.sh/b")).toBe("https://ntfy.sh/b");
  });

  it("returns null for blank, non-string and non-http values", () => {
    expect(parseWebhookUrl(JSON.stringify("   "))).toBeNull();
    expect(parseWebhookUrl(JSON.stringify({ url: "https://x.dev" }))).toBeNull();
    expect(parseWebhookUrl(undefined)).toBeNull();
    expect(parseWebhookUrl(JSON.stringify("ftp://x.dev/hook"))).toBeNull();
  });
});

describe("getProjectWebhookUrl()", () => {
  it("returns null when no row exists", () => {
    expect(getProjectWebhookUrl("p1")).toBeNull();
  });

  it("returns the stored URL", () => {
    dbMockState.getQueue.push({
      key: "webhook_url:p1",
      value: JSON.stringify("https://ntfy.sh/arij"),
    });
    expect(getProjectWebhookUrl("p1")).toBe("https://ntfy.sh/arij");
  });
});

describe("getAppBaseUrl()", () => {
  it("falls back to the localhost constant", () => {
    expect(getAppBaseUrl()).toBe(DEFAULT_APP_BASE_URL);
  });

  it("honours ARIJ_BASE_URL and strips trailing slashes", () => {
    process.env.ARIJ_BASE_URL = "https://arij.local:4000///";
    expect(getAppBaseUrl()).toBe("https://arij.local:4000");
  });
});

describe("durationMsBetween()", () => {
  it("computes elapsed milliseconds", () => {
    expect(
      durationMsBetween("2026-08-16T10:00:00.000Z", "2026-08-16T10:00:12.500Z")
    ).toBe(12500);
  });

  it("returns null for missing, unparsable or inverted timestamps", () => {
    expect(durationMsBetween(null, "2026-08-16T10:00:00.000Z")).toBeNull();
    expect(durationMsBetween("2026-08-16T10:00:00.000Z", null)).toBeNull();
    expect(durationMsBetween("nope", "2026-08-16T10:00:00.000Z")).toBeNull();
    expect(
      durationMsBetween("2026-08-16T10:00:12.000Z", "2026-08-16T10:00:00.000Z")
    ).toBeNull();
  });
});

describe("buildWebhookPayload()", () => {
  it("omits absent optional context", () => {
    expect(
      buildWebhookPayload("p1", "My Project", { event: "release.created" })
    ).toEqual({
      event: "release.created",
      projectId: "p1",
      projectName: "My Project",
      url: `${DEFAULT_APP_BASE_URL}/projects/p1`,
    });
  });

  it("keeps a zero duration but drops a null one", () => {
    expect(
      buildWebhookPayload("p1", "P", { event: "session.completed", durationMs: 0 })
        .durationMs
    ).toBe(0);
    expect(
      buildWebhookPayload("p1", "P", {
        event: "session.completed",
        durationMs: null,
      }).durationMs
    ).toBeUndefined();
  });

  it("ignores a relative path and falls back to the project board", () => {
    expect(
      buildWebhookPayload("p1", "P", {
        event: "session.completed",
        path: "projects/evil",
      }).url
    ).toBe(`${DEFAULT_APP_BASE_URL}/projects/p1`);
  });
});

describe("sendProjectWebhook()", () => {
  it("no-ops when the project has no webhook configured", async () => {
    await sendProjectWebhook("p1", { event: "session.completed" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("POSTs the full JSON body with a deep link", async () => {
    seedConfiguredProject("https://ntfy.sh/arij");

    await sendProjectWebhook("p1", {
      event: "session.completed",
      ticketTitle: "Login feature",
      epicId: "e1",
      sessionId: "s1",
      durationMs: 42000,
      path: "/projects/p1/sessions/s1",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [target, init] = mock.mock.calls[0] as [string, RequestInit];

    expect(target).toBe("https://ntfy.sh/arij");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(lastFetchBody()).toEqual({
      event: "session.completed",
      projectId: "p1",
      projectName: "My Project",
      ticketTitle: "Login feature",
      epicId: "e1",
      sessionId: "s1",
      durationMs: 42000,
      url: "http://localhost:3000/projects/p1/sessions/s1",
    });
  });

  it("keeps every detail in the body — nothing is appended to the target URL", async () => {
    seedConfiguredProject("https://ntfy.sh/arij");

    await sendProjectWebhook("p1", {
      event: "session.failed",
      sessionId: "s-secret",
      error: "boom",
    });

    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls[0][0]).toBe("https://ntfy.sh/arij");
    expect(lastFetchBody().error).toBe("boom");
  });

  it("wires a 3s AbortSignal.timeout into the request", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    seedConfiguredProject("https://ntfy.sh/arij");

    await sendProjectWebhook("p1", { event: "release.created" });

    expect(WEBHOOK_TIMEOUT_MS).toBe(3000);
    expect(timeoutSpy).toHaveBeenCalledWith(3000);
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = mock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("swallows transport failures (timeout/abort) and warns", async () => {
    seedConfiguredProject("https://ntfy.sh/arij");
    global.fetch = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        })
      );

    await expect(
      sendProjectWebhook("p1", { event: "session.failed" })
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("swallows non-2xx responses and warns", async () => {
    seedConfiguredProject("https://ntfy.sh/arij");
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(
      sendProjectWebhook("p1", { event: "session.completed" })
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("HTTP 500")
    );
  });

  it("still delivers when the project row is missing", async () => {
    dbMockState.getQueue.push({
      key: "webhook_url:p1",
      value: JSON.stringify("https://ntfy.sh/arij"),
    });

    await sendProjectWebhook("p1", { event: "session.completed" });

    expect(lastFetchBody().projectName).toBe("");
  });
});
