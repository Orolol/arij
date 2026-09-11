/**
 * The live-session screen's READ path (lot 07, reading side).
 *
 * - #113: the page polls only while the session is running or queued, with
 *   one last read at the transition — a finished session left open used to
 *   hit the detail route (and the actions scan) every 3 seconds forever.
 * - #231: the LIVE LOG opens on the END of the raw stream and walks back
 *   towards the head with `?stream=raw&before=`; a running session follows
 *   forward from the tail's cursor, with one last page when it stops.
 * - #237: `logs.json` is never on the polled payload; the export button and
 *   the pre-chunk-store fallback ask for it with `?include=logs`, on demand.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1", sessionId: "sess-1" }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

import SessionDetailPage from "@/app/projects/[projectId]/sessions/[sessionId]/page";

function chunk(sequence: number, content: string, extra: Record<string, unknown> = {}) {
  return {
    id: `chunk-${sequence}`,
    sessionId: "sess-1",
    streamType: "raw",
    sequence,
    chunkKey: `stdout:${sequence}`,
    content,
    createdAt: new Date().toISOString(),
    contentLength: content.length,
    contentTruncated: false,
    contentOffset: 0,
    ...extra,
  };
}

const baseSession = {
  id: "sess-12345678",
  status: "completed",
  mode: "code",
  provider: "claude-code",
  agentType: "build",
  startedAt: new Date(Date.now() - 60000).toISOString(),
  completedAt: new Date().toISOString(),
  createdAt: new Date(Date.now() - 120000).toISOString(),
  lastNonEmptyText: "All tests passed.",
  logsPath: "/data/sessions/sess-1/logs.json",
  chunkStreams: {
    raw: {
      chunks: [chunk(21, "tail line 21\n"), chunk(22, "tail line 22\n")],
      nextAfter: 22,
      nextOffset: 0,
      hasMore: false,
      firstSequence: 21,
      firstOffset: 0,
      lastSequence: 22,
      hasEarlier: true,
    },
  },
};

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

interface FetchScript {
  /** Detail payloads, consumed in order; the last one repeats. */
  sessions: Record<string, unknown>[];
  logs?: Record<string, unknown>;
  earlier?: Record<string, unknown>;
  /** Forward `?stream=raw&after=` pages, consumed in order; then empty. */
  forward?: Record<string, unknown>[];
  /** The detail read answers 404 (the session does not exist here). */
  missing?: boolean;
  /** Detail reads (1-based) that reject like a dropped connection. */
  failDetailReads?: number[];
}

function installFetch(script: FetchScript) {
  const queue = [...script.sessions];
  const forward = [...(script.forward ?? [])];
  let detailRead = 0;
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes("include=logs")) {
      return Promise.resolve(
        jsonResponse({ data: { ...script.sessions[0], ...script.logs } })
      );
    }
    if (url.includes("view=arij-actions")) {
      return Promise.resolve(
        jsonResponse({ data: { sessionId: "sess-1", actions: [], hasMore: false } })
      );
    }
    if (url.includes("/files")) {
      return Promise.resolve(jsonResponse({ data: null }));
    }
    if (url.includes("before=")) {
      return Promise.resolve(jsonResponse({ data: script.earlier }));
    }
    if (url.includes("stream=raw") && url.includes("after=") && forward.length > 0) {
      return Promise.resolve(jsonResponse({ data: forward.shift() }));
    }
    if (url.includes("stream=")) {
      return Promise.resolve(
        jsonResponse({
          data: {
            sessionId: "sess-1",
            streamType: "raw",
            chunks: [],
            nextAfter: 22,
            nextOffset: 0,
            hasMore: false,
          },
        })
      );
    }
    detailRead += 1;
    if (script.failDetailReads?.includes(detailRead)) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (script.missing) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Session not found" }),
      });
    }
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    // What `?omit=streams` does server-side: the row without its previews.
    if (url.includes("omit=streams")) {
      const { chunkStreams: _omitted, ...rest } = next as Record<string, unknown>;
      void _omitted;
      return Promise.resolve(jsonResponse({ data: rest }));
    }
    return Promise.resolve(jsonResponse({ data: next }));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Detail reads only — not stream pages, actions, files or the lazy extras. */
function detailReads(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = String(input);
    return /\/sessions\/sess-1(\?omit=streams)?$/.test(url);
  }).length;
}

/** The detail reads, by URL, in order. */
function detailUrls(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => /\/sessions\/sess-1(\?omit=streams)?$/.test(url));
}

const emptyRawSeed = {
  chunks: [],
  nextAfter: null,
  nextOffset: 0,
  hasMore: false,
  firstSequence: null,
  firstOffset: 0,
  lastSequence: null,
  hasEarlier: false,
};

function streamReads(fetchMock: ReturnType<typeof installFetch>, needle: string) {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = String(input);
    return url.includes("stream=raw") && url.includes(needle);
  });
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#113 — the page stops polling a finished session", () => {
  beforeEach(() => {
    // Only the intervals are faked: promises and RTL's own timers stay real.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  it("reads a completed session once and never polls it", async () => {
    const fetchMock = installFetch({ sessions: [baseSession] });
    render(<SessionDetailPage />);
    await screen.findByTestId("stream-raw");

    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });

    expect(detailReads(fetchMock)).toBe(1);
  });

  it("polls a queued session", async () => {
    const fetchMock = installFetch({
      sessions: [{ ...baseSession, status: "queued" }],
    });
    render(<SessionDetailPage />);
    await screen.findByTestId("stream-raw");

    await act(async () => {
      vi.advanceTimersByTime(6_100);
    });

    expect(detailReads(fetchMock)).toBeGreaterThanOrEqual(3);
  });

  it("polls while running, reads once more at the transition, then stops", async () => {
    const fetchMock = installFetch({
      sessions: [
        { ...baseSession, status: "running" },
        { ...baseSession, status: "running" },
        { ...baseSession, status: "completed" },
      ],
    });
    render(<SessionDetailPage />);
    await screen.findByText("Stop session");

    // Two polls: the second one sees the session completed.
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await waitFor(() => expect(screen.queryByText("Stop session")).toBeNull());
    // …and the transition earns exactly one more read.
    await waitFor(() => expect(detailReads(fetchMock)).toBe(4));

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(detailReads(fetchMock)).toBe(4);
  });

  it("gives the LIVE LOG one last forward page when the session stops", async () => {
    const fetchMock = installFetch({
      sessions: [
        { ...baseSession, status: "running" },
        { ...baseSession, status: "completed" },
      ],
    });
    render(<SessionDetailPage />);
    await screen.findByText("Stop session");
    const before = streamReads(fetchMock, "after=22").length;

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await waitFor(() => expect(screen.queryByText("Stop session")).toBeNull());

    // The stream's own interval fired once in the same tick as the poll that
    // flipped the page to finished; the final read comes after it, so what
    // the process wrote between the two is not left behind.
    await waitFor(() =>
      expect(streamReads(fetchMock, "after=22").length).toBe(before + 2)
    );
    const settled = streamReads(fetchMock, "after=").length;
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(streamReads(fetchMock, "after=").length).toBe(settled);
  });
});

describe("#231 — the LIVE LOG reads from the end", () => {
  it("offers the earlier output and prepends it on demand", async () => {
    const fetchMock = installFetch({
      sessions: [baseSession],
      earlier: {
        sessionId: "sess-1",
        streamType: "raw",
        chunks: [chunk(19, "earlier line 19\n"), chunk(20, "earlier line 20\n")],
        firstSequence: 19,
        firstOffset: 0,
        lastSequence: 20,
        hasEarlier: false,
      },
    });
    const user = userEvent.setup();
    render(<SessionDetailPage />);

    const card = await screen.findByTestId("stream-raw");
    expect(card).toHaveTextContent("tail line 22");
    // Nothing follows the end, so there is no forward button.
    expect(screen.queryByTestId("stream-load-more-raw")).toBeNull();

    await user.click(screen.getByTestId("stream-load-earlier-raw"));

    await waitFor(() => expect(card).toHaveTextContent("earlier line 19"));
    const calls = streamReads(fetchMock, "before=21");
    expect(calls).toHaveLength(1);
    // Prepended, in order, ahead of the tail it opened on.
    const text = card.textContent ?? "";
    expect(text.indexOf("earlier line 19")).toBeLessThan(text.indexOf("earlier line 20"));
    expect(text.indexOf("earlier line 20")).toBeLessThan(text.indexOf("tail line 21"));
    // The head is reached: the button goes away.
    await waitFor(() =>
      expect(screen.queryByTestId("stream-load-earlier-raw")).toBeNull()
    );
  });

  it("echoes the offset cursor for a chunk shown only by its end", async () => {
    const fetchMock = installFetch({
      sessions: [
        {
          ...baseSession,
          chunkStreams: {
            raw: {
              chunks: [
                chunk(5, "…the end of a big chunk\n", {
                  contentLength: 90_000,
                  contentOffset: 89_976,
                  contentTruncated: true,
                }),
              ],
              nextAfter: 5,
              nextOffset: 0,
              hasMore: false,
              firstSequence: 5,
              firstOffset: 89_976,
              lastSequence: 5,
              hasEarlier: true,
            },
          },
        },
      ],
      earlier: {
        sessionId: "sess-1",
        streamType: "raw",
        chunks: [],
        firstSequence: 1,
        firstOffset: 0,
        lastSequence: 5,
        hasEarlier: false,
      },
    });
    const user = userEvent.setup();
    render(<SessionDetailPage />);

    // A chunk shown by its end is shown only in part — said, not hidden.
    expect(await screen.findByTestId("stream-truncated-raw")).toBeInTheDocument();

    await user.click(screen.getByTestId("stream-load-earlier-raw"));
    await waitFor(() =>
      expect(streamReads(fetchMock, "before=5&beforeOffset=89976")).toHaveLength(1)
    );
  });
});

describe("#237 — logs.json only on demand", () => {
  it("exports logs.json through ?include=logs, not from the polled payload", async () => {
    const fetchMock = installFetch({
      sessions: [baseSession],
      logs: { logs: { success: true, result: "done" }, logsTruncated: false },
    });
    const user = userEvent.setup();
    render(<SessionDetailPage />);

    await user.click(await screen.findByText("Export Logs"));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes("include=logs"))
    ).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("says so when logs.json is too large to export here", async () => {
    installFetch({
      sessions: [baseSession],
      logs: { logs: null, logsTruncated: true },
    });
    const user = userEvent.setup();
    render(<SessionDetailPage />);

    await user.click(await screen.findByText("Export Logs"));

    expect(await screen.findByText(/too large to export/i)).toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("hides Export Logs for a session without a logs file", async () => {
    installFetch({ sessions: [{ ...baseSession, logsPath: null }] });
    render(<SessionDetailPage />);

    await screen.findByText("Session");
    expect(screen.queryByText("Export Logs")).not.toBeInTheDocument();
  });

  it("reads a pre-chunk-store session's logs.json only when asked", async () => {
    const fetchMock = installFetch({
      sessions: [
        {
          ...baseSession,
          chunkStreams: {
            raw: {
              chunks: [],
              nextAfter: null,
              nextOffset: 0,
              hasMore: false,
              firstSequence: null,
              firstOffset: 0,
              lastSequence: null,
              hasEarlier: false,
            },
          },
        },
      ],
      logs: {
        logs: { success: true, result: "legacy output from logs.json" },
        logsTruncated: false,
      },
    });
    const user = userEvent.setup();
    render(<SessionDetailPage />);

    const card = await screen.findByTestId("stream-raw");
    // The stored last line stands in until the file is asked for.
    expect(card).toHaveTextContent("All tests passed.");
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("include=logs"))
    ).toBe(false);

    await user.click(within(card).getByTestId("session-logs-on-demand"));

    await waitFor(() =>
      expect(card).toHaveTextContent("legacy output from logs.json")
    );
  });
});

describe("review follow-ups — the reading side", () => {
  it("shows a claude-code run's final result from the output stream when it wrote no response chunk", async () => {
    // The live database: 1,288 claude-code sessions, no raw and no response
    // chunk; 1,181 of them carry the final result as `output` (`result-<id>`).
    installFetch({
      sessions: [
        {
          ...baseSession,
          chunkStreams: {
            raw: emptyRawSeed,
            response: { chunks: [], nextAfter: null, nextOffset: 0, hasMore: false },
            output: {
              chunks: [
                chunk(1, "The whole final answer, not only its last line.", {
                  streamType: "output",
                  chunkKey: "result-x",
                }),
              ],
              nextAfter: 1,
              nextOffset: 0,
              hasMore: false,
            },
          },
        },
      ],
    });
    render(<SessionDetailPage />);

    const pane = await screen.findByTestId("stream-output");
    expect(pane).toHaveTextContent("The whole final answer, not only its last line.");
    // The pane switch is there, so the log fallback is one click away.
    expect(screen.getByText("Response")).toBeInTheDocument();
    expect(screen.getByText("Log")).toBeInTheDocument();
  });

  it("offers no Export Logs while the run is live — logs.json does not exist yet", async () => {
    installFetch({ sessions: [{ ...baseSession, status: "running" }] });
    render(<SessionDetailPage />);

    await screen.findByText("Stop session");
    expect(screen.queryByText("Export Logs")).not.toBeInTheDocument();
  });

  it("waits for output on a queued session instead of offering logs.json", async () => {
    installFetch({
      sessions: [
        { ...baseSession, status: "queued", chunkStreams: { raw: emptyRawSeed } },
      ],
    });
    render(<SessionDetailPage />);

    const card = await screen.findByTestId("stream-raw");
    expect(card).toHaveTextContent("Waiting for agent output");
    expect(within(card).queryByTestId("session-logs-on-demand")).toBeNull();
    expect(screen.queryByText("Export Logs")).not.toBeInTheDocument();
  });

  it("renders the write-path trim marker as Arij's own line", async () => {
    const { rawStreamTrimMarker } = await import("@/lib/agent-sessions/chunk-cap");
    const marker = rawStreamTrimMarker(3_000_000, 42);
    installFetch({
      sessions: [
        {
          ...baseSession,
          chunkStreams: {
            raw: {
              ...baseSession.chunkStreams.raw,
              chunks: [
                chunk(20, `${marker}\n`, { chunkKey: "raw-trimmed" }),
                chunk(21, "tail line 21\n"),
              ],
              firstSequence: 20,
            },
          },
        },
      ],
    });
    render(<SessionDetailPage />);

    const card = await screen.findByTestId("stream-raw");
    const line = within(card).getByTestId("raw-trim-marker");
    expect(line).toHaveTextContent("3,000,000 bytes in 42 chunks dropped");
  });
});

describe("review follow-ups — polling and seeding", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  it("shows the final tail of a queued session that finished between two polls", async () => {
    installFetch({
      sessions: [
        { ...baseSession, status: "queued", chunkStreams: { raw: emptyRawSeed } },
        { ...baseSession, status: "completed" },
      ],
    });
    render(<SessionDetailPage />);
    const card = await screen.findByTestId("stream-raw");
    expect(card).toHaveTextContent("Waiting for agent output");

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });

    // The pager never saw `running`; the tail the page read is still shown.
    await waitFor(() => expect(card).toHaveTextContent("tail line 22"));
  });

  it("asks for the stream previews only while it still needs them", async () => {
    const fetchMock = installFetch({
      sessions: [{ ...baseSession, status: "running" }],
    });
    render(<SessionDetailPage />);
    await screen.findByText("Stop session");

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });

    const urls = detailUrls(fetchMock);
    expect(urls.length).toBeGreaterThanOrEqual(3);
    // The first read seeds the pagers; the polls after it leave the
    // previews out — the pagers would ignore them anyway.
    expect(urls[0]).not.toContain("omit=streams");
    for (const url of urls.slice(1)) expect(url).toContain("omit=streams");
    // …and the screen keeps the seed it already had.
    expect(screen.getByTestId("stream-raw")).toHaveTextContent("tail line 22");
  });

  it("reads the previews again at the end of a run, for the Response pane", async () => {
    const fetchMock = installFetch({
      sessions: [
        { ...baseSession, status: "running" },
        { ...baseSession, status: "completed" },
      ],
    });
    render(<SessionDetailPage />);
    await screen.findByText("Stop session");

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await waitFor(() => expect(detailReads(fetchMock)).toBe(3));

    const urls = detailUrls(fetchMock);
    expect(urls[1]).toContain("omit=streams");
    expect(urls[2]).not.toContain("omit=streams");
  });

  it("stops polling a session that does not exist", async () => {
    const fetchMock = installFetch({ sessions: [baseSession], missing: true });
    render(<SessionDetailPage />);

    expect(await screen.findByText("Session not found.")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(detailReads(fetchMock)).toBe(1);
  });

  it("survives a dropped connection on the final read", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const fetchMock = installFetch({
        sessions: [
          { ...baseSession, status: "running" },
          { ...baseSession, status: "completed" },
        ],
        failDetailReads: [3],
      });
      render(<SessionDetailPage />);
      await screen.findByText("Stop session");

      await act(async () => {
        vi.advanceTimersByTime(3_000);
      });
      await waitFor(() => expect(detailReads(fetchMock)).toBe(3));
      // Let the rejection surface if nothing handles it.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).not.toHaveBeenCalled();
      // The screen stays on what it last read.
      expect(screen.getByTestId("stream-raw")).toHaveTextContent("tail line 22");
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("does not jump the log when an earlier page comes back empty and output is appended later", async () => {
    installFetch({
      sessions: [{ ...baseSession, status: "running" }],
      earlier: {
        sessionId: "sess-1",
        streamType: "raw",
        chunks: [],
        firstSequence: 21,
        firstOffset: 0,
        lastSequence: 22,
        hasEarlier: true,
      },
      forward: [
        {
          sessionId: "sess-1",
          streamType: "raw",
          chunks: [chunk(23, "appended line 23\n")],
          nextAfter: 23,
          nextOffset: 0,
          hasMore: false,
        },
      ],
    });
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<SessionDetailPage />);
    const card = await screen.findByTestId("stream-raw");
    const scroller = card.querySelector(".overflow-y-auto") as HTMLElement;

    const writes: number[] = [];
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => 400,
      set: (value: number) => writes.push(value),
    });

    await user.click(screen.getByTestId("stream-load-earlier-raw"));
    await waitFor(() =>
      expect(screen.getByTestId("stream-load-earlier-raw")).not.toBeDisabled()
    );
    writes.length = 0;

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await waitFor(() => expect(card).toHaveTextContent("appended line 23"));

    // The tail was released by the click, and nothing was prepended: the
    // append must not move the view.
    expect(writes).toEqual([]);
  });
});
