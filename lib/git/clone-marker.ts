import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * The proof that Arij created a directory.
 *
 * Everything destructive in the clone feature — replacing debris at a
 * destination, removing a clone when its project is deleted — is gated on this
 * marker, because the alternatives are all forgeable or ambiguous:
 *
 *  - *"the path is inside the projects root"* only says where the directory is,
 *    not who made it. Users are free to put their own checkouts there.
 *  - *"`origin` points at the expected repository"* is a property of any clone
 *    of that repository, including one the user made by hand.
 *  - *`projects.clone_source`* is a database column reachable from the API, so
 *    it states an intent, not a fact about the disk.
 *
 * The marker lives at `.git/arij-clone.json` rather than in the working tree:
 * git never shows it in `status`, it cannot be committed by accident, it
 * survives every checkout, and it is destroyed with the repository it
 * describes — so it can never outlive the directory it vouches for.
 */

/** Marker file, relative to the repository root. */
export const CLONE_MARKER_RELATIVE_PATH = path.join(".git", "arij-clone.json");

export interface CloneMarker {
  version: 1;
  owner: string;
  repo: string;
  ownerRepo: string;
  /** Clean, credential-free clone URL. */
  remoteUrl: string;
  createdAt: string;
}

export function cloneMarkerPath(repoPath: string): string {
  return path.join(path.resolve(repoPath), CLONE_MARKER_RELATIVE_PATH);
}

export interface WriteCloneMarkerInput {
  owner: string;
  repo: string;
  ownerRepo: string;
  remoteUrl: string;
}

/**
 * Stamps a freshly created clone as Arij-managed.
 *
 * Returns false instead of throwing when the marker cannot be written: the
 * clone itself is still perfectly usable, only the ownership claim is lost. The
 * consequence is conservative in the right direction — an unmarked clone is
 * never deleted and never replaced, so a failed stamp costs disk space, not
 * data.
 */
export async function writeCloneMarker(
  repoPath: string,
  input: WriteCloneMarkerInput
): Promise<boolean> {
  const marker: CloneMarker = {
    version: 1,
    owner: input.owner,
    repo: input.repo,
    ownerRepo: input.ownerRepo,
    remoteUrl: input.remoteUrl,
    createdAt: new Date().toISOString(),
  };

  try {
    await fsp.writeFile(
      cloneMarkerPath(repoPath),
      `${JSON.stringify(marker, null, 2)}\n`,
      "utf-8"
    );
    return true;
  } catch (error) {
    console.warn(
      "[clone] could not stamp the clone marker at",
      repoPath,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

/** Reads the marker, or null when absent, unreadable or malformed. */
export function readCloneMarker(repoPath: string): CloneMarker | null {
  let raw: string;
  try {
    raw = fs.readFileSync(cloneMarkerPath(repoPath), "utf-8");
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CloneMarker>;
    if (
      parsed.version !== 1 ||
      typeof parsed.owner !== "string" ||
      typeof parsed.repo !== "string" ||
      !parsed.owner ||
      !parsed.repo
    ) {
      return null;
    }

    return {
      version: 1,
      owner: parsed.owner,
      repo: parsed.repo,
      ownerRepo:
        typeof parsed.ownerRepo === "string" && parsed.ownerRepo
          ? parsed.ownerRepo
          : `${parsed.owner}/${parsed.repo}`,
      remoteUrl: typeof parsed.remoteUrl === "string" ? parsed.remoteUrl : "",
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    };
  } catch {
    return null;
  }
}

/** True when the directory carries any valid Arij clone marker. */
export function isArijManagedClone(repoPath: string): boolean {
  return readCloneMarker(repoPath) !== null;
}

/**
 * True when the directory is marked as Arij's clone *of this repository*.
 *
 * The owner/repo check matters for the replace path: debris may only be cleared
 * away by a clone of the same repository that created it.
 */
export function hasCloneMarkerFor(
  repoPath: string,
  expected: { owner: string; repo: string }
): boolean {
  const marker = readCloneMarker(repoPath);
  if (!marker) return false;

  return (
    marker.owner.toLowerCase() === expected.owner.toLowerCase() &&
    marker.repo.toLowerCase() === expected.repo.toLowerCase()
  );
}
