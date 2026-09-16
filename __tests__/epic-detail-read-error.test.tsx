/**
 * A failed READ of a ticket names a failed read (audit 2026-09-10, lot 05,
 * #134 follow-up).
 *
 * `useEpicDetail` handed its detail and verification reads the error copy of
 * its PATCH, so a network failure while merely opening a ticket told the user
 * "Network error — the update was not applied" in the overlay's pending block.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEpicDetail } from "@/hooks/useEpicDetail";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useEpicDetail read errors", () => {
  it("says the ticket could not be loaded when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const { result } = renderHook(() => useEpicDetail("proj-1", "epic-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Could not load the ticket");
    expect(result.current.error).not.toMatch(/update/i);
  });
});
