import { describe, expect, it } from "vitest";
import {
  EPIC_TITLE_REQUIRED,
  STORY_TITLE_REQUIRED,
  buildManualEpicPayload,
  createEmptyEpicDraft,
  createEmptyUserStory,
  validateManualEpicDraft,
  type ManualEpicDraft,
} from "@/lib/epics/manual-epic-form";

function draftWith(overrides: Partial<ManualEpicDraft> = {}): ManualEpicDraft {
  return { ...createEmptyEpicDraft(), ...overrides };
}

describe("validateManualEpicDraft", () => {
  it("requires a non-blank epic title", () => {
    const blank = validateManualEpicDraft(draftWith({ title: "   " }));
    expect(blank.valid).toBe(false);
    expect(blank.titleError).toBe(EPIC_TITLE_REQUIRED);

    const filled = validateManualEpicDraft(draftWith({ title: "Ship it" }));
    expect(filled.valid).toBe(true);
    expect(filled.titleError).toBeNull();
  });

  it("accepts an epic with zero user stories", () => {
    const result = validateManualEpicDraft(draftWith({ title: "Ship it" }));
    expect(result.valid).toBe(true);
    expect(result.storyErrors).toEqual({});
  });

  it("rejects an added user story left untitled", () => {
    const result = validateManualEpicDraft(
      draftWith({
        title: "Ship it",
        userStories: [
          { ...createEmptyUserStory("a"), title: "Story A" },
          { ...createEmptyUserStory("b"), description: "no title" },
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.storyErrors).toEqual({ b: STORY_TITLE_REQUIRED });
  });

  it("reports the epic title and story errors together", () => {
    const result = validateManualEpicDraft(
      draftWith({
        title: "",
        userStories: [createEmptyUserStory("a")],
      }),
    );

    expect(result.titleError).toBe(EPIC_TITLE_REQUIRED);
    expect(result.storyErrors.a).toBe(STORY_TITLE_REQUIRED);
  });
});

describe("buildManualEpicPayload", () => {
  it("trims text and drops empty optional fields to null", () => {
    const payload = buildManualEpicPayload(
      draftWith({
        title: "  Direct epic  ",
        description: "   ",
        userStories: [
          {
            key: "a",
            title: "  As a user...  ",
            description: "  why  ",
            acceptanceCriteria: "   ",
          },
        ],
      }),
    );

    expect(payload.title).toBe("Direct epic");
    expect(payload.description).toBeNull();
    expect(payload.userStories).toEqual([
      { title: "As a user...", description: "why", acceptanceCriteria: null },
    ]);
  });

  it("lands the epic in the backlog as a feature, like every other new ticket", () => {
    const payload = buildManualEpicPayload(draftWith({ title: "Direct epic" }));

    expect(payload.status).toBe("backlog");
    expect(payload.type).toBe("feature");
    expect(payload.userStories).toEqual([]);
  });

  it("preserves the order stories were added in", () => {
    const payload = buildManualEpicPayload(
      draftWith({
        title: "Direct epic",
        userStories: [
          { ...createEmptyUserStory("a"), title: "First" },
          { ...createEmptyUserStory("b"), title: "Second" },
          { ...createEmptyUserStory("c"), title: "Third" },
        ],
      }),
    );

    expect(payload.userStories.map((story) => story.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });
});
