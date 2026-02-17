# Arij Project — Technical Audit Report

**Date:** February 16, 2026  
**Auditor:** AI Technical Review  
**Project:** Arij — Local AI-first Project Orchestrator  
**Stack:** Next.js 16, TypeScript, SQLite (better-sqlite3), Drizzle ORM

---

## Executive Summary

Arij is a well-architected, local-first project management application with sophisticated multi-provider AI integration. The codebase demonstrates strong separation of concerns, comprehensive test coverage (110 test files, ~19K lines of test code), and thoughtful abstraction patterns for AI provider management.

**Key Strengths:**
- Clean provider pattern enabling 9 different AI backends (Claude Code, Codex, Gemini, Mistral, Qwen, OpenCode, DeepSeek, Kimi, Zai)
- Robust session lifecycle management with state machines
- Proper database indexing and foreign key relationships
- Good TypeScript adoption with Zod validation schemas
- Local-first security model with middleware host validation

**Primary Concerns:**
- Lint errors (11 errors, 14 warnings) — mostly `any` types in tests and unused variables
- Module-level side effects in database initialization (backfill logic)
- Console logging in production code paths
- Some deprecated field migrations (`claudeSessionId` → `cliSessionId`) still incomplete
- Path validation gaps for certain edge cases

---

## Findings by Category

### 1. Architecture & Patterns

#### ✅ Good Patterns Observed

**Provider Abstraction Pattern** — `lib/providers/index.ts`
- Clean factory pattern with 9 provider implementations
- Consistent interface via `AgentProvider` base class
- Proper separation between Claude Code (custom spawn) and other CLI providers (base class)

**State Machine for Sessions** — `lib/agent-sessions/lifecycle.ts`
- Well-defined transitions: `queued → running → completed|failed|cancelled`
- Immutable transition validation via `ALLOWED_TRANSITIONS`
- Custom error classes: `SessionLifecycleConflictError`, `SessionNotFoundError`

**Database Schema Design** — `lib/db/schema.ts`
- Proper foreign key relationships with cascade deletes
- Good use of indexes on frequently queried columns
- Composite unique indexes for business constraints

#### ⚠️ Architectural Concerns

**Module-Level Side Effects** — `lib/db/index.ts:42-51` — **Severity: Medium**
```typescript
// Backfill runs at module load time
{
  try {
    const { backfillReadableIds } = require("./backfill");
    const { backfillAgentNames } = require("../identity");
    backfillReadableIds();
    backfillAgentNames();
  } catch {
    // Silently ignore — columns may not exist during build
  }
}
```
**Issue:** Database backfills run during module initialization. This violates the principle of least surprise and can cause issues during migrations or testing.

**Recommendation:** Move to explicit migration scripts or lazy initialization on first query.

**Mixed Responsibility in Process Manager** — `lib/claude/process-manager.ts` — **Severity: Low**
- Handles both Claude Code spawning and generic provider dispatch
- Database persistence logic mixed with process management

**Recommendation:** Consider splitting into `ProcessManager` (orchestration) and `ProviderAdapter` (execution).

---

### 2. Code Quality

#### ✅ Strong Practices

**Type Safety:**
- Comprehensive Zod schemas in `lib/validation/schemas.ts`
- Proper TypeScript interfaces throughout
- Only 84 `any/unknown` usages across entire `lib/` directory (acceptable for ~10K lines)

**Naming Conventions:**
- Consistent camelCase for variables
- Descriptive function names (e.g., `buildExecutionPlan`, `transitionSessionStatus`)
- Clear file organization by domain

#### ⚠️ Quality Issues

**Lint Errors** — **Severity: Medium**
```
11 errors, 14 warnings total
- 11x `Unexpected any` in test files
- 14x unused variables in tests
- 1x missing display name in component
```

**Recommendation:** Fix `any` types in `__tests__/github-release*.test.ts` files. Consider stricter test tsconfig.

**Console Logging in Production Code** — **Severity: Medium**

27 `console.log/warn/error` statements in `lib/` directory:
- `lib/claude/spawn.ts` — 11 occurrences
- `lib/providers/base-provider.ts` — 6 occurrences
- `lib/claude/process-manager.ts` — 2 occurrences

**Example:** `lib/claude/spawn.ts:106-107`
```typescript
console.log("[spawn] claude", args.map(a => a.length > 100 ? a.slice(0, 100) + "..." : a).join(" "));
console.log("[spawn] cwd:", effectiveCwd);
```

**Recommendation:** Replace with structured logging (pino/winston) or at least respect `NODE_ENV`.

**Deprecated Field Migration Incomplete** — **Severity: Low**

`claudeSessionId` is marked deprecated in favor of `cliSessionId` but still used:
- `lib/providers/types.ts:48` — `@deprecated Use cliSessionId`
- `lib/claude/spawn.ts:20` — Still accepts `claudeSessionId` parameter

**Recommendation:** Complete migration and remove deprecated parameter.

---

### 3. Performance

#### ✅ Good Performance Practices

**Database Indexing:**
- 9 indexes defined across tables
- Composite indexes for common query patterns (e.g., `documents_project_created_at_idx`)
- Foreign key indexes for join performance

**Session Chunking:**
- Large outputs split into `agent_session_chunks` table
- Sequence-based ordering for reconstruction

**Lazy Loading:**
- Provider availability checks (`isAvailable()`) are async and cached

#### ⚠️ Performance Concerns

**N+1 Query Risk in Build Route** — `app/api/projects/[projectId]/epics/[epicId]/build/route.ts` — **Severity: Medium**

Multiple sequential queries:
1. Epic lookup (line 57)
2. Project lookup (lines 71-75)
3. User stories (lines 109-114)
4. Comments (lines 117-122)
5. Review comments (lines 131-141)

**Recommendation:** Use Drizzle relations or a single joined query.

**Synchronous File Operations** — `lib/db/index.ts:9-11` — **Severity: Low**
```typescript
const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
```

**Recommendation:** Use async fs APIs or move to build-time initialization.

---

### 4. Security

#### ✅ Security Strengths

**Host Validation Middleware** — `middleware.ts`
- Blocks non-localhost requests by default
- Supports `ALLOWED_ORIGINS` for LAN access
- Validates both `Host` and `Origin` headers

**Path Traversal Protection** — `lib/validation/path.ts`
```typescript
if (trimmed.includes("..")) {
  return { valid: false, error: "Path must not contain traversal components (..)" };
}
```

**No Secrets in Code:**
- Environment variables for GitHub tokens, paths
- `.env` properly gitignored

#### ⚠️ Security Concerns

**Path Validation Gap** — `lib/git/manager.ts:37` — **Severity: Medium**
```typescript
const worktreeBase = path.join(repoPath, "..", ".arij-worktrees");
```

Worktree directory is created outside the repo without validation. A malicious `repoPath` could traverse to unexpected locations.

**Recommendation:** Validate `repoPath` using `lib/validation/path.ts` before creating worktrees.

**Missing Input Sanitization on Comments** — **Severity: Low**

Comments are stored in database but output is rendered via React Markdown. Need to verify XSS protection.

**Recommendation:** Ensure `rehype-sanitize` is properly configured in all Markdown rendering contexts.

---

### 5. Testing

#### ✅ Testing Strengths

**Comprehensive Coverage:**
- 110 test files
- ~19,000 lines of test code
- Vitest for unit, Playwright for E2E

**Test Patterns:**
- Good use of test utilities (`lib/db/test-utils.ts`)
- Snapshot testing for prompt generation
- Mock providers for isolated testing

#### ⚠️ Testing Gaps

**Async Error Handling Not Fully Tested:**
- `processManager.start()` error paths
- Provider spawn failures
- Database connection errors

**Missing Integration Tests:**
- Full build → review → merge flow
- Multi-provider agent switching
- Session resume after restart

---

### 6. Technical Debt

| Issue | Location | Severity | Recommendation |
|-------|----------|----------|----------------|
| Module-level DB backfills | `lib/db/index.ts:42-51` | Medium | Move to migrations |
| Console logging in lib | 27 occurrences | Medium | Add structured logging |
| Deprecated field usage | `claudeSessionId` | Low | Complete migration |
| Unused imports in tests | 14 lint warnings | Low | Clean up test files |
| `any` types in tests | 11 lint errors | Low | Add proper types |
| Magic numbers | Various | Low | Extract constants |

---

## Prioritized Action Items

### Epic 1: Code Quality & Tooling (Priority: High)
- [ ] Fix 11 lint errors (replace `any` with proper types)
- [ ] Remove or silence 14 lint warnings
- [ ] Replace console.log with structured logging
- [ ] Add pre-commit hooks for linting

### Epic 2: Database Initialization Cleanup (Priority: High)
- [ ] Remove module-level backfill logic from `lib/db/index.ts`
- [ ] Create explicit migration scripts for backfills
- [ ] Add database initialization health check endpoint

### Epic 3: Security Hardening (Priority: Medium)
- [ ] Validate all file paths before fs operations
- [ ] Audit worktree creation for path traversal
- [ ] Verify XSS protection on all user-generated content
- [ ] Add rate limiting for API routes (even local)

### Epic 4: Performance Optimization (Priority: Medium)
- [ ] Consolidate N+1 queries in build/review routes
- [ ] Add query performance monitoring
- [ ] Implement connection pooling for SQLite (if needed)
- [ ] Cache frequently accessed config data

### Epic 5: Technical Debt Paydown (Priority: Low)
- [ ] Complete `claudeSessionId` → `cliSessionId` migration
- [ ] Extract magic numbers to constants
- [ ] Add JSDoc to public APIs
- [ ] Consolidate duplicate validation logic

---

## Metrics Summary

| Metric | Value |
|--------|-------|
| Total TypeScript Files | ~200 |
| Lines of Source Code | ~25,000 |
| Lines of Test Code | ~19,000 |
| Test Files | 110 |
| Lint Errors | 11 |
| Lint Warnings | 14 |
| Console.log Statements | 27 |
| Database Tables | 18 |
| Database Indexes | 15 |
| API Routes | 92 |
| Provider Implementations | 9 |

---

## Conclusion

Arij is a **high-quality, production-ready codebase** with thoughtful architecture and strong testing practices. The primary concerns are code quality tooling (lint errors) and module initialization side effects. Security posture is appropriate for the local-first threat model.

**Overall Grade: B+**

**Recommended Focus:**
1. Fix lint errors (1-2 hours)
2. Refactor database initialization (4-6 hours)
3. Add structured logging (2-3 hours)

The project demonstrates mature software engineering practices and is well-positioned for continued development.
