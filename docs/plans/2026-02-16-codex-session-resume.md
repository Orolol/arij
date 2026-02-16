# Codex Session Resume Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Codex sessions to be resumed, fixing 3 gaps where resume parameters are dropped or Codex is excluded from resume logic.

**Architecture:** The `spawnCodex()` function already supports `codex exec resume <ID> <PROMPT>` mode. The fix is a passthrough change: (1) `CodexProvider.spawn()` must forward `cliSessionId`/`resumeSession` to `spawnCodex()`, (2) the resumable sessions endpoint must stop excluding codex, and (3) the build route and chat stream route must include codex in their resume-capable provider sets.

**Tech Stack:** TypeScript, Vitest, Next.js API routes, Drizzle ORM

---

### Task 1: CodexProvider passes resume parameters to spawnCodex

**Files:**
- Modify: `lib/providers/codex.ts:20-52`
- Test: `__tests__/codex-provider-developer-instructions.test.ts`

**Step 1: Write failing tests**

Add two tests to `__tests__/codex-provider-developer-instructions.test.ts`:

```typescript
it("passes cliSessionId and resumeSession to spawnCodex", () => {
  const provider = new CodexProvider();
  provider.spawn({
    sessionId: "test-session",
    prompt: "continue working",
    cwd: "/tmp/test",
    mode: "code",
    cliSessionId: "cli-abc-123",
    resumeSession: true,
  });

  expect(mockSpawnCodex).toHaveBeenCalledOnce();
  const opts = mockSpawnCodex.mock.calls[0][0];
  expect(opts.cliSessionId).toBe("cli-abc-123");
  expect(opts.resumeSession).toBe(true);
});

it("omits resume params when not provided", () => {
  const provider = new CodexProvider();
  provider.spawn({
    sessionId: "test-session",
    prompt: "fresh start",
    cwd: "/tmp/test",
    mode: "code",
  });

  expect(mockSpawnCodex).toHaveBeenCalledOnce();
  const opts = mockSpawnCodex.mock.calls[0][0];
  expect(opts.cliSessionId).toBeUndefined();
  expect(opts.resumeSession).toBeUndefined();
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/codex-provider-developer-instructions.test.ts`
Expected: FAIL — `cliSessionId` is `undefined` when it should be `"cli-abc-123"`

**Step 3: Fix CodexProvider.spawn() to forward resume params**

In `lib/providers/codex.ts`, modify the `spawn` method to destructure and pass `cliSessionId` and `resumeSession`:

```typescript
spawn(options: ProviderSpawnOptions): ProviderSession {
  const { sessionId, prompt, cwd, mode, model, onChunk, logIdentifier, cliSessionId, resumeSession } =
    options;

  const spawned = spawnCodex({
    mode,
    prompt,
    cwd,
    model,
    logIdentifier,
    cliSessionId,
    resumeSession,
    developerInstructions: CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS,
    // ... existing onRawChunk, onOutputChunk, onResponseChunk callbacks unchanged
  });
  // ... rest unchanged
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/codex-provider-developer-instructions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/providers/codex.ts __tests__/codex-provider-developer-instructions.test.ts
git commit -m "fix(codex): forward cliSessionId and resumeSession to spawnCodex"
```

---

### Task 2: Remove codex exclusion from resumable sessions endpoint

**Files:**
- Modify: `app/api/projects/[projectId]/sessions/resumable/route.ts:54-57`
- Test: `__tests__/codex-resume-sessions.test.ts` (new)

**Step 1: Write failing test**

Create `__tests__/codex-resume-sessions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbState = vi.hoisted(() => ({
  getQueue: [] as unknown[],
  allQueue: [] as unknown[],
}));

const mockResolveAgent = vi.hoisted(() => vi.fn());
const mockResolveAgentByNamedId = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  desc: vi.fn((v: unknown) => v),
  isNotNull: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn(() => mockDbState.getQueue.shift() ?? null),
    all: vi.fn(() => mockDbState.allQueue.shift() ?? []),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  agentSessions: {
    id: "id",
    projectId: "projectId",
    epicId: "epicId",
    userStoryId: "userStoryId",
    status: "status",
    provider: "provider",
    namedAgentId: "namedAgentId",
    agentType: "agentType",
    cliSessionId: "cliSessionId",
    claudeSessionId: "claudeSessionId",
    lastNonEmptyText: "lastNonEmptyText",
    completedAt: "completedAt",
  },
  namedAgents: { id: "id", provider: "provider" },
}));

vi.mock("@/lib/agent-config/providers", () => ({
  resolveAgent: mockResolveAgent,
  resolveAgentByNamedId: mockResolveAgentByNamedId,
}));

function mockRequest(url: string) {
  return new Request(url) as unknown as import("next/server").NextRequest;
}

describe("GET /api/projects/[projectId]/sessions/resumable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.getQueue = [];
    mockDbState.allQueue = [];
    mockResolveAgent.mockReturnValue({ provider: "codex", namedAgentId: null });
    mockResolveAgentByNamedId.mockReturnValue({ provider: "codex", namedAgentId: null });
  });

  it("returns resumable sessions for codex provider", async () => {
    mockDbState.allQueue = [
      [
        {
          id: "session-1",
          cliSessionId: "codex-cli-123",
          claudeSessionId: null,
          provider: "codex",
          namedAgentId: null,
          agentType: "build",
          lastNonEmptyText: "Done",
          completedAt: "2026-02-16T10:00:00Z",
        },
      ],
    ];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/sessions/resumable/route"
    );

    const res = await GET(
      mockRequest("http://localhost/api/projects/proj1/sessions/resumable?agentType=build&provider=codex"),
      { params: Promise.resolve({ projectId: "proj1" }) },
    );

    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].cliSessionId).toBe("codex-cli-123");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/codex-resume-sessions.test.ts`
Expected: FAIL — returns empty array `[]` due to early return for codex

**Step 3: Remove codex exclusion**

In `app/api/projects/[projectId]/sessions/resumable/route.ts`, remove lines 54-57:

```typescript
// DELETE these lines:
// if (resolvedProvider === "codex") {
//   return NextResponse.json({ data: [] });
// }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/codex-resume-sessions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add app/api/projects/[projectId]/sessions/resumable/route.ts __tests__/codex-resume-sessions.test.ts
git commit -m "fix(codex): allow codex sessions to appear in resumable endpoint"
```

---

### Task 3: Include codex in resume-capable providers for build route

**Files:**
- Modify: `app/api/projects/[projectId]/epics/[epicId]/build/route.ts:157-158`

**Step 1: Modify build route**

Change line 157-158 from:

```typescript
const providerSupportsResume =
  resolvedAgent.provider === "claude-code" || resolvedAgent.provider === "gemini-cli";
```

To:

```typescript
const providerSupportsResume =
  resolvedAgent.provider === "claude-code" ||
  resolvedAgent.provider === "gemini-cli" ||
  resolvedAgent.provider === "codex";
```

**Step 2: Run existing build route tests**

Run: `npx vitest run __tests__/build-route.test.ts`
Expected: PASS (no regressions)

**Step 3: Commit**

```bash
git add app/api/projects/[projectId]/epics/[epicId]/build/route.ts
git commit -m "fix(codex): include codex in resume-capable providers for build route"
```

---

### Task 4: Include codex in resume-capable providers for chat stream

**Files:**
- Modify: `app/api/projects/[projectId]/chat/stream/route.ts:20-23`

**Step 1: Add codex to RESUME_CAPABLE_PROVIDERS**

Change:

```typescript
const RESUME_CAPABLE_PROVIDERS = new Set<ProviderType>([
  "claude-code",
  "gemini-cli",
]);
```

To:

```typescript
const RESUME_CAPABLE_PROVIDERS = new Set<ProviderType>([
  "claude-code",
  "gemini-cli",
  "codex",
]);
```

**Step 2: Run existing chat stream tests**

Run: `npx vitest run __tests__/chat-stream-route.test.ts`
Expected: PASS (no regressions)

**Step 3: Commit**

```bash
git add app/api/projects/[projectId]/chat/stream/route.ts
git commit -m "fix(codex): include codex in resume-capable chat providers"
```

---

### Task 5: Add integration-level test for Codex chat resume with fallback

**Files:**
- Modify: `__tests__/chat-stream-route.test.ts`

**Step 1: Add Codex resume fallback test**

Add to the existing `describe` block:

```typescript
it("falls back to fresh Codex run when resume session is expired", async () => {
  mockResolveAgentByNamedId.mockReturnValue({
    provider: "codex",
    model: undefined,
    namedAgentId: null,
  });

  const firstSession = {
    promise: Promise.resolve({
      success: false,
      error: "session not found",
      cliSessionId: "expired-codex",
    }),
    kill: vi.fn(),
  };
  const secondSession = {
    promise: Promise.resolve({
      success: true,
      result: "Fresh codex fallback",
      cliSessionId: "new-codex-session",
    }),
    kill: vi.fn(),
  };

  mockDynamicProviderSpawn
    .mockReturnValueOnce(firstSession)
    .mockReturnValueOnce(secondSession);

  mockDbState.getQueue = [
    { id: "proj1", name: "Arij", description: "desc", spec: "spec", gitRepoPath: null },
    {
      id: "conv-codex",
      type: "brainstorm",
      provider: "codex",
      namedAgentId: null,
      cliSessionId: "expired-codex",
      label: "Chat",
    },
  ];
  mockDbState.allQueue = [
    [{ role: "user", content: "Previous", createdAt: "2026-01-01T10:00:00.000Z" }],
  ];

  const { POST } = await import("@/app/api/projects/[projectId]/chat/stream/route");
  const response = await POST(
    mockRequest({ content: "Continue", conversationId: "conv-codex" }),
    { params: Promise.resolve({ projectId: "proj1" }) },
  );

  expect(response.status).toBe(200);
  const events = await readSseEvents(response as unknown as Response);
  expect(events.some((e) => e.delta === "Fresh codex fallback")).toBe(true);
  expect(mockDynamicProviderSpawn).toHaveBeenCalledTimes(2);
  expect(mockDynamicProviderSpawn.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      prompt: "Continue",
      cliSessionId: "expired-codex",
      resumeSession: true,
    }),
  );
  expect(mockDynamicProviderSpawn.mock.calls[1]?.[0]).toEqual(
    expect.objectContaining({
      prompt: "CHAT_PROMPT",
      resumeSession: false,
    }),
  );
});
```

**Step 2: Run all tests**

Run: `npx vitest run __tests__/chat-stream-route.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add __tests__/chat-stream-route.test.ts
git commit -m "test(codex): add resume fallback test for codex chat sessions"
```

---

### Task 6: Final verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 2: Final commit (if needed)**

```bash
git commit -m "feat(codex): enable session resume for codex provider"
```
