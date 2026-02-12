import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "../page";

describe("Home page", () => {
  it("renders the heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1 })
    ).toHaveTextContent("To get started, edit the page.tsx file.");
  });

  it("renders the Deploy Now link", () => {
    render(<Home />);
    expect(screen.getByText("Deploy Now")).toBeInTheDocument();
  });

  it("renders the Documentation link", () => {
    render(<Home />);
    expect(screen.getByText("Documentation")).toBeInTheDocument();
  });

  it("renders the Next.js logo", () => {
    render(<Home />);
    expect(screen.getByAltText("Next.js logo")).toBeInTheDocument();
  });
});
