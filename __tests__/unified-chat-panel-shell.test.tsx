import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UnifiedChatPanel } from "@/components/chat/UnifiedChatPanel";

vi.mock("@/components/chat/ChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel-content">chat</div>,
}));

describe("UnifiedChatPanel shell", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1200,
    });
  });

  it("defaults to collapsed state with a visible chat strip", () => {
    render(
      <UnifiedChatPanel projectId="proj1">
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    expect(screen.getByTestId("board-content")).toBeInTheDocument();
    expect(screen.getByTestId("collapsed-chat-strip")).toBeInTheDocument();
    expect(screen.queryByTestId("unified-panel-expanded")).not.toBeInTheDocument();
  });

  it("expands when collapsed strip is clicked", () => {
    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    expect(screen.getByTestId("unified-panel-expanded")).toBeInTheDocument();
    expect(screen.getByTestId("chat-panel-content")).toBeInTheDocument();
    expect(screen.getByTestId("panel-divider")).toBeInTheDocument();
  });

  it("allows resizing via divider and persists ratio in localStorage", () => {
    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const divider = screen.getByTestId("panel-divider");
    fireEvent.mouseDown(divider);
    fireEvent.mouseMove(window, { clientX: 820 });
    fireEvent.mouseUp(window);

    const saved = window.localStorage.getItem("arij.unified-chat-panel.ratio.proj1");
    expect(saved).not.toBeNull();
    expect(Number(saved)).toBeGreaterThan(0.3);
    expect(Number(saved)).toBeLessThan(0.35);
  });

  it("resets divider ratio to default on double-click", () => {
    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const divider = screen.getByTestId("panel-divider");
    fireEvent.mouseDown(divider);
    fireEvent.mouseMove(window, { clientX: 880 });
    fireEvent.mouseUp(window);

    fireEvent.doubleClick(divider);

    const saved = window.localStorage.getItem("arij.unified-chat-panel.ratio.proj1");
    expect(saved).toBe("0.4000");
  });

  it("collapses panel when Escape is pressed", () => {
    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));
    expect(screen.getByTestId("unified-panel-expanded")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByTestId("unified-panel-expanded")).not.toBeInTheDocument();
    expect(screen.getByTestId("collapsed-chat-strip")).toBeInTheDocument();
  });
});
