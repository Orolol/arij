import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ projectId: "p1" }));
vi.mock("next/navigation", () => ({ useParams: () => navigation }));
vi.mock("@/components/documents/ScanProjectDialog", () => ({ ScanProjectDialog: () => null }));
vi.mock("@/components/documents/UploadZone", () => ({ UploadZone: ({ onUploaded }: { onUploaded: () => void }) => <button onClick={onUploaded}>Refresh documents</button> }));
vi.mock("@/components/documents/DocumentViewer", () => ({ DocumentViewer: ({ markdownContent }: { markdownContent: string }) => <div data-testid="document-preview">{markdownContent}</div> }));
import DocumentsPage from "@/app/projects/[projectId]/documents/page";
const doc = (content = "first version") => ({ id: "d1", originalFilename: "reference.md", kind: "text", markdownContent: content, sizeBytes: 10, createdAt: null });
const response = (data: unknown, ok = true) => ({ ok, json: async () => ({ data }) }) as Response;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { navigation.projectId = "p1"; fetchMock.mockReset(); fetchMock.mockResolvedValue(response([doc()])); vi.stubGlobal("fetch", fetchMock); });

describe("document list ownership", () => {
  it("keeps a failed deletion visible and allows retry", async () => {
    render(<DocumentsPage />);
    const remove = await screen.findByRole("button", { name: "Delete reference.md" });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(remove);
    expect(await screen.findByRole("alert")).toHaveTextContent("reference.md");
    expect(screen.getByRole("button", { name: "Delete reference.md" })).toBeEnabled();
    fetchMock.mockResolvedValueOnce(response({ success: true }));
    fireEvent.click(remove);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete reference.md" })).toBeNull());
  });

  it("derives the preview from the refreshed document instead of a stale copied row", async () => {
    render(<DocumentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /reference.md.*10 B/ }));
    expect(screen.getByTestId("document-preview")).toHaveTextContent("first version");
    fetchMock.mockResolvedValueOnce(response([doc("second version")]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh documents" }));
    await waitFor(() => expect(screen.getByTestId("document-preview")).toHaveTextContent("second version"));
  });

  it("clears the preview and rejects an old list response after project navigation", async () => {
    const view = render(<DocumentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /reference.md.*10 B/ }));
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh documents" }));
    navigation.projectId = "p2";
    fetchMock.mockResolvedValueOnce(response([]));
    view.rerender(<DocumentsPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/projects/p2/documents"));
    await act(async () => finish(response([doc("stale response")])));
    expect(screen.queryByTestId("document-preview")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete reference.md" })).toBeNull();
  });
});
