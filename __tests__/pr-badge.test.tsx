import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrBadge } from "@/components/github/PrBadge";

describe("PrBadge", () => {
  it("renders draft status on the neutral meta token", () => {
    render(<PrBadge status="draft" number={1} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByTestId("pr-badge-draft").className).toContain("text-meta");
  });

  it("renders open status on the agent token", () => {
    render(<PrBadge status="open" number={42} />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByTestId("pr-badge-open").className).toContain("text-agent");
  });

  it("renders closed status on the destructive token", () => {
    render(<PrBadge status="closed" number={10} />);
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByTestId("pr-badge-closed").className).toContain(
      "text-destructive"
    );
  });

  it("renders merged status on the primary token", () => {
    render(<PrBadge status="merged" number={5} />);
    expect(screen.getByText("Merged")).toBeInTheDocument();
    expect(screen.getByTestId("pr-badge-merged").className).toContain(
      "text-primary"
    );
  });

  it("gives each lifecycle state its own icon", () => {
    const slugs = new Set<string>();

    for (const status of ["draft", "open", "closed", "merged"] as const) {
      const { unmount } = render(<PrBadge status={status} number={7} />);
      const icon = screen.getByTestId(`pr-badge-icon-${status}`);
      // lucide tags each icon with a `lucide-<slug>` class.
      const slug = Array.from(icon.classList).find(
        (name) => name.startsWith("lucide-") && name !== "lucide-icon"
      );
      expect(slug).toBeDefined();
      slugs.add(slug as string);
      unmount();
    }

    expect(slugs.size).toBe(4);
  });

  it("uses no raw color literals — every status resolves through a token", () => {
    for (const status of ["draft", "open", "closed", "merged"] as const) {
      const { unmount } = render(<PrBadge status={status} number={7} />);
      const className = screen.getByTestId(`pr-badge-${status}`).className;
      expect(className).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(className).not.toMatch(/\b(yellow|green|red|purple|blue)-\d{3}\b/);
      unmount();
    }
  });

  it("displays PR number when provided", () => {
    render(<PrBadge status="open" number={123} />);
    expect(screen.getByText("#123")).toBeInTheDocument();
  });

  it("renders without PR number when not provided", () => {
    render(<PrBadge status="open" />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.queryByText(/#/)).toBeNull();
  });

  it("renders as a link when url is provided", () => {
    render(<PrBadge status="open" number={42} url="https://github.com/owner/repo/pull/42" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://github.com/owner/repo/pull/42");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders without link when url is not provided", () => {
    render(<PrBadge status="open" number={42} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
