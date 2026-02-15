import { describe, expect, it } from "vitest";
import {
  section,
  systemSection,
  documentsSection,
  existingEpicsSection,
  chatHistorySection,
  specSection,
  projectHeader,
  descriptionSection,
  projectContextSections,
} from "@/lib/claude/prompt-sections";

import type { PromptProject, PromptDocument, PromptMessage, PromptEpic } from "@/lib/claude/prompt-builder";

describe("prompt-sections", () => {
  describe("section()", () => {
    it("returns formatted heading + content", () => {
      expect(section("Title", "Body text")).toBe("## Title\n\nBody text\n");
    });

    it("returns empty string for null content", () => {
      expect(section("Title", null)).toBe("");
    });

    it("returns empty string for empty/whitespace content", () => {
      expect(section("Title", "   ")).toBe("");
    });

    it("trims content", () => {
      expect(section("Title", "  Body  ")).toBe("## Title\n\nBody\n");
    });
  });

  describe("systemSection()", () => {
    it("wraps system prompt with heading", () => {
      expect(systemSection("Be strict")).toBe("# System Instructions\n\nBe strict\n\n");
    });

    it("returns empty string for null", () => {
      expect(systemSection(null)).toBe("");
    });
  });

  describe("documentsSection()", () => {
    it("formats multiple documents with separators", () => {
      const docs: PromptDocument[] = [
        { name: "a.md", contentMd: "Content A" },
        { name: "b.md", contentMd: "Content B" },
      ];
      const result = documentsSection(docs);
      expect(result).toContain("## Reference Documents");
      expect(result).toContain("### a.md");
      expect(result).toContain("### b.md");
      expect(result).toContain("---");
    });

    it("returns empty string for empty array", () => {
      expect(documentsSection([])).toBe("");
    });
  });

  describe("existingEpicsSection()", () => {
    it("lists epics", () => {
      const epics: PromptEpic[] = [{ title: "Auth" }, { title: "Dashboard" }];
      const result = existingEpicsSection(epics);
      expect(result).toContain("## Existing Epics");
      expect(result).toContain("- Auth");
      expect(result).toContain("- Dashboard");
    });

    it("returns empty for no epics", () => {
      expect(existingEpicsSection([])).toBe("");
    });
  });

  describe("chatHistorySection()", () => {
    it("formats messages with role prefixes", () => {
      const messages: PromptMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const result = chatHistorySection(messages);
      expect(result).toContain("**User:**");
      expect(result).toContain("**Assistant:**");
    });

    it("returns empty for no messages", () => {
      expect(chatHistorySection([])).toBe("");
    });
  });

  describe("specSection()", () => {
    it("returns Project Specification section", () => {
      expect(specSection("Use Next.js")).toBe("## Project Specification\n\nUse Next.js\n");
    });

    it("returns empty for null", () => {
      expect(specSection(null)).toBe("");
    });
  });

  describe("projectHeader()", () => {
    it("returns project heading", () => {
      expect(projectHeader("Arij")).toBe("# Project: Arij\n");
    });
  });

  describe("descriptionSection()", () => {
    it("returns Project Description section", () => {
      expect(descriptionSection("A cool project")).toBe("## Project Description\n\nA cool project\n");
    });

    it("returns empty for null", () => {
      expect(descriptionSection(null)).toBe("");
    });
  });

  describe("projectContextSections()", () => {
    it("combines header + description + spec + documents", () => {
      const project: PromptProject = {
        name: "TestProj",
        description: "Desc",
        spec: "Spec content",
      };
      const docs: PromptDocument[] = [{ name: "doc.md", contentMd: "Doc content" }];
      const result = projectContextSections(project, docs);

      expect(result).toContain("# Project: TestProj");
      expect(result).toContain("## Project Description");
      expect(result).toContain("## Project Specification");
      expect(result).toContain("## Reference Documents");
    });

    it("omits null description and spec", () => {
      const project: PromptProject = { name: "TestProj" };
      const result = projectContextSections(project, []);

      expect(result).toContain("# Project: TestProj");
      expect(result).not.toContain("## Project Description");
      expect(result).not.toContain("## Project Specification");
    });
  });
});
