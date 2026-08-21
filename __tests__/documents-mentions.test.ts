import { describe, expect, it, vi } from "vitest";

const mockListProjectDocuments = vi.hoisted(() => vi.fn());

vi.mock("@/lib/documents/query", () => ({
  listProjectDocuments: mockListProjectDocuments,
}));

describe("Document mentions", () => {
  it("parses simple and braced mentions", async () => {
    const { parseDocumentMentions } = await import("@/lib/documents/mentions");

    const mentions = parseDocumentMentions(
      "Use @README.md and @{Architecture Decision Record.md} and @README.md"
    );

    expect(mentions).toEqual(["readme.md", "architecture decision record.md"]);
  });

  it("formats mention token preserving original filename", async () => {
    const { formatDocumentMention } = await import("@/lib/documents/mentions");

    expect(formatDocumentMention("README.md")).toBe("@README.md");
    expect(formatDocumentMention("Architecture Notes.md")).toBe(
      "@{Architecture Notes.md}"
    );
  });

  it("enriches prompt with full markdown for text docs and filesystem sentence for images", async () => {
    const { enrichPromptWithDocumentMentions } = await import(
      "@/lib/documents/mentions"
    );

    mockListProjectDocuments.mockReturnValue([
      {
        id: "d1",
        projectId: "proj-1",
        originalFilename: "README.md",
        kind: "text",
        markdownContent: "# Full markdown",
        imagePath: null,
      },
      {
        id: "d2",
        projectId: "proj-1",
        originalFilename: "UI Mock.png",
        kind: "image",
        markdownContent: null,
        imagePath: "data/documents/proj-1/d2-ui-mock.png",
      },
    ]);

    const result = enrichPromptWithDocumentMentions({
      projectId: "proj-1",
      prompt: "Implement feature",
      textSources: ["Please use @README.md and @{UI Mock.png}"],
    });

    expect(result.prompt).toContain("## Mentioned Project Documents");
    expect(result.prompt).toContain("# Full markdown");
    expect(result.prompt).toContain("filesystem path");
    expect(result.prompt).toContain("d2-ui-mock.png");
  });

  /**
   * Enrichment reports unknown mentions instead of throwing: a dangling
   * document link must never refuse a build or a review.
   */
  it("reports unknown mentions instead of throwing, and keeps what resolved", async () => {
    const { enrichPromptWithDocumentMentions } = await import(
      "@/lib/documents/mentions"
    );

    mockListProjectDocuments.mockReturnValue([
      {
        id: "d1",
        projectId: "proj-1",
        originalFilename: "README.md",
        kind: "text",
        markdownContent: "# Doc",
        imagePath: null,
      },
    ]);

    const result = enrichPromptWithDocumentMentions({
      projectId: "proj-1",
      prompt: "Implement",
      textSources: ["Reference @README.md and @missing.md"],
    });

    expect(result.missing).toEqual(["missing.md"]);
    expect(result.prompt).toContain("# Doc");
  });

  it("still throws from validateMentionsExist, the user-input guard", async () => {
    const { validateMentionsExist, MentionResolutionError } = await import(
      "@/lib/documents/mentions"
    );

    mockListProjectDocuments.mockReturnValue([]);

    expect(() =>
      validateMentionsExist({
        projectId: "proj-1",
        textSources: ["Reference @missing.md"],
      })
    ).toThrow(MentionResolutionError);
  });

  /**
   * Agents write `@src/foo.ts` about the project's own codebase. Resolving
   * those against Arij's Docs used to fail the whole build/review.
   */
  it("keeps only user-authored text as mention sources", async () => {
    const { userAuthoredTexts } = await import("@/lib/documents/mentions");

    expect(
      userAuthoredTexts([
        { author: "user", content: "see @spec.md" },
        { author: "agent", content: "I updated @src/foo.ts" },
        { role: "user", content: "and @notes.md" },
        { role: "assistant", content: "check @lib/bar.ts" },
        { content: "no author recorded" },
      ])
    ).toEqual(["see @spec.md", "and @notes.md", "no author recorded"]);
  });
});
