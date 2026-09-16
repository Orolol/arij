import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "@/lib/api/client";

afterEach(() => vi.unstubAllGlobals());

function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

describe("client JSON envelope", () => {
  it("refuses an error HTTP status even when its body contains data", async () => {
    respond({ data: { id: "unconfirmed" }, error: "Conflict", code: "STALE" }, 409);
    expect(await requestJson("/resource", { errorMessage: "Failed" }))
      .toEqual({ data: null, error: "Conflict", code: "STALE" });
  });

  it("requires an explicit validator to accept a nullable resource", async () => {
    respond({ data: null });
    expect(await requestJson("/resource", { errorMessage: "Failed" }))
      .toEqual({ data: null, error: "Failed" });
    expect(await requestJson("/resource", { errorMessage: "Failed", validateData: (value): value is null => value === null }))
      .toEqual({ data: null, error: null });
  });

  it("does not call a malformed successful response an HTTP 200 failure", async () => {
    respond({ unexpected: [] });
    const errorMessage = vi.fn(() => "Invalid response");
    expect(await requestJson("/resource", { errorMessage })).toEqual({ data: null, error: "Invalid response" });
    expect(errorMessage).toHaveBeenCalledWith(undefined);
  });

  it("normalizes unavailable transport and invalid JSON without accepting a write", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("not json")));
    for (let index = 0; index < 2; index++) {
      expect(await requestJson("/resource", { errorMessage: "Failed", method: "DELETE" }))
        .toEqual({ data: null, error: "Failed" });
    }
  });
});
