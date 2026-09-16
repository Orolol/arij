import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocsCard } from "@/components/spec/DocsCard";
import { UploadZone } from "@/components/documents/UploadZone";

const fetchMock = vi.fn<typeof fetch>();
const response = (data: unknown, ok = true) => ({ ok, json: async () => ({ data }) }) as Response;
const file = (name = "a.md") => new File(["# hello"], name, { type: "text/markdown" });
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });

describe("document upload failure recovery", () => {
  it("shows earlier imported documents even when the next file fails", async () => {
    fetchMock.mockResolvedValueOnce(response({ id: "one" }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response([{ id: "one", originalFilename: "a.md", kind: "text", mimeType: "text/markdown", sizeBytes: 10 }]));
    render(<DocsCard projectId="p1" initialDocuments={[]} />);
    fireEvent.change(screen.getByTestId("docs-file-input"), { target: { files: [file(), file("b.md")] } });
    expect(await screen.findByTestId("docs-card-row")).toHaveTextContent("@a.md");
    expect(screen.getByTestId("docs-upload-error")).toHaveTextContent("Failed to import b.md.");
    expect(screen.getByTestId("docs-file-input")).toBeEnabled();
  });

  it("releases the documents-page picker after a network error and permits retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response({ id: "one" }));
    const uploaded = vi.fn();
    const view = render(<UploadZone projectId="p1" onUploaded={uploaded} />);
    fireEvent.change(view.container.querySelector("input")!, { target: { files: [file()] } });
    await screen.findByText("Import failed: could not reach the server.");
    expect(screen.queryByText("Uploading...")).toBeNull();
    fireEvent.change(view.container.querySelector("input")!, { target: { files: [file()] } });
    await waitFor(() => expect(uploaded).toHaveBeenCalledTimes(1));
  });

  it("refuses overlapping picker/drop batches while an upload owns the control", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue(response([]));
    render(<DocsCard projectId="p1" initialDocuments={[]} />);
    fireEvent.change(screen.getByTestId("docs-file-input"), { target: { files: [file()] } });
    fireEvent.drop(screen.getByTestId("docs-drop-zone"), { dataTransfer: { files: [file("b.md")] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => finish(response({ id: "one" })));
  });
});
