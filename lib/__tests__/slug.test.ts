import { describe, it, expect } from "vitest";
import { slugify, generateBranchName } from "../slug";

describe("slugify", () => {
  it("converts text to lowercase", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("hello world")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("hello---world")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("-hello world-")).toBe("hello-world");
  });

  it("replaces underscores with hyphens", () => {
    expect(slugify("hello_world")).toBe("hello-world");
  });

  it("handles empty strings", () => {
    expect(slugify("")).toBe("");
  });

  it("handles strings with only special characters", () => {
    expect(slugify("!@#$%")).toBe("");
  });
});

describe("generateBranchName", () => {
  it("generates a branch name from an epic title and ID", () => {
    const branch = generateBranchName("Testing Infrastructure", "abc123");
    expect(branch).toBe("feature/epic-testing-infrastructure-abc123");
  });

  it("truncates long titles to 40 characters", () => {
    const longTitle =
      "This is a very long epic title that should be truncated to fit in a branch name";
    const branch = generateBranchName(longTitle, "id1");
    const slug = branch.replace("feature/epic-", "").replace("-id1", "");
    expect(slug.length).toBeLessThanOrEqual(40);
  });

  it("does not leave a trailing hyphen after truncation", () => {
    const title = "A title that will be cut at a hyphen boundary";
    const branch = generateBranchName(title, "x");
    expect(branch).not.toMatch(/-{2,}/);
    expect(branch).not.toMatch(/--x$/);
  });
});
