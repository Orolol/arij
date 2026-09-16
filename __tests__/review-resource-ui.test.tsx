import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffViewer } from "@/components/review/DiffViewer";
import type { ReactNode } from "react";

vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const files = [{ filePath: "a.ts", status: "added", hunks: [{ oldStart: 0, oldLines: 0, newStart: 1,
  newLines: 1, lines: [{ type: "add", content: "const x = 1;", oldLineNumber: null, newLineNumber: 1 }] }] }];
const props = { projectId: "p", epicId: "e", epicStatus: "to_merge", onMerge: vi.fn(), onBackToDev: vi.fn() };
afterEach(() => { vi.unstubAllGlobals(); });

describe("review resource feedback", () => {
  it("shows an unavailable comment list and blocks review actions until retry succeeds", async () => {
    let commentsAvailable = false;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url) => Promise.resolve(
      String(url).endsWith("/diff") ? response({ data: { files } })
        : commentsAvailable ? response({ data: [] }) : response({ error: "Comments unavailable" }, 503),
    )));
    const user = userEvent.setup();
    render(<DiffViewer {...props} />);
    await screen.findByText("Comments unavailable");
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add review comment" })).toBeDisabled();
    commentsAvailable = true;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Merge" })).toBeEnabled());
    expect(screen.queryByText("Comments unavailable")).not.toBeInTheDocument();
  });

  it("preserves the inline draft after the server refuses the comment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url, init) => Promise.resolve(
      init?.method ? response({ error: "Comment denied" }, 403)
        : String(url).endsWith("/diff") ? response({ data: { files } }) : response({ data: [] }),
    )));
    const user = userEvent.setup();
    render(<DiffViewer {...props} />);
    await user.click(await screen.findByRole("button", { name: "Add review comment" }));
    await user.type(screen.getByRole("textbox"), "Keep this draft");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("Comment denied");
    expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
    expect(screen.getByRole("button", { name: "Comment" })).toBeEnabled();
  });
});
