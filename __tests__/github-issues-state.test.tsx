import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useParams: () => ({ projectId: "p" }) }));
import GitHubIssuesPage from "@/app/projects/[projectId]/github-issues/page";

function json(data: unknown) { return new Response(JSON.stringify({ data })); }
function issue(number: number, title: string) {
  return { id: `i${number}`, issueNumber: number, title, labels: ["bug"], milestone: null, githubUrl: `https://github.com/o/r/issues/${number}`, createdAtGitHub: null, importedEpicId: null };
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
function install(override: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const result = override(url, init);
    if (result) return result;
    if (url === "/api/github/config") return json({ tokenSet: true });
    if (url === "/api/projects") return json([{ id: "p", githubOwnerRepo: "o/r" }]);
    if (url.endsWith("/label-mapping")) return json({ featureLabels: ["feature"], bugLabels: ["bug"] });
    return json([issue(1, "First issue"), issue(2, "Second issue")]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("GitHub issues asynchronous state", () => {
  it("does not replace a filtered result with a late answer to the previous filter", async () => {
    const old = deferred();
    const fetchMock = install((url) => {
      if (!url.includes("/triage?")) return;
      return url.includes("label=bug") ? json([issue(3, "Filtered issue")]) : old.promise;
    });
    render(<GitHubIssuesPage />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/triage?"))).toBe(true));
    fireEvent.change(screen.getByLabelText("Filter by label"), { target: { value: "bug" } });
    await screen.findByText("Filtered issue");
    await act(async () => { old.resolve(json([issue(9, "Unfiltered old issue")])); });
    expect(screen.getByText("Filtered issue")).toBeInTheDocument();
    expect(screen.queryByText("Unfiltered old issue")).not.toBeInTheDocument();
  });

  it("requires a successful mapping read before allowing a replacement save", async () => {
    let ready = false;
    install((url) => url.endsWith("/label-mapping") && !ready ? new Response("offline", { status: 503 }) : undefined);
    render(<GitHubIssuesPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the label mapping");
    expect(screen.getByLabelText("Feature labels (comma-separated)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save Mapping" })).toBeDisabled();
    ready = true;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByLabelText("Feature labels (comma-separated)")).toHaveValue("feature"));
    expect(screen.getByRole("button", { name: "Save Mapping" })).toBeEnabled();
  });

  it("reports unreadable GitHub settings rather than claiming the PAT was removed", async () => {
    let ready = false;
    install((url) => url === "/api/github/config" && !ready ? Promise.reject(new Error("offline")) : undefined);
    render(<GitHubIssuesPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not read the GitHub configuration");
    expect(screen.queryByText("No GitHub personal access token is stored.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync" })).toBeDisabled();
    ready = true;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByText("First issue");
    expect(screen.getByRole("button", { name: "Sync" })).toBeEnabled();
  });

  it("preserves selections added while an earlier import is pending", async () => {
    const pendingImport = deferred();
    install((url) => url.endsWith("/issues/import") ? pendingImport.promise : undefined);
    render(<GitHubIssuesPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select issue #1" }));
    fireEvent.click(screen.getByRole("button", { name: "Import Selected (1)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select issue #2" }));
    await act(async () => { pendingImport.resolve(json({ imported: [{ issueNumber: 1 }] })); });
    expect(screen.getByRole("checkbox", { name: "Select issue #2" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select issue #1" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Import Selected (1)" })).toBeEnabled();
  });
});
