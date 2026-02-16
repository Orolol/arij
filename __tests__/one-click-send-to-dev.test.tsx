import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentThread } from "@/components/story/CommentThread";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

describe("CommentThread Send to Dev button", () => {
  it("renders Send to Dev button when onSendToDev is provided", () => {
    render(
      <CommentThread
        projectId="p1"
        comments={[]}
        loading={false}
        onAddComment={vi.fn()}
        onSendToDev={vi.fn()}
      />
    );

    const btn = screen.getByTestId("send-to-dev-button");
    expect(btn).toBeTruthy();
  });

  it("does not render Send to Dev button when onSendToDev is not provided", () => {
    render(
      <CommentThread
        projectId="p1"
        comments={[]}
        loading={false}
        onAddComment={vi.fn()}
      />
    );

    expect(screen.queryByTestId("send-to-dev-button")).toBeNull();
  });

  it("calls onSendToDev when clicked", async () => {
    const user = userEvent.setup();
    const onSendToDev = vi.fn().mockResolvedValue(undefined);

    render(
      <CommentThread
        projectId="p1"
        comments={[]}
        loading={false}
        onAddComment={vi.fn()}
        onSendToDev={onSendToDev}
      />
    );

    const btn = screen.getByTestId("send-to-dev-button");
    await user.click(btn);

    expect(onSendToDev).toHaveBeenCalledOnce();
  });

  it("disables Send to Dev button when sendToDevDisabled is true", () => {
    render(
      <CommentThread
        projectId="p1"
        comments={[]}
        loading={false}
        onAddComment={vi.fn()}
        onSendToDev={vi.fn()}
        sendToDevDisabled={true}
      />
    );

    const btn = screen.getByTestId("send-to-dev-button");
    expect(btn).toHaveProperty("disabled", true);
  });

  it("does not require a comment to dispatch", async () => {
    const user = userEvent.setup();
    const onSendToDev = vi.fn().mockResolvedValue(undefined);

    render(
      <CommentThread
        projectId="p1"
        comments={[]}
        loading={false}
        onAddComment={vi.fn()}
        onSendToDev={onSendToDev}
      />
    );

    // Comment input should be empty
    const btn = screen.getByTestId("send-to-dev-button");
    await user.click(btn);

    // Should dispatch even with empty comment
    expect(onSendToDev).toHaveBeenCalledOnce();
  });
});
