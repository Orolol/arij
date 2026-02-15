# Epic Creation Response Normalization

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where non-streaming and resume chat paths store raw JSON envelopes instead of normalized markdown, causing epic creation to fail.

**Architecture:** Add `parseClaudeOutput()` normalization to the two buggy code paths in `chat/stream/route.ts` that currently store raw provider output. This mirrors what the non-streaming `chat/route.ts` already does correctly at line 205.

**Tech Stack:** Next.js API routes, Vitest, `parseClaudeOutput` from `lib/claude/json-parser.ts`

---

### Task 1: Add test for non-streaming provider response normalization

**Files:**
- Modify: `__tests__/chat-stream-route.test.ts`

**Step 1: Write the failing test**

Add the following test at the end of the `describe` block in `__tests__/chat-stream-route.test.ts`:

```typescript
it("normalizes JSON envelope from non-streaming provider before storing", async () => {
  mockResolveAgentByNamedId.mockReturnValue({
    provider: "codex",
    model: undefined,
    namedAgentId: null,
  });

  // Simulate Codex returning a JSON result envelope wrapping markdown
  const envelope = JSON.stringify({
    type: "result",
    result: "Here is the epic:\n\n```json\n{\"title\": \"Auth\"}\n```",
    session_id: "codex-123",
  });
  mockDynamicProviderSpawn.mockReturnValue({
    promise: Promise.resolve({ success: true, result: envelope }),
    kill: vi.fn(),
  });

  mockDbState.getQueue = [
    { id: "proj1", name: "Arij", description: "desc", spec: "spec", gitRepoPath: null },
    { id: "conv1", type: "brainstorm", provider: "codex", label: "Chat" },
  ];
  mockDbState.allQueue = [
    [{ role: "user", content: "Hello", createdAt: "2026-01-01T10:00:00.000Z" }],
  ];

  const { POST } = await import("@/app/api/projects/[projectId]/chat/stream/route");
  const response = await POST(
    mockRequest({ content: "Create epic", conversationId: "conv1" }),
    { params: Promise.resolve({ projectId: "proj1" }) },
  );

  expect(response.status).toBe(200);
  const events = await readSseEvents(response as unknown as Response);

  // The stored message should be the extracted text, not the raw envelope
  const deltaEvents = events.filter((e) => e.delta);
  const combined = deltaEvents.map((e) => e.delta).join("");
  expect(combined).not.toContain('"type":"result"');
  expect(combined).toContain("Here is the epic:");
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/chat-stream-route.test.ts --reporter=verbose`
Expected: FAIL — the delta will contain the raw JSON envelope including `"type":"result"`

**Step 3: Commit the failing test**

```bash
git add __tests__/chat-stream-route.test.ts
git commit -m "test(chat): add failing test for provider response normalization in stream route"
```

---

### Task 2: Add test for resume path response normalization

**Files:**
- Modify: `__tests__/chat-stream-route.test.ts`

**Step 1: Write the failing test**

Add the following test to the same `describe` block:

```typescript
it("normalizes JSON envelope from Claude resume path before storing", async () => {
  mockResolveAgentByNamedId.mockReturnValue({
    provider: "claude-code",
    model: undefined,
    namedAgentId: null,
  });

  // Claude resume returns a result envelope
  const envelope = JSON.stringify({
    type: "result",
    result: "Resumed session output with epic details",
    session_id: "resume-456",
    subtype: "success",
  });
  mockSpawnHelpers.spawnClaude.mockReturnValue({
    promise: Promise.resolve({
      success: true,
      result: envelope,
      cliSessionId: "resume-456",
    }),
    kill: vi.fn(),
  });

  mockDbState.getQueue = [
    { id: "proj1", name: "Arij", description: "desc", spec: "spec", gitRepoPath: null },
    {
      id: "conv1",
      type: "brainstorm",
      provider: "claude-code",
      namedAgentId: null,
      cliSessionId: "resume-456",
      label: "Chat",
    },
  ];
  mockDbState.allQueue = [
    [{ role: "user", content: "Hello", createdAt: "2026-01-01T10:00:00.000Z" }],
  ];

  const { POST } = await import("@/app/api/projects/[projectId]/chat/stream/route");
  const response = await POST(
    mockRequest({ content: "Continue", conversationId: "conv1" }),
    { params: Promise.resolve({ projectId: "proj1" }) },
  );

  expect(response.status).toBe(200);
  const events = await readSseEvents(response as unknown as Response);

  const deltaEvents = events.filter((e) => e.delta);
  const combined = deltaEvents.map((e) => e.delta).join("");
  expect(combined).not.toContain('"type":"result"');
  expect(combined).toContain("Resumed session output with epic details");
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/chat-stream-route.test.ts --reporter=verbose`
Expected: FAIL — the delta will contain the raw JSON envelope

**Step 3: Commit the failing test**

```bash
git add __tests__/chat-stream-route.test.ts
git commit -m "test(chat): add failing test for resume path response normalization"
```

---

### Task 3: Fix non-streaming provider path

**Files:**
- Modify: `app/api/projects/[projectId]/chat/stream/route.ts`

**Step 1: Add import**

At line 13 of `route.ts`, add `parseClaudeOutput` to the existing imports from `@/lib/claude/json-parser` or add a new import:

```typescript
import { parseClaudeOutput } from "@/lib/claude/json-parser";
```

**Step 2: Normalize the non-streaming provider response**

Around line 356, change:

```typescript
const fullContent = result.success
  ? result.result || "(empty response)"
  : `Error: ${result.error || "Provider request failed"}`;
```

To:

```typescript
const fullContent = result.success
  ? parseClaudeOutput(result.result || "").content || "(empty response)"
  : `Error: ${result.error || "Provider request failed"}`;
```

**Step 3: Run tests to verify the first test passes**

Run: `npx vitest run __tests__/chat-stream-route.test.ts --reporter=verbose`
Expected: The "normalizes JSON envelope from non-streaming provider" test PASSES. The resume test may still fail.

---

### Task 4: Fix resume path

**Files:**
- Modify: `app/api/projects/[projectId]/chat/stream/route.ts`

**Step 1: Normalize the resume path response**

Around line 446, change:

```typescript
const fullContent = result.success
  ? result.result || "(empty response)"
  : `Error: ${result.error || "Provider request failed"}`;
```

To:

```typescript
const fullContent = result.success
  ? parseClaudeOutput(result.result || "").content || "(empty response)"
  : `Error: ${result.error || "Provider request failed"}`;
```

**Step 2: Run all tests to verify both tests pass**

Run: `npx vitest run __tests__/chat-stream-route.test.ts --reporter=verbose`
Expected: ALL tests PASS

**Step 3: Run the full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: No regressions

**Step 4: Commit the fix**

```bash
git add app/api/projects/[projectId]/chat/stream/route.ts __tests__/chat-stream-route.test.ts
git commit -m "fix(chat): normalize provider response in stream route before storing

The non-streaming provider and resume paths in chat/stream/route.ts
were storing raw JSON envelopes (e.g. {type:'result', result:'...'})
as message content. This caused epic creation to fail because the
frontend parser saw the full JSON model instead of extracted markdown.

Apply parseClaudeOutput() normalization to both paths, matching the
behavior already present in the non-streaming chat/route.ts."
```
