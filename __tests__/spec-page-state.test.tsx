import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ projectId: "p1" }));
vi.mock("next/navigation", () => ({ useParams: () => navigation }));
vi.mock("@/components/spec/MemoryPanel", () => ({ MemoryPanel: () => null }));
vi.mock("@/components/spec/DocsCard", () => ({ DocsCard: () => null }));
vi.mock("@/components/spec/PromptAnatomyBand", () => ({ PromptAnatomyBand: () => null }));
vi.mock("@/components/spec/SpecEditor", () => ({ SpecEditor: (props: { value: string; onChange: (value: string) => void; disabled: boolean }) =>
  <textarea data-testid="spec-editor" value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)} /> }));
vi.mock("@/components/shared/AgentDispatchDialog", () => ({ AgentDispatchDialog: (props: { open: boolean; extraContent: React.ReactNode; onConfirm: () => void; confirmDisabled: boolean }) => props.open
  ? <div>{props.extraContent}<button onClick={props.onConfirm} disabled={props.confirmDisabled}>Start update</button></div> : null }));
import SpecPage from "@/app/projects/[projectId]/spec/page";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const response = (data: unknown, ok = true) => ({ ok, json: async () => ({ data }) }) as Response;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  navigation.projectId = "p1";
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) => String(url).endsWith("/spec/update")
    ? response({ pending: false }) : response({ spec: "saved", updatedAt: null }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("spec editor persistence", () => {
  it("blocks saving an unloaded spec and offers a visible retry on GET failure", async () => {
    fetchMock.mockResolvedValueOnce(response(null, false));
    render(<SpecPage />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load the specification.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("spec-editor")).toHaveValue("saved"));
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("does not dispatch an agent when saving the latest edit was rejected", async () => {
    render(<SpecPage />);
    await waitFor(() => expect(screen.getByTestId("spec-editor")).toHaveValue("saved"));
    fireEvent.change(screen.getByTestId("spec-editor"), { target: { value: "unsaved edit" } });
    fireEvent.click(screen.getByTestId("spec-update-button"));
    fetchMock.mockResolvedValueOnce(response(null, false));
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((row) => row.textContent?.includes("Save the specification successfully"))).toBe(true));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByTestId("spec-editor")).toHaveValue("unsaved edit");
  });

  it("keeps edits typed while an earlier snapshot is being saved", async () => {
    render(<SpecPage />);
    await waitFor(() => expect(screen.getByTestId("spec-editor")).toHaveValue("saved"));
    fireEvent.change(screen.getByTestId("spec-editor"), { target: { value: "submitted" } });
    const saving = deferred<Response>();
    fetchMock.mockReturnValueOnce(saving.promise);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(screen.getByTestId("spec-editor"), { target: { value: "newer draft" } });
    await act(async () => saving.resolve(response({ spec: "submitted" })));
    expect(screen.getByTestId("spec-editor")).toHaveValue("newer draft");
    expect(screen.getByText(/markdown .*unsaved/)).toBeInTheDocument();
  });

  it("drops the former project's draft and ignores its delayed GET", async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    const view = render(<SpecPage />);
    navigation.projectId = "p2";
    view.rerender(<SpecPage />);
    await waitFor(() => expect(screen.getByTestId("spec-editor")).toHaveValue("saved"));
    await act(async () => old.resolve(response({ spec: "wrong project" })));
    expect(screen.getByTestId("spec-editor")).toHaveValue("saved");
  });
});
