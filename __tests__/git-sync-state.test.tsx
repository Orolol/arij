import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useParams: () => ({ projectId: "p" }) }));
vi.mock("@/components/github/RepoStrataBand", () => ({ RepoStrataBand: () => null }));
vi.mock("@/components/shared/NamedAgentSelect", () => ({ NamedAgentSelect: () => null }));
vi.mock("@/components/shared/SessionPicker", () => ({ SessionPicker: () => null }));
vi.mock("@/hooks/useNamedAgentsList", () => ({ useNamedAgentsList: () => ({ agents: [], loading: false }) }));
import GitSyncPage from "@/app/projects/[projectId]/git-sync/page";

function json(data: unknown) { return new Response(JSON.stringify({ data })); }
function status(branch: string, ahead = 1) { return { branch, remote: "origin", ahead, behind: 0, hasRemoteBranch: true }; }
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
function background(url: string) {
  return json(url.endsWith("/worktrees") ? { worktrees: [], count: 0, orphanCount: 0 } : {});
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("git sync request state", () => {
  it("resolves the default branch without triggering a duplicate status request", async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes("/git/status") ? json(status("main")) : background(url));
    vi.stubGlobal("fetch", fetchMock);
    render(<GitSyncPage />);
    await act(async () => {});
    expect(screen.getByLabelText("Branch")).toHaveValue("main");
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/git/status"))).toHaveLength(1);
  });

  it("rejects a previous status answer instead of replacing the typed branch and counters", async () => {
    const old = deferred();
    const fetchMock = vi.fn((url: string) => {
      if (!url.includes("/git/status")) return Promise.resolve(background(url));
      return url.includes("branch=feature") ? Promise.resolve(json(status("feature", 9))) : old.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GitSyncPage />);
    await act(async () => { fireEvent.change(screen.getByLabelText("Branch"), { target: { value: "feature" } }); });
    await act(async () => { old.resolve(json(status("main", 1))); });
    expect(screen.getByLabelText("Branch")).toHaveValue("feature");
    expect(screen.getByText("Ahead").parentElement).toHaveTextContent("9 commits");
  });

  it("holds both Git actions and their target fields while a pull is in flight", async () => {
    const pull = deferred();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return pull.promise;
      return Promise.resolve(url.includes("/git/status") ? json(status("main")) : background(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GitSyncPage />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    expect(screen.getByRole("button", { name: "Push" })).toBeDisabled();
    expect(screen.getByLabelText("Branch")).toBeDisabled();
    expect(screen.getByLabelText("Remote")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await act(async () => { pull.resolve(json({})); });
    expect(screen.getByLabelText("Branch")).toBeEnabled();
  });
});
