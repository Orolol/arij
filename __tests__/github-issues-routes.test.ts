import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSync = vi.hoisted(() => vi.fn());
const mockIsDue = vi.hoisted(() => vi.fn());
const mockList = vi.hoisted(() => vi.fn());
const mockImport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/github/issues", () => ({
  syncProjectGitHubIssues: mockSync,
  isGitHubIssueSyncDue: mockIsDue,
  listTriagedIssues: mockList,
  importGitHubIssuesAsTickets: mockImport,
}));

describe("GitHub issues routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET triage triggers sync when due and returns issues", async () => {
    mockIsDue.mockReturnValue(true);
    mockSync.mockResolvedValue({ synced: 10 });
    mockList.mockReturnValue([{ id: "ghi_1", issueNumber: 123, title: "Bug" }]);

    const { GET } = await import(
      "@/app/api/projects/[projectId]/github/issues/triage/route"
    );

    const req = {
      nextUrl: new URL("http://localhost/api/projects/proj-1/github/issues/triage?label=bug"),
    } as unknown as import("next/server").NextRequest;

    const res = await GET(req, { params: Promise.resolve({ projectId: "proj-1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith("proj-1");
    expect(mockList).toHaveBeenCalledWith("proj-1", {
      label: "bug",
      milestone: null,
    });
    expect(json.data).toHaveLength(1);
  });

  it("POST import validates issueNumbers and imports selected issues", async () => {
    mockImport.mockReturnValue([
      { issueNumber: 1, epicId: "ep_1", type: "feature" },
      { issueNumber: 2, epicId: "ep_2", type: "bug" },
    ]);

    const { POST } = await import(
      "@/app/api/projects/[projectId]/github/issues/import/route"
    );

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueNumbers: [1, 2] }),
    }) as unknown as import("next/server").NextRequest;

    const res = await POST(request, {
      params: Promise.resolve({ projectId: "proj-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(mockImport).toHaveBeenCalledWith("proj-1", [1, 2]);
    expect(json.data.imported).toHaveLength(2);
  });
});
