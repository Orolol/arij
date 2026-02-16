# Epic Button Unblock Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the `isCurrentConversationBusy` guard from the "Create Epic & Generate Stories" button so it is only disabled during active epic creation (`epicCreating`), not during general chat activity.

**Architecture:** Single-line change in `UnifiedChatPanel.tsx` (remove `isCurrentConversationBusy` from the button's `disabled` prop). Add a new test that verifies the button stays enabled when the conversation is busy. Update existing concurrency test to cover the epic creation scenario.

**Tech Stack:** React, TypeScript, Vitest, React Testing Library

---

### Task 1: Write failing test — epic button enabled while conversation is busy

**Files:**
- Create: `__tests__/epic-button-not-blocked-by-chat.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

let mockConversations = [
  {
    id: "conv1",
    projectId: "proj1",
    type: "epic_creation",
    label: "New Epic",
    status: "generating",
    epicId: null,
    provider: "claude-code",
    createdAt: "2024-01-01",
  },
];
let mockActiveId: string | null = "conv1";
let mockSending = false;

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({
    conversations: mockConversations,
    activeId: mockActiveId,
    setActiveId: vi.fn(),
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    refresh: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: [
      { id: "m1", projectId: "proj1", role: "user", content: "Create auth epic", createdAt: "2024-01-01" },
      { id: "m2", projectId: "proj1", role: "assistant", content: "Here is the epic", createdAt: "2024-01-01" },
    ],
    loading: false,
    sending: mockSending,
    pendingQuestions: null,
    streamStatus: null,
    sendMessage: vi.fn(),
    answerQuestions: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCodexAvailable", () => ({
  useCodexAvailable: () => ({ codexAvailable: false, codexInstalled: false }),
}));

vi.mock("@/hooks/useEpicCreate", () => ({
  useEpicCreate: () => ({
    createEpic: vi.fn(),
    isLoading: false,
    error: null,
    createdEpic: null,
  }),
}));

vi.mock("@/components/chat/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

vi.mock("@/components/chat/MessageInput", () => ({
  MessageInput: ({ disabled }: { disabled?: boolean }) => (
    <button data-testid="message-input" disabled={disabled}>input</button>
  ),
}));

vi.mock("@/components/chat/QuestionCards", () => ({
  QuestionCards: () => null,
}));

vi.mock("@/components/shared/ProviderSelect", () => ({
  ProviderSelect: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="provider-select" data-disabled={disabled} />
  ),
}));

import { UnifiedChatPanel } from "@/components/chat/UnifiedChatPanel";

describe("Epic button not blocked by chat activity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();

    mockConversations = [
      {
        id: "conv1",
        projectId: "proj1",
        type: "epic_creation",
        label: "New Epic",
        status: "generating",
        epicId: null,
        provider: "claude-code",
        createdAt: "2024-01-01",
      },
    ];
    mockActiveId = "conv1";
    mockSending = false;

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1200,
    });
  });

  it("epic button is enabled even when conversation status is generating", () => {
    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const button = screen.getByText("Create Epic & Generate Stories");
    expect(button).not.toBeDisabled();
  });

  it("epic button is enabled even when useChat sending is true", () => {
    mockSending = true;

    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const button = screen.getByText("Create Epic & Generate Stories");
    expect(button).not.toBeDisabled();
  });

  it("message input is still disabled when conversation is busy", () => {
    mockSending = true;

    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const input = screen.getByTestId("message-input");
    expect(input).toBeDisabled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- __tests__/epic-button-not-blocked-by-chat.test.tsx`
Expected: FAIL — first two tests fail because button is currently disabled by `isCurrentConversationBusy`

---

### Task 2: Fix the button — remove `isCurrentConversationBusy` from disabled prop

**Files:**
- Modify: `components/chat/UnifiedChatPanel.tsx:607`

**Step 3: Change the disabled condition**

In `components/chat/UnifiedChatPanel.tsx`, change line 607 from:

```tsx
disabled={epicCreating || isCurrentConversationBusy}
```

to:

```tsx
disabled={epicCreating}
```

**Step 4: Run ALL tests to verify they pass**

Run: `npm run test -- __tests__/epic-button-not-blocked-by-chat.test.tsx __tests__/unified-chat-panel-shell.test.tsx __tests__/chat-concurrency.test.tsx`
Expected: ALL PASS

---

### Task 3: Commit

**Step 5: Commit the changes**

```bash
git add __tests__/epic-button-not-blocked-by-chat.test.tsx components/chat/UnifiedChatPanel.tsx
git commit -m "fix(chat): unblock epic creation button from chat busy state

The 'Create Epic & Generate Stories' button was incorrectly disabled
when the conversation was generating or sending. The button should
only be disabled by its own epicCreating flag, since the epic creation
workflow handles its own finalization message internally."
```
