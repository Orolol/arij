import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useQaFindings } from "@/hooks/useQaFindings";
import type { QaPayload } from "@/lib/qa/types";

afterEach(() => vi.unstubAllGlobals());

it("requests each project scope on the server and clears the previous coverage while loading", async () => {
  const pending = new Map<string, (response: Response) => void>();
  vi.stubGlobal("fetch", vi.fn((url: string) => new Promise<Response>((resolve) => {
    pending.set(url, resolve);
  })));
  const { result, rerender } = renderHook(
    ({ projectId }) => useQaFindings(projectId),
    { initialProps: { projectId: "first" } },
  );
  const firstUrl = "/api/qa/findings?projectId=first";
  await waitFor(() => expect(pending.has(firstUrl)).toBe(true));
  await act(async () => pending.get(firstUrl)!(Response.json({ data: { coveragePercent: 100 } })));
  expect(result.current.data?.coveragePercent).toBe(100);

  rerender({ projectId: "next & special" });
  expect(result.current.data).toBeNull();
  const nextUrl = "/api/qa/findings?projectId=next+%26+special";
  await waitFor(() => expect(pending.has(nextUrl)).toBe(true));
  const scoped = { coveragePercent: 0, rubric: { items: [] } } satisfies Partial<QaPayload>;
  await act(async () => pending.get(nextUrl)!(Response.json({ data: scoped })));
  expect(result.current.data).toEqual(scoped);
});
