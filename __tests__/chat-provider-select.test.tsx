import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Native-select stand-in for the shadcn Select (Radix popper is not
// drivable from jsdom). SelectItem -> <option>, trigger/value render nothing.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
    disabled,
  }: {
    value: string | undefined;
    onValueChange: (v: string) => void;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <select
      data-testid="provider-select-native"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
}));

vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: () => null,
}));

import { ChatProviderSelect } from "@/components/chat/ChatProviderSelect";
import { ChatWorkspaceHeader } from "@/components/chat/ChatWorkspaceHeader";
import type { Conversation } from "@/hooks/useConversations";

const noop = () => {};

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: "conv1",
  projectId: "proj1",
  type: "chat",
  label: "Chat",
  status: "active",
  epicId: null,
  provider: "claude-code",
  namedAgentId: null,
  createdAt: "2026-01-01",
  ...overrides,
});

function optionValues(): string[] {
  const select = screen.getByTestId("provider-select-native") as HTMLSelectElement;
  return Array.from(select.options).map((o) => o.value);
}

describe("ChatProviderSelect", () => {
  it("offers the CLI providers plus OpenAI-compatible for chat conversations", () => {
    render(
      <ChatProviderSelect
        value="claude-code"
        onChange={noop}
        conversationType="chat"
      />,
    );

    const values = optionValues();
    expect(values).toContain("claude-code");
    expect(values).toContain("codex");
    expect(values).toContain("openai-compatible");
  });

  it.each(["epic_creation", "brainstorm"])(
    "hides the OpenAI-compatible option for %s conversations",
    (type) => {
      render(
        <ChatProviderSelect
          value="claude-code"
          onChange={noop}
          conversationType={type}
        />,
      );

      expect(optionValues()).not.toContain("openai-compatible");
      expect(optionValues()).toContain("claude-code");
    },
  );

  it("labels the fast mode OpenAI-compatible", () => {
    render(
      <ChatProviderSelect
        value="openai-compatible"
        onChange={noop}
        conversationType="chat"
      />,
    );

    const select = screen.getByTestId("provider-select-native") as HTMLSelectElement;
    const fastOption = Array.from(select.options).find(
      (o) => o.value === "openai-compatible",
    );
    expect(fastOption?.textContent).toBe("OpenAI-compatible");
  });

  it("reports the chosen provider through onChange", () => {
    const onChange = vi.fn();
    render(
      <ChatProviderSelect
        value="claude-code"
        onChange={onChange}
        conversationType="chat"
      />,
    );

    fireEvent.change(screen.getByTestId("provider-select-native"), {
      target: { value: "openai-compatible" },
    });

    expect(onChange).toHaveBeenCalledWith("openai-compatible");
  });
});

describe("ChatWorkspaceHeader provider select gating", () => {
  function renderHeader(props: Partial<Parameters<typeof ChatWorkspaceHeader>[0]> = {}) {
    return render(
      <ChatWorkspaceHeader
        activeConversation={conversation()}
        activeProvider="claude-code"
        hasMessages={false}
        isBusy={false}
        onAgentChange={noop}
        onProviderChange={noop}
        {...props}
      />,
    );
  }

  it("enables the provider select for a fresh chat conversation", () => {
    renderHeader();
    const select = screen.getByTestId("provider-select-native") as HTMLSelectElement;
    expect(select).not.toBeDisabled();
    expect(optionValues()).toContain("openai-compatible");
  });

  it("disables the provider select once the conversation has messages", () => {
    renderHeader({ hasMessages: true });
    expect(screen.getByTestId("provider-select-native")).toBeDisabled();
  });

  it("disables the provider select while busy", () => {
    renderHeader({ isBusy: true });
    expect(screen.getByTestId("provider-select-native")).toBeDisabled();
  });

  it("disables the provider select when no conversation is active", () => {
    renderHeader({ activeConversation: null });
    expect(screen.getByTestId("provider-select-native")).toBeDisabled();
  });

  it("gives a named agent precedence over the provider select", () => {
    renderHeader({
      activeConversation: conversation({ namedAgentId: "agent-1" }),
    });
    expect(screen.getByTestId("provider-select-native")).toBeDisabled();
  });

  it("hides the fast mode for epic-creation conversations", () => {
    renderHeader({
      activeConversation: conversation({
        type: "epic_creation",
        label: "New Epic",
      }),
    });
    expect(optionValues()).not.toContain("openai-compatible");
  });
});
