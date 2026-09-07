/**
 * A Piscine primitive that declares its props explicitly and spreads no
 * `...rest` swallows every attribute the caller did not anticipate —
 * `data-testid` first among them. `Mono` and `StrataBand` lose it silently;
 * `QuietDangerAction` at least fails to compile, which turns the hole into
 * friction: the id is written, TypeScript refuses it, and the test falls back
 * to a role+name query.
 *
 * `QuietLink` settled the shape next door: an explicit `testId` prop placed on
 * the INTERACTIVE ELEMENT. It cannot live on a wrapper — a test has to be able
 * to click the thing it looked up. These tests pin that placement for both.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Trash2 } from "lucide-react";

import {
  CheckMark,
  DeskHeader,
  IdentityChip,
  QuietDangerAction,
  QuietLink,
  SegmentedControl,
  SelectPill,
  UnderlineTabNav,
} from "@/components/piscine";

describe("QuietDangerAction testId", () => {
  it("puts the id on the button itself, so the test can click what it found", () => {
    const onClick = vi.fn();
    render(
      <QuietDangerAction icon={Trash2} onClick={onClick} testId="delete-ticket">
        Supprimer
      </QuietDangerAction>,
    );

    const found = screen.getByTestId("delete-ticket");
    // Not a wrapper: the queried node is the control that fires the action.
    expect(found.tagName).toBe("BUTTON");
    expect(found).toHaveAttribute("data-slot", "quiet-danger-action");
    expect(found).toBe(screen.getByRole("button", { name: "Supprimer" }));

    fireEvent.click(found);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the id additive — the rest of the contract is untouched", () => {
    render(
      <QuietDangerAction
        onClick={() => {}}
        size={11.5}
        className="ml-auto"
        testId="discard"
      >
        jeter
      </QuietDangerAction>,
    );

    const found = screen.getByTestId("discard");
    expect(found.className).toContain("text-[11.5px]");
    expect(found.className).toContain("ml-auto");
    expect(found.className).toContain("text-destructive");
  });

  it("writes no attribute at all when no testId is passed", () => {
    render(<QuietDangerAction onClick={() => {}}>Supprimer</QuietDangerAction>);

    // `data-testid="undefined"` would be worse than nothing: it matches a
    // stray query and reads as a real id in the DOM.
    expect(screen.getByRole("button", { name: "Supprimer" })).not.toHaveAttribute(
      "data-testid",
    );
  });
});

describe("QuietLink testId — the in-file precedent", () => {
  it("lands on the anchor when the link has an href", () => {
    render(
      <QuietLink href="/projects/x" testId="open-diff">
        open diff →
      </QuietLink>,
    );

    const found = screen.getByTestId("open-diff");
    expect(found.tagName).toBe("A");
    expect(found).toHaveAttribute("href", "/projects/x");
  });

  it("lands on the button when the link is a bare onClick", () => {
    const onClick = vi.fn();
    render(
      <QuietLink onClick={onClick} testId="regenerate">
        régénérer
      </QuietLink>,
    );

    const found = screen.getByTestId("regenerate");
    expect(found.tagName).toBe("BUTTON");
    fireEvent.click(found);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("CheckMark testId", () => {
  it("puts the id on the button when onToggle is given", () => {
    const onToggle = vi.fn();
    render(<CheckMark checked={false} onToggle={onToggle} testId="story-check" />);

    const found = screen.getByTestId("story-check");
    expect(found.tagName).toBe("BUTTON");
    expect(found).toHaveAttribute("data-slot", "check-mark");
    expect(found).toHaveAttribute("role", "checkbox");

    fireEvent.click(found);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("puts the id on the span when read-only", () => {
    render(<CheckMark checked={true} testId="static-check" />);

    const found = screen.getByTestId("static-check");
    expect(found.tagName).toBe("SPAN");
    expect(found).toHaveAttribute("data-slot", "check-mark");
    expect(found).toHaveAttribute("aria-hidden", "true");
  });

  it("writes no attribute at all when no testId is passed", () => {
    render(<CheckMark checked={false} onToggle={() => {}} />);
    expect(screen.getByRole("checkbox")).not.toHaveAttribute("data-testid");
  });
});

describe("IdentityChip testId", () => {
  it("puts the id on the button when onClick is given", () => {
    const onClick = vi.fn();
    render(<IdentityChip label="arij" tone={1} onClick={onClick} testId="project-chip" />);

    const found = screen.getByTestId("project-chip");
    expect(found.tagName).toBe("BUTTON");
    expect(found).toHaveAttribute("data-slot", "identity-chip");

    fireEvent.click(found);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("puts the id on the span when static", () => {
    render(<IdentityChip label="E-123" tone={2} testId="ticket-chip" />);

    const found = screen.getByTestId("ticket-chip");
    expect(found.tagName).toBe("SPAN");
    expect(found).toHaveAttribute("data-slot", "identity-chip");
  });

  it("writes no attribute at all when no testId is passed", () => {
    render(<IdentityChip label="arij" tone={1} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "arij" })).not.toHaveAttribute("data-testid");
  });
});

describe("SegmentedControl testId", () => {
  it("puts the id on each segment button via option.testId and on the rail via testId", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        testId="tab-rail"
        value="code"
        onChange={onChange}
        options={[
          { value: "code", label: "Code", testId: "seg-code" },
          { value: "preview", label: "Preview", testId: "seg-preview" },
        ]}
      />,
    );

    const rail = screen.getByTestId("tab-rail");
    expect(rail.tagName).toBe("DIV");
    expect(rail).toHaveAttribute("data-slot", "segmented-control");

    const codeBtn = screen.getByTestId("seg-code");
    expect(codeBtn.tagName).toBe("BUTTON");
    expect(codeBtn).toHaveAttribute("data-slot", "segmented-control-segment");
    expect(codeBtn).toHaveAttribute("aria-pressed", "true");

    const previewBtn = screen.getByTestId("seg-preview");
    expect(previewBtn.tagName).toBe("BUTTON");
    expect(previewBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(previewBtn);
    expect(onChange).toHaveBeenCalledWith("preview");
  });

  it("writes no attribute at all when no testId is passed", () => {
    render(
      <SegmentedControl
        value="a"
        onChange={() => {}}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );

    expect(screen.getByRole("group")).not.toHaveAttribute("data-testid");
    expect(screen.getByRole("button", { name: "A" })).not.toHaveAttribute("data-testid");
  });
});

describe("SelectPill testId", () => {
  it("puts the id on the trigger button itself", () => {
    render(
      <SelectPill label="Claude Code" testId="agent-picker">
        <div>Option 1</div>
      </SelectPill>,
    );

    const found = screen.getByTestId("agent-picker");
    expect(found.tagName).toBe("BUTTON");
    expect(found).toHaveAttribute("data-slot", "select-pill");
    expect(found.textContent).toContain("Claude Code");
  });

  it("supports passing data-testid directly via rest props", () => {
    render(
      <SelectPill label="Sonnet" data-testid="via-data-attr">
        <div>Option 1</div>
      </SelectPill>,
    );

    const found = screen.getByTestId("via-data-attr");
    expect(found.tagName).toBe("BUTTON");
    expect(found).toHaveAttribute("data-slot", "select-pill");
  });

  it("writes no attribute at all when no testId is passed", () => {
    render(
      <SelectPill label="Claude Code">
        <div>Option 1</div>
      </SelectPill>,
    );

    expect(screen.getByRole("button", { name: "Claude Code" })).not.toHaveAttribute(
      "data-testid",
    );
  });
});

describe("UnderlineTabNav testId", () => {
  it("puts the id on each tab link via item.testId and on the nav via testId", () => {
    render(
      <UnderlineTabNav
        testId="workshop-nav"
        items={[
          { href: "/agents", label: "Agents", testId: "tab-agents" },
          { href: "/settings", label: "Settings", testId: "tab-settings" },
        ]}
      />,
    );

    const nav = screen.getByTestId("workshop-nav");
    expect(nav.tagName).toBe("NAV");
    expect(nav).toHaveAttribute("data-slot", "underline-tab-nav");

    const tabAgents = screen.getByTestId("tab-agents");
    expect(tabAgents.tagName).toBe("A");
    expect(tabAgents).toHaveAttribute("href", "/agents");
    expect(tabAgents.textContent).toBe("Agents");
  });

  it("writes no attribute at all when no testId is passed", () => {
    render(
      <UnderlineTabNav
        items={[
          { href: "/agents", label: "Agents" },
          { href: "/settings", label: "Settings" },
        ]}
      />,
    );

    expect(screen.getByRole("navigation")).not.toHaveAttribute("data-testid");
    expect(screen.getByRole("link", { name: "Agents" })).not.toHaveAttribute("data-testid");
  });
});

describe("DeskHeader testId", () => {
  it("puts the id on the title link when titleHref is provided", () => {
    render(<DeskHeader title="Agents" titleHref="/agents" testId="header-title" />);

    const found = screen.getByTestId("header-title");
    expect(found.tagName).toBe("A");
    expect(found).toHaveAttribute("href", "/agents");
    expect(found.textContent).toBe("Agents");
  });

  it("puts the id on the title span when no titleHref is provided", () => {
    render(<DeskHeader title="Now" testId="header-title-static" />);

    const found = screen.getByTestId("header-title-static");
    expect(found.tagName).toBe("SPAN");
    expect(found.textContent).toBe("Now");
  });

  it("writes no attribute at all when no testId is passed", () => {
    render(<DeskHeader title="Now" titleHref="/desk" />);
    expect(screen.getByRole("link", { name: "Now" })).not.toHaveAttribute("data-testid");
  });
});
