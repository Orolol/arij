# Fix: Git Diff Not Detecting Changes

**Date:** 2026-02-17
**Epic:** J'ai l'impression que le git diff ne marche pas toujours

## Problem

When an agent completes work on an epic, the diff viewer shows "No changes detected. The branch may not have diverged from main yet." — even though the agent made commits.

## Root Cause

`createWorktree()` in `lib/git/manager.ts:57` runs:

```
git worktree add -b <branch> <path>
```

This creates the branch from the **current HEAD** of the main repo, which is usually already on `main`. So `merge-base main <branch>` returns the same commit, producing an empty diff.

Additionally, `getWorktreeDiff()` only compares committed changes via `merge-base`. It does not detect:
- Uncommitted/unstaged changes in the worktree
- The case where the branch was merged back to main (merge-base advances)

## Fix

### 1. Worktree creation: explicitly base from main

```
git worktree add -b <branch> <path> main
```

This ensures the branch always starts from the tip of `main`, regardless of what the main repo's HEAD points to.

### 2. Diff fallback: include uncommitted changes

When `merge-base` diff is empty, also run `git diff HEAD` and `git diff --cached` to capture uncommitted work.

### 3. Diff metadata: return branch info alongside diff

Add `aheadBehind` counts and `branchName` to the API response so the UI can show context when the diff is empty (e.g., "Branch is 3 commits ahead of main").

### 4. UI: better empty state with diagnostics

Instead of just "No changes detected", show:
- Commit count ahead/behind
- Whether there are uncommitted changes
- A hint about what might be wrong

## Files Changed

- `lib/git/manager.ts` — Fix `createWorktree()` base commit
- `lib/git/diff.ts` — Add uncommitted change detection, metadata
- `app/api/projects/[projectId]/epics/[epicId]/diff/route.ts` — Return metadata
- `hooks/useDiff.ts` — Handle new metadata
- `components/review/DiffViewer.tsx` — Better empty state
- `__tests__/diff-parser.test.ts` — Add tests for new logic
- `__tests__/worktree-diff.test.ts` — New test for diff with metadata
