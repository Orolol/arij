import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readme = readFileSync(join(process.cwd(), "README.md"), "utf-8");

describe("README onboarding documentation", () => {
  it("describes the project purpose", () => {
    expect(readme).toContain("# Arij");
    expect(readme).toContain(
      "AI-first, local, open-source project orchestrator",
    );
  });

  it("includes a technical stack overview", () => {
    expect(readme).toContain("## 🚀 Tech Stack");
    expect(readme).toContain("Next.js 16");
    expect(readme).toContain("SQLite via Drizzle ORM");
    expect(readme).toContain("CLI `claude`");
  });

  it("includes a high-level architecture overview", () => {
    expect(readme).toContain("## 🏗️ Architecture");
    expect(readme).toContain("UnifiedChatPanel");
    expect(readme).toContain("git worktree");
  });

  it("replaces the default create-next-app template", () => {
    expect(readme).not.toContain(
      "bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app)",
    );
  });
});
