/**
 * The conversation roster — the ONE conversation list both chat surfaces draw
 * (`/chat` full-width, the project panel in its compact variant).
 *
 * Pins the parcours the audit found missing or divergent (lot 10):
 * - #41: a "Chat" conversation — the only type the board tools reach — can be
 *   created from the roster, with the persisted label from
 *   `lib/chat/conversation-labels.ts`, never a retyped literal;
 * - #44: a conversation whose last turn failed says so in a WORD (plus an
 *   icon), and one that is replying says so too — never a colour alone;
 * - #46: the active conversation can be renamed inline;
 * - #40: the compact variant drops the page-only note and keeps delete.
 */

import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConversationRoster } from "@/components/chat-page/ConversationRoster";
import { ConversationRosterCard } from "@/components/chat-page/ConversationRosterCard";
import { NewConversationCard } from "@/components/chat-page/NewConversationCard";
import type { Conversation } from "@/hooks/useConversations";
import {
  BRAINSTORM_CONVERSATION_LABEL,
  CHAT_CONVERSATION_LABEL,
  EPIC_CREATION_CONVERSATION_LABEL,
} from "@/lib/chat/conversation-labels";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  globalThis.ResizeObserver ??=
    NoopResizeObserver as unknown as typeof ResizeObserver;
  vi.clearAllMocks();
});

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    projectId: "p1",
    type: "brainstorm",
    label: "Refonte mobile",
    status: "active",
    epicId: null,
    provider: "claude-code",
    createdAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<React.ComponentProps<typeof ConversationRosterCard>> = {},
) {
  return render(
    <ConversationRosterCard
      conversation={conversation()}
      project={null}
      agentLabel="Claude Code"
      active
      ticketCount={0}
      onSelect={vi.fn()}
      now={Date.parse("2026-09-02T08:00:00.000Z")}
      {...overrides}
    />,
  );
}

describe("NewConversationCard", () => {
  it("offers Chat, Brainstorm and New Epic with the persisted default labels", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewConversationCard onCreate={onCreate} />);

    await user.click(screen.getByTestId("chat-new-conversation"));
    await user.click(await screen.findByTestId("chat-new-conversation-chat"));
    expect(onCreate).toHaveBeenLastCalledWith({
      type: "chat",
      label: CHAT_CONVERSATION_LABEL,
    });

    await user.click(screen.getByTestId("chat-new-conversation"));
    await user.click(await screen.findByTestId("chat-new-conversation-brainstorm"));
    expect(onCreate).toHaveBeenLastCalledWith({
      type: "brainstorm",
      label: BRAINSTORM_CONVERSATION_LABEL,
    });

    await user.click(screen.getByTestId("chat-new-conversation"));
    await user.click(await screen.findByTestId("chat-new-conversation-epic"));
    expect(onCreate).toHaveBeenLastCalledWith({
      type: "epic_creation",
      label: EPIC_CREATION_CONVERSATION_LABEL,
    });
  });
});

describe("ConversationRosterCard — status", () => {
  it("says in a word that the last turn failed", () => {
    renderCard({ conversation: conversation({ status: "error" }), active: false });
    const status = screen.getByTestId("chat-roster-status");
    expect(status).toHaveAttribute("data-status", "error");
    expect(status).toHaveTextContent("Last reply failed");
    // The icon is decorative: the word carries the state.
    expect(status.querySelector("svg")).not.toBeNull();
  });

  it("says in a word that the agent is replying", () => {
    renderCard({ conversation: conversation({ status: "generating" }) });
    const status = screen.getByTestId("chat-roster-status");
    expect(status).toHaveAttribute("data-status", "generating");
    expect(status).toHaveTextContent("Replying");
  });

  it("prints no status line for a healthy idle conversation", () => {
    renderCard({ conversation: conversation({ status: "active" }) });
    expect(screen.queryByTestId("chat-roster-status")).toBeNull();
  });
});

describe("ConversationRosterCard — the embedded session", () => {
  // Ported from the deleted ChatWorkspaceHeader tests: the panel shows this
  // state through the same card as /chat now.
  it("says warm or cold in a word and restarts without re-selecting the row", () => {
    const onRestart = vi.fn();
    const onSelect = vi.fn();
    const { rerender } = renderCard({
      conversation: conversation({
        provider: "claude-code-persistent",
        persistentSessionState: "hot",
      }),
      onRestartPersistentSession: onRestart,
      onSelect,
    });
    expect(screen.getByTestId("persistent-session-state")).toHaveTextContent("session warm");

    fireEvent.click(screen.getByRole("button", { name: "Restart persistent chat session" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();

    rerender(
      <ConversationRosterCard
        conversation={conversation({
          provider: "claude-code-persistent",
          persistentSessionState: "cold",
        })}
        project={null}
        agentLabel="Claude Code"
        active
        ticketCount={0}
        onSelect={onSelect}
        onRestartPersistentSession={onRestart}
      />,
    );
    expect(screen.getByTestId("persistent-session-state")).toHaveTextContent("session cold");
  });

  it("keeps the session-linked word for a resumable non-persistent conversation", () => {
    renderCard({ conversation: conversation({ cliSessionId: "cli-1" }) });
    expect(screen.getByTestId("linked-session-state")).toHaveTextContent("session linked");
    expect(screen.queryByTestId("persistent-session-state")).toBeNull();
  });
});

describe("ConversationRosterCard — rename", () => {
  it("renames the active conversation inline on Enter", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onSelect = vi.fn();
    renderCard({ onRename, onSelect });

    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    const field = screen.getByRole("textbox", { name: "Conversation name" });
    expect(field).toHaveValue("Refonte mobile");
    await user.clear(field);
    await user.type(field, "Refonte du panneau{Enter}");

    expect(onRename).toHaveBeenCalledWith("Refonte du panneau");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Conversation name" })).toBeNull();
  });

  it("drops the edit on Escape and never saves a blank or unchanged name", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    renderCard({ onRename });

    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    await user.type(screen.getByRole("textbox", { name: "Conversation name" }), " bis{Escape}");
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Refonte mobile")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    await user.clear(screen.getByRole("textbox", { name: "Conversation name" }));
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    await user.keyboard("{Enter}");
    expect(onRename).not.toHaveBeenCalled();
  });

  // Chrome dispatches `blur` when a focused element is removed from the DOM,
  // and React runs the PREVIOUS render's onBlur — whose closure still holds
  // the typed draft. jsdom never blurs on unmount, so the blur is fired inside
  // the same act() as the key, before the re-render: exactly Chrome's order.
  it("does not save the draft when Escape's unmount blurs the field", () => {
    const onRename = vi.fn();
    renderCard({ onRename });

    fireEvent.click(screen.getByRole("button", { name: "Rename conversation" }));
    const field = screen.getByRole("textbox", { name: "Conversation name" });
    fireEvent.change(field, { target: { value: "Abandoned name" } });
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
      fireEvent.blur(field);
    });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Conversation name" })).toBeNull();
  });

  it("saves once when Enter's unmount blurs the field", () => {
    const onRename = vi.fn();
    renderCard({ onRename });

    fireEvent.click(screen.getByRole("button", { name: "Rename conversation" }));
    const field = screen.getByRole("textbox", { name: "Conversation name" });
    fireEvent.change(field, { target: { value: "Kept name" } });
    act(() => {
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.blur(field);
    });

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("Kept name");
  });

  it("still saves on a plain blur (clicking away)", () => {
    const onRename = vi.fn();
    renderCard({ onRename });

    fireEvent.click(screen.getByRole("button", { name: "Rename conversation" }));
    const field = screen.getByRole("textbox", { name: "Conversation name" });
    fireEvent.change(field, { target: { value: "Blurred name" } });
    fireEvent.blur(field);

    expect(onRename).toHaveBeenCalledWith("Blurred name");
  });

  it("disables rename while the host cannot take the write", () => {
    renderCard({ onRename: vi.fn(), renameDisabled: true });
    expect(screen.getByRole("button", { name: "Rename conversation" })).toBeDisabled();
  });

  it("offers rename only on the active card", () => {
    renderCard({ onRename: vi.fn(), active: false });
    expect(screen.queryByRole("button", { name: "Rename conversation" })).toBeNull();
  });
});

describe("ConversationRoster — variants", () => {
  const rows = [
    conversation({ id: "a", label: "Alpha" }),
    conversation({ id: "b", label: "Beta", createdAt: "2026-09-01T09:00:00.000Z" }),
  ];

  function renderRoster(
    overrides: Partial<React.ComponentProps<typeof ConversationRoster>> = {},
  ) {
    return render(
      <ConversationRoster
        conversations={rows}
        activeId="a"
        project={null}
        agentLabels={new Map()}
        ticketCounts={new Map()}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRestartPersistentSession={vi.fn()}
        {...overrides}
      />,
    );
  }

  it("keeps the page's THE CHAT KNOWS note out of the compact variant", () => {
    const { unmount } = renderRoster();
    expect(screen.getByText("THE CHAT KNOWS")).toBeInTheDocument();
    unmount();

    renderRoster({ variant: "compact" });
    expect(screen.queryByText("THE CHAT KNOWS")).toBeNull();
    expect(screen.getByTestId("chat-roster")).toHaveAttribute("data-variant", "compact");
  });

  it("deletes a conversation only after confirmation, without selecting it", async () => {
    const onDelete = vi.fn(async () => undefined);
    const onSelect = vi.fn();
    renderRoster({ variant: "compact", onDelete, onSelect });

    const cards = screen.getAllByTestId("chat-roster-card");
    fireEvent.click(within(cards[1]).getByRole("button", { name: "Delete conversation" }));
    // One click beside the rename pencil must not lose a history.
    expect(onDelete).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Beta");

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete conversation" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("b"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("cancelling the confirmation keeps the conversation", async () => {
    const onDelete = vi.fn();
    renderRoster({ onDelete });

    const cards = screen.getAllByTestId("chat-roster-card");
    fireEvent.click(within(cards[1]).getByRole("button", { name: "Delete conversation" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("keeps the create card outside the scrolling list in the compact variant", () => {
    renderRoster({ variant: "compact" });
    const create = screen.getByTestId("chat-new-conversation");
    // The panel caps the roster's height: a create card scrolled below the
    // last conversation would be the only way to start one, out of view.
    expect(create.closest("[data-slot='scroll-area']")).toBeNull();
  });

  it("never offers to delete the last conversation", () => {
    renderRoster({ conversations: [rows[0]], onDelete: vi.fn() });
    expect(screen.queryByRole("button", { name: "Delete conversation" })).toBeNull();
  });
});
