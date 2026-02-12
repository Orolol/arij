import { describe, expect, it } from "vitest";
import {
  buildBuildPrompt,
  buildChatPrompt,
  buildReviewPrompt,
  buildSpecPrompt,
  buildTeamBuildPrompt,
  buildTicketBuildPrompt,
  type PromptDocument,
  type PromptProject,
  type PromptUserStory,
} from "@/lib/claude/prompt-builder";

const project: PromptProject = {
  name: "Arij",
  spec: "Project specification",
};

const docs: PromptDocument[] = [
  { name: "README.md", contentMd: "Context docs" },
];

const story: PromptUserStory = {
  title: "As a dev I want tests",
  description: "Add tests",
  acceptanceCriteria: "- [ ] Unit tests",
};

describe("Prompt builders with resolved system prompts", () => {
  it("injects custom system prompt for build/chat/spec/team/ticket builders", () => {
    const systemPrompt = "Follow project conventions strictly.";
    const build = buildBuildPrompt(
      project,
      docs,
      { title: "Epic 1" },
      [story],
      systemPrompt
    );
    const chat = buildChatPrompt(
      project,
      docs,
      [{ role: "user", content: "Help me" }],
      systemPrompt
    );
    const spec = buildSpecPrompt(project, docs, [], systemPrompt);
    const team = buildTeamBuildPrompt(
      project,
      docs,
      [
        {
          title: "Epic 1",
          worktreePath: "/tmp/wt",
          userStories: [story],
        },
      ],
      systemPrompt
    );
    const ticket = buildTicketBuildPrompt(
      project,
      docs,
      { title: "Epic 1" },
      story,
      [],
      systemPrompt
    );

    expect(build).toContain("System Instructions");
    expect(chat).toContain("System Instructions");
    expect(spec).toContain("System Instructions");
    expect(team).toContain("System Instructions");
    expect(ticket).toContain("System Instructions");
  });

  it("buildReviewPrompt supports built-in and custom review agents", () => {
    const builtIn = buildReviewPrompt(
      project,
      docs,
      { title: "Epic 1" },
      story,
      "security",
      "Built-in system prompt"
    );
    const custom = buildReviewPrompt(
      project,
      docs,
      { title: "Epic 1" },
      story,
      {
        name: "UI Review",
        systemPrompt: "Review layout consistency and visual hierarchy.",
      },
      "Custom system prompt"
    );

    expect(builtIn).toContain("Security Audit Checklist");
    expect(builtIn).toContain("Built-in system prompt");
    expect(custom).toContain("Custom Review Agent Instructions");
    expect(custom).toContain("UI Review");
    expect(custom).toContain("layout consistency");
  });
});
