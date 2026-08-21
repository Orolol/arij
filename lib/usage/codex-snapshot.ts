import fs from "fs";
import os from "os";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { providerUsageSnapshots } from "@/lib/db/schema";
import {
  extractLatestRateLimitSnapshot,
  type ParsedRateLimitSnapshot,
} from "@/lib/usage/codex-rate-limits";
import type { CodexLiveQuota } from "@/lib/types/usage";

/**
 * Filesystem side of the codex quota capture.
 *
 * Arij's OWN stream logs (`data/logs/*.ndjson`) never contain `rate_limits` —
 * verified by grep over both log trees. The only place codex records account
 * quota is its own rollout transcript under `~/.codex/sessions`, which every
 * codex run persists (Arij's `buildArgs` passes neither `--json` nor
 * `--ephemeral`, so Arij-spawned runs land there too, alongside the user's
 * interactive sessions).
 *
 * Reads only. Spawning a CLI to ask for quota is forbidden: it would burn the
 * user's subscription to render a dashboard.
 */

export const CODEX_PROVIDER = "codex";

/** At most this many day directories are opened, newest first. */
const MAX_DAY_DIRS = 5;
/** At most this many rollout files are considered, newest mtime first. */
const DEFAULT_MAX_FILES = 10;

/** `~/.codex/sessions` — resolved lazily so tests can inject their own root. */
export function defaultCodexSessionsRoot(): string {
  return path.join(os.homedir(), ".codex", "sessions");
}

/** Directory names in DESCENDING lexicographic order (zero-padded = newest first). */
function listDirsDesc(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * Newest-first rollout candidates.
 *
 * Walks `root/YYYY/MM/DD` in descending name order, collects
 * `rollout-*.jsonl` from at most the 5 newest day directories, caps the list
 * at `maxFiles` and sorts by mtime desc. Bounded on purpose: this runs on
 * every `GET /api/usage`, and a years-deep sessions tree must not turn a page
 * load into a full-disk walk.
 *
 * Any FS error (missing root, unreadable dir) yields `[]` — never a throw.
 */
export function findRecentRolloutFiles(
  root: string = defaultCodexSessionsRoot(),
  maxFiles: number = DEFAULT_MAX_FILES,
): string[] {
  const dayDirs: string[] = [];

  try {
    outer: for (const year of listDirsDesc(root)) {
      const yearDir = path.join(root, year);
      for (const month of listDirsDesc(yearDir)) {
        const monthDir = path.join(yearDir, month);
        for (const day of listDirsDesc(monthDir)) {
          dayDirs.push(path.join(monthDir, day));
          if (dayDirs.length >= MAX_DAY_DIRS) break outer;
        }
      }
    }
  } catch {
    return [];
  }

  const files: Array<{ filePath: string; mtimeMs: number }> = [];
  for (const dir of dayDirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) {
        continue;
      }
      const filePath = path.join(dir, entry.name);
      try {
        files.push({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs });
      } catch {
        // Vanished between readdir and stat — ignore.
      }
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, Math.max(0, maxFiles)).map((file) => file.filePath);
}

/**
 * Upsert, but only forward in time.
 *
 * `captured_at` is the PROVIDER event timestamp, so an older rollout file must
 * never overwrite a newer snapshot. ISO-8601 UTC strings with the same shape
 * compare correctly lexicographically, which is also how they are compared in
 * SQL elsewhere in the codebase.
 */
function storeSnapshot(
  snapshot: ParsedRateLimitSnapshot,
  sourceFile: string,
): void {
  const existing = db
    .select()
    .from(providerUsageSnapshots)
    .where(eq(providerUsageSnapshots.provider, CODEX_PROVIDER))
    .get();

  if (existing && existing.capturedAt >= snapshot.capturedAt) return;

  const row = {
    provider: CODEX_PROVIDER,
    capturedAt: snapshot.capturedAt,
    planType: snapshot.planType,
    primaryUsedPercent: snapshot.primary?.usedPercent ?? null,
    primaryWindowMinutes: snapshot.primary?.windowMinutes ?? null,
    primaryResetsAt: snapshot.primary?.resetsAt ?? null,
    secondaryUsedPercent: snapshot.secondary?.usedPercent ?? null,
    secondaryWindowMinutes: snapshot.secondary?.windowMinutes ?? null,
    secondaryResetsAt: snapshot.secondary?.resetsAt ?? null,
    sourceFile,
    rawJson: snapshot.rawJson,
    updatedAt: new Date().toISOString(),
  };

  db.insert(providerUsageSnapshots)
    .values(row)
    .onConflictDoUpdate({ target: providerUsageSnapshots.provider, set: row })
    .run();
}

/**
 * Persist a LIVE app-server poll into the same snapshot row the rollout scan
 * feeds, so the fallback chain stays single-source: after a restart (or if the
 * codex CLI disappears) the freshest quota the UI can fall back to is whatever
 * poll or rollout wrote last.
 *
 * `capturedAt` is Arij's wall clock — a live poll is "now", which is always >=
 * any rollout file's provider event time, so the forward-only guard in
 * `storeSnapshot` composes correctly (an old rollout can never clobber a live
 * poll; a newer rollout scan after 2 minutes legitimately can... except it
 * can't either, because rollout timestamps are past events). The snapshot
 * columns keep single-limit semantics — the "codex" bucket (or buckets[0]) —
 * which is all the fallback path renders; multi-bucket detail lives only in
 * `rawJson`.
 *
 * Best-effort: a locked database logs one warning and returns. Never throws.
 */
export function storeCodexLiveSnapshot(
  quota: CodexLiveQuota,
  rawRateLimitsJson: string,
): void {
  try {
    const bucket =
      quota.buckets.find((entry) => entry.limitId === "codex") ??
      quota.buckets[0];
    if (!bucket) return; // parser guarantees >=1 bucket; belt and braces

    storeSnapshot(
      {
        capturedAt: new Date().toISOString(),
        planType: quota.planType,
        primary: {
          usedPercent: bucket.usedPercent,
          windowMinutes: bucket.windowDurationMins,
          resetsAt: bucket.resetsAtUnix,
        },
        secondary: bucket.secondary
          ? {
              usedPercent: bucket.secondary.usedPercent,
              windowMinutes: bucket.secondary.windowDurationMins,
              resetsAt: bucket.secondary.resetsAtUnix,
            }
          : null,
        rawJson: rawRateLimitsJson,
      },
      // Provenance marker, not a path — the column is free text.
      "live:codex-app-server",
    );
  } catch (error) {
    console.warn("[usage] codex live snapshot store failed:", error);
  }
}

/**
 * Best-effort refresh of the codex quota snapshot (refresh-on-read; called
 * from `GET /api/usage`, never from the session lifecycle).
 *
 * Tries candidates newest-first and stops at the first file that yields a
 * snapshot. Everything is wrapped: a missing `~/.codex`, a truncated file or
 * a locked database logs one warning and returns — rendering the Usage page
 * must never fail because the codex tree is absent.
 */
export function refreshCodexUsageSnapshot(root?: string): void {
  try {
    for (const filePath of findRecentRolloutFiles(root)) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      const snapshot = extractLatestRateLimitSnapshot(content);
      if (!snapshot) continue;
      // Absolute so the stored provenance stays meaningful regardless of the
      // process cwd at scan time.
      storeSnapshot(snapshot, path.resolve(filePath));
      return;
    }
  } catch (error) {
    console.warn("[usage] codex rate-limit snapshot refresh failed:", error);
  }
}
