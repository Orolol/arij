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
      data-testid="agent-select-native"
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

vi.mock("@/hooks/useNamedAgentsList", () => ({
  useNamedAgentsList: () => ({
    agents: [
      { id: "agent-1", name: "Claude Code", provider: "claude-code", model: "opus" },
    ],
    loading: false,
    refresh: vi.fn(),
  }),
}));

import { NamedAgentSelect } from "@/components/shared/NamedAgentSelect";

function optionValues(): string[] {
  const select = screen.getByTestId("agent-select-native") as HTMLSelectElement;
  return Array.from(select.options).map((o) => o.value);
}

describe("NamedAgentSelect clear row", () => {
  it("omits the clear row by default", () => {
    render(<NamedAgentSelect value="agent-1" onChange={vi.fn()} />);
    expect(optionValues()).toEqual(["agent-1"]);
  });

  it("offers a clear row when allowClear is set", () => {
    render(<NamedAgentSelect value="agent-1" onChange={vi.fn()} allowClear />);
    expect(optionValues()).toContain("__none__");
  });

  it("reports an empty id when the clear row is chosen", () => {
    const onChange = vi.fn();
    render(<NamedAgentSelect value="agent-1" onChange={onChange} allowClear />);

    fireEvent.change(screen.getByTestId("agent-select-native"), {
      target: { value: "__none__" },
    });

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows the clear row as selected when no agent is attached", () => {
    render(<NamedAgentSelect value={null} onChange={vi.fn()} allowClear />);
    const select = screen.getByTestId("agent-select-native") as HTMLSelectElement;
    expect(select.value).toBe("__none__");
  });

  it("reports a real agent id unchanged", () => {
    const onChange = vi.fn();
    render(<NamedAgentSelect value={null} onChange={onChange} allowClear />);

    fireEvent.change(screen.getByTestId("agent-select-native"), {
      target: { value: "agent-1" },
    });

    expect(onChange).toHaveBeenCalledWith("agent-1");
  });
});
