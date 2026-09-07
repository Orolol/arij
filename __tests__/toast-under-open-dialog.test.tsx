/**
 * A toast raised while a Radix modal dialog is open must stay in the
 * accessibility tree.
 *
 * `components/notifications/ToastStack.tsx` portals its region onto
 * `document.body`. A modal `DialogContent` calls `hideOthers(content)` from
 * `aria-hidden`, which stamps `aria-hidden="true"` on every other child of the
 * body — the toast region included. The toast is still painted (`z-[100]` over
 * the dialog's `z-50`), but the region, the `alert` and the dismiss button all
 * leave the accessibility tree, so nothing announces the failure and no
 * assistive technology can reach the toast while the dialog is open.
 *
 * That is not a hypothetical: `/projects/:id/stories/:storyId` keeps its
 * delete dialog open when the DELETE fails, and raises the error toast over
 * it. The same shape exists on `/projects/:id` (epic, quick capture, bug
 * dialogs) and in `QaScreen`'s `DismissDialog`.
 *
 * These queries are deliberately written WITHOUT `hidden: true`: the whole
 * point is that the default, accessibility-tree-aware query resolves them.
 */

import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastStack, type ToastItem } from "@/components/notifications/ToastStack";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ---- story detail: the surface the bug was reported on ---------------- */

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "p1", storyId: "s1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/p1/stories/s1",
}));

vi.mock("@/hooks/useStoryDetail", () => ({
  useStoryDetail: () => ({
    story: {
      id: "s1",
      epicId: "e1",
      title: "Story title",
      description: "",
      acceptanceCriteria: "",
      status: "todo",
      position: 0,
      createdAt: new Date().toISOString(),
      epic: { id: "e1", title: "Epic", description: "", status: "todo", branchName: null, projectId: "p1" },
    },
    loading: false,
    updateStory: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useTicketComments", () => ({
  useTicketComments: () => ({ comments: [], loading: false, addComment: vi.fn() }),
}));

vi.mock("@/hooks/useAgentDispatch", () => ({
  useAgentDispatch: () => ({
    activeSession: null,
    dispatching: false,
    isRunning: false,
    sendToDev: vi.fn(),
    sendToReview: vi.fn(),
    merge: vi.fn(),
  }),
}));

vi.mock("@/components/story/StoryDetailPanel", () => ({
  StoryDetailPanel: () => <div data-testid="story-detail-panel" />,
}));

vi.mock("@/components/story/CommentThread", () => ({
  CommentThread: () => <div data-testid="comment-thread" />,
}));

vi.mock("@/components/shared/AgentActionsBar", () => ({
  AgentActionsBar: () => <div data-testid="story-actions" />,
}));

import StoryDetailPage from "@/app/projects/[projectId]/stories/[storyId]/page";

const errorToast: ToastItem = {
  id: "one",
  type: "error",
  message: "Story is owned by a running session",
};

/** The stack as a surface mounts it: before, and independently of, any dialog. */
function StackUnderDialog({ items }: { items: readonly ToastItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ToastStack items={items} onDismiss={vi.fn()} testId="probe-toast" />
      <button type="button" onClick={() => setOpen(true)}>
        Open the dialog
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User Story</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("a toast raised under an open Radix dialog", () => {
  it("keeps the region, its role and its dismiss button in the accessibility tree", () => {
    render(<StackUnderDialog items={[errorToast]} />);

    // Dialog-free, everything resolves — the baseline the bug is measured from.
    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open the dialog" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region).not.toHaveAttribute("aria-hidden", "true");

    const toast = screen.getByRole("alert");
    expect(region).toContainElement(toast);
    expect(toast).toHaveTextContent("Story is owned by a running session");
    expect(
      within(toast).getByRole("button", { name: "Dismiss notification" }),
    ).toBeInTheDocument();
  });

  it("stays out of the hidden subtree without becoming a second live region", () => {
    render(<StackUnderDialog items={[errorToast]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open the dialog" }));

    // `aria-hidden`'s documented opt-out is the `[aria-live]` selector it
    // sweeps for. `off` takes it while leaving the announcement to each
    // toast's own `status`/`alert` role — a `polite` container here would
    // announce the same insertion a second time.
    expect(screen.getByRole("region", { name: "Notifications" })).toHaveAttribute(
      "aria-live",
      "off",
    );
  });

  it("announces the story delete failure that leaves its dialog open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({ error: "Story is owned by a running session" }),
        }) as unknown as Response,
      ),
    );

    render(<StoryDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete User Story" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Delete" }));
    await screen.findByTestId("story-toast");

    // The dialog is still open by design; the toast sits over it.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Story is owned by a running session");
    expect(screen.getByRole("region", { name: "Notifications" })).toContainElement(toast);
    expect(
      within(toast).getByRole("button", { name: "Dismiss notification" }),
    ).toBeInTheDocument();
  });
});
