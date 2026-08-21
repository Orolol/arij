import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const mockValidateMentionsExist = vi.hoisted(() => vi.fn());

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "comment-1"),
}));

vi.mock("@/lib/documents/mentions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documents/mentions")>(
    "@/lib/documents/mentions"
  );
  return {
    ...actual,
    validateMentionsExist: mockValidateMentionsExist,
  };
});

describe("Comment mention validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    mockValidateMentionsExist.mockImplementation(() => ({ mentions: [] }));
  });

  it("blocks epic comment submit when mention validation fails", async () => {
    const { MentionResolutionError } = await import("@/lib/documents/mentions");
    dbMockState.getQueue = [{ id: "epic-1" }];
    mockValidateMentionsExist.mockImplementation(() => {
      throw new MentionResolutionError(["missing.md"]);
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/comments/route"
    );

    const res = await POST(
      mockJsonRequest({ author: "user", content: "use @missing.md" }),
      mockRouteContext({ projectId: "proj-1", epicId: "epic-1" })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Unknown document mention");
  });

  /**
   * Agents write `@src/foo.ts` about the project's own codebase — that is not
   * an Arij document reference, and bouncing the comment blocked the run.
   */
  it("lets an agent comment through without resolving its mentions", async () => {
    const { MentionResolutionError } = await import("@/lib/documents/mentions");
    dbMockState.getQueue = [{ id: "epic-1" }, { id: "comment-1" }];
    mockValidateMentionsExist.mockImplementation(() => {
      throw new MentionResolutionError(["src/foo.ts"]);
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/comments/route"
    );

    const res = await POST(
      mockJsonRequest({ author: "agent", content: "I updated @src/foo.ts" }),
      mockRouteContext({ projectId: "proj-1", epicId: "epic-1" })
    );

    expect(res.status).toBe(201);
    expect(mockValidateMentionsExist).not.toHaveBeenCalled();
  });

  it("blocks story comment submit when mention validation fails", async () => {
    const { MentionResolutionError } = await import("@/lib/documents/mentions");
    dbMockState.getQueue = [{ id: "story-1" }];
    mockValidateMentionsExist.mockImplementation(() => {
      throw new MentionResolutionError(["missing.png"]);
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/stories/[storyId]/comments/route"
    );

    const res = await POST(
      mockJsonRequest({ author: "user", content: "see @missing.png" }),
      mockRouteContext({ projectId: "proj-1", storyId: "story-1" })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Unknown document mention");
  });
});
