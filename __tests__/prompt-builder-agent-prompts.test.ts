import { describe, expect, it } from "vitest";
import {
  buildBuildPrompt,
  buildChatPrompt,
  buildCustomEpicReviewPrompt,
  buildE2eTestPrompt,
  buildEpicReviewPrompt,
  buildReviewPrompt,
  buildSpecPrompt,
  buildTechCheckPrompt,
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
    const techCheck = buildTechCheckPrompt(
      project,
      "Focus on auth/session flows.",
      systemPrompt
    );

    expect(build).toContain("System Instructions");
    expect(chat).toContain("System Instructions");
    expect(spec).toContain("System Instructions");
    expect(team).toContain("System Instructions");
    expect(ticket).toContain("System Instructions");
    expect(techCheck).toContain("System Instructions");
    expect(techCheck).toContain("Focus on auth/session flows.");
    expect(techCheck).toContain("Comprehensive Tech Check");
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

  it("reuses shared project/doc/story sections in epic-level review prompts", () => {
    const epic = {
      title: "Epic 1",
      description: "Cross-cutting improvements",
    };

    const customEpicReview = buildCustomEpicReviewPrompt(
      project,
      docs,
      epic,
      [story],
      "Architecture Review",
      "Focus on boundaries and coupling.",
      "Custom global prompt"
    );

    const epicReview = buildEpicReviewPrompt(
      project,
      docs,
      epic,
      [story],
      "feature_review",
      "Built-in global prompt"
    );

    expect(customEpicReview).toContain("# Project: Arij");
    expect(customEpicReview).toContain("## Project Specification");
    expect(customEpicReview).toContain("## Reference Documents");
    expect(customEpicReview).toContain("- **As a dev I want tests**");

    expect(epicReview).toContain("# Project: Arij");
    expect(epicReview).toContain("## Project Specification");
    expect(epicReview).toContain("## Reference Documents");
    expect(epicReview).toContain("- **As a dev I want tests**");
  });

  it("bug ticket review uses bug-specific labels and skips user stories", () => {
    const bugEpic = {
      title: "Fix login crash",
      description: "App crashes when user logs in with empty password",
      type: "bug" as const,
    };

    const featureReview = buildEpicReviewPrompt(
      project,
      docs,
      bugEpic,
      [story],
      "feature_review",
      "System prompt"
    );

    // Uses "Bug Under Review" instead of "Epic Under Review"
    expect(featureReview).toContain("## Bug Under Review");
    expect(featureReview).not.toContain("## Epic Under Review");

    // Uses bug fix verification instead of feature review
    expect(featureReview).toContain("bug fix verification");
    expect(featureReview).not.toContain("feature completeness review");

    // Uses bug-specific checklist
    expect(featureReview).toContain("Bug Fix Verification Checklist");
    expect(featureReview).not.toContain("Feature Completeness Checklist");

    // Skips user stories section (bug tickets have no stories)
    expect(featureReview).not.toContain("## User Stories");

    // Uses bug-specific verdict
    expect(featureReview).toContain("Bug Fixed");

    // Warns agent to focus on this bug only
    expect(featureReview).toContain("This is a BUG FIX review");
    expect(featureReview).toContain("Do NOT review unrelated features");
  });

  it("bug ticket non-feature review adapts instructions but keeps standard checklist", () => {
    const bugEpic = {
      title: "Fix XSS vulnerability",
      description: "User input not sanitized in search field",
      type: "bug" as const,
    };

    const securityReview = buildEpicReviewPrompt(
      project,
      docs,
      bugEpic,
      [],
      "security",
      "System prompt"
    );

    // Uses "Bug Under Review" label
    expect(securityReview).toContain("## Bug Under Review");
    expect(securityReview).not.toContain("## Epic Under Review");

    // Still uses the standard security checklist
    expect(securityReview).toContain("Security Audit Checklist");

    // Adapts the instructions to mention bug fix
    expect(securityReview).toContain("bug fix");
    expect(securityReview).toContain("This is a BUG FIX review");
  });

  it("feature epic review is unchanged (backward compatible)", () => {
    const featureEpic = {
      title: "Add dark mode",
      description: "Implement dark mode toggle",
      type: "feature" as const,
    };

    const review = buildEpicReviewPrompt(
      project,
      docs,
      featureEpic,
      [story],
      "feature_review",
      "System prompt"
    );

    expect(review).toContain("## Epic Under Review");
    expect(review).not.toContain("## Bug Under Review");
    expect(review).toContain("feature completeness review");
    expect(review).toContain("Feature Completeness Checklist");
    expect(review).toContain("## User Stories");
  });

  it("epic without type defaults to feature behavior", () => {
    const noTypeEpic = {
      title: "Some epic",
      description: "No type specified",
    };

    const review = buildEpicReviewPrompt(
      project,
      docs,
      noTypeEpic,
      [story],
      "feature_review",
      "System prompt"
    );

    expect(review).toContain("## Epic Under Review");
    expect(review).toContain("feature completeness review");
    expect(review).toContain("## User Stories");
  });

  it("QA prompts (tech check and e2e) never include project documents", () => {
    const techCheck = buildTechCheckPrompt(
      project,
      "Custom instructions",
      "System prompt"
    );
    const e2e = buildE2eTestPrompt(
      project,
      "Custom instructions",
      "System prompt"
    );

    // Neither prompt should contain a reference documents section
    expect(techCheck).not.toContain("Reference Documents");
    expect(e2e).not.toContain("Reference Documents");

    // Both should still contain core sections
    expect(techCheck).toContain("# Project: Arij");
    expect(techCheck).toContain("Comprehensive Tech Check");
    expect(e2e).toContain("# Project: Arij");
    expect(e2e).toContain("Comprehensive E2E Test");
  });
});
