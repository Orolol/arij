/**
 * Where a spawn is allowed to run when its provider cannot be made read-only.
 *
 * Every provider but codex derives a read-only posture from `mode`: claude
 * passes `--permission-mode plan`, omp restricts `--tools`, agy passes
 * `--mode plan`. Codex cannot — its only switch that opens the MCP approval
 * gate also drops the sandbox (see codexApprovalArgs in ./codex.ts), so a
 * codex "plan" session has full write access to whatever directory it is
 * handed. The documented contract makes that acceptable by CONTAINMENT: the
 * agent works in a disposable per-ticket git worktree, where a stray write
 * costs at most the branch.
 *
 * That contract silently broke wherever a plan-mode spawn was pointed at the
 * main checkout instead — chat turns, spec generation, QA epic extraction,
 * conversation titling (cwd = Arij's own repository), dreaming, memory
 * distillation, forensic diagnostics. Measured 2026-09-10: five request paths
 * and six background dispatches, none of them in a worktree.
 *
 * This module is the one place that answers "is this cwd disposable?". The
 * codex preflight refuses a non-code spawn outside a worktree with an
 * actionable error instead of running an unsandboxed agent on the user's
 * repository; the refusal is loud on purpose, because an unenforced
 * restriction looks exactly like an enforced one in the output.
 */

import path from "path";
import fs from "node:fs";
import type { ProviderSpawnOptions } from "./types";

/**
 * Directory name every Arij worktree lives under — `<clone>/../.arij-worktrees/<branch>`
 * (lib/git/manager.ts). Stated here rather than imported so this check has no
 * dependency on git, the database or the workspace root.
 */
export const ARIJ_WORKTREES_DIR_NAME = ".arij-worktrees";

/**
 * True when `cwd` is inside an Arij worktree, i.e. a directory Arij created
 * for one ticket and can throw away. The main clone, the imported repository
 * path and `process.cwd()` all answer false.
 */
export function isDisposableWorktreePath(cwd: string | undefined | null): boolean {
  if (!cwd) return false;
  try {
    const segments = fs.realpathSync(path.resolve(cwd)).split(path.sep);
    const parent = segments.lastIndexOf(ARIJ_WORKTREES_DIR_NAME);
    return parent >= 0 && parent < segments.length - 1;
  } catch {
    return false;
  }
}

/** Modes whose contract is "the repository is not modified". */
const READ_ONLY_MODES: ReadonlySet<ProviderSpawnOptions["mode"]> = new Set([
  "plan",
  "chat",
  "analyze",
]);

/**
 * Whether the spawn relies on the provider honouring a restricted posture.
 * "code" restricts nothing and claims nothing, so it needs no containment
 * beyond what its caller already chose.
 */
export function isRestrictedMode(mode: ProviderSpawnOptions["mode"]): boolean {
  return READ_ONLY_MODES.has(mode);
}

/**
 * The reason an unsandboxable provider must not start this spawn, or `null`
 * when it may: a restricted mode is only allowed inside a disposable worktree.
 */
export function unsandboxedSpawnBlockReason(
  providerLabel: string,
  options: Pick<ProviderSpawnOptions, "mode" | "cwd">,
): string | null {
  if (!isRestrictedMode(options.mode)) return null;
  if (isDisposableWorktreePath(options.cwd)) return null;
  const where = options.cwd ? `"${options.cwd}"` : "the server's working directory";
  return (
    `${providerLabel} cannot run a "${options.mode}" session in ${where}: ` +
    `its CLI has no read-only posture (the only flag that enables MCP tool ` +
    `calls also disables the sandbox), so outside a disposable Arij worktree ` +
    `it would have full write access to that repository. Assign an agent ` +
    `with a read-only mode (claude-code, oh-my-pi or agy) to this task, or ` +
    `keep ${providerLabel} for build, review and merge sessions, which run ` +
    `in a per-ticket worktree.`
  );
}
