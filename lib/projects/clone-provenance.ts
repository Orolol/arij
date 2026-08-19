import { readCloneMarker } from "@/lib/git/clone-marker";
import { isInsideProjectsRoot, resolveProjectsRoot } from "./workspace";

/**
 * Server-side derivation of a project's provenance.
 *
 * `clone_source` decides whether Arij may one day delete a directory, so it is
 * established by looking at the disk, never by believing the request that
 * creates the project. A client can name any path it likes; what it cannot do
 * is put Arij's clone marker inside a directory Arij did not clone.
 *
 * Both conditions have to hold: the path is inside the *current* projects root,
 * and the directory carries a marker. The marker alone would let a clone that
 * has since been moved out of the root keep its deletion rights; the root alone
 * would hand them to any checkout the user happens to keep there.
 */

/** The `clone_source` value that marks a directory as Arij-created. */
export const GITHUB_CLONE_SOURCE = "github";

export interface DerivedCloneProvenance {
  /** `"github"` when Arij created this directory, else null. */
  cloneSource: string | null;
  /** Clean clone URL recorded at clone time; null when not Arij-managed. */
  gitRemoteUrl: string | null;
  /** `owner/repo` recorded at clone time; null when not Arij-managed. */
  githubOwnerRepo: string | null;
}

const UNMANAGED: DerivedCloneProvenance = {
  cloneSource: null,
  gitRemoteUrl: null,
  githubOwnerRepo: null,
};

export function deriveCloneProvenance(
  gitRepoPath: string | null | undefined,
  options: { projectsRoot?: string } = {}
): DerivedCloneProvenance {
  const repoPath = gitRepoPath?.trim();
  if (!repoPath) return UNMANAGED;

  const projectsRoot = options.projectsRoot ?? resolveProjectsRoot();
  if (!isInsideProjectsRoot(repoPath, projectsRoot)) return UNMANAGED;

  const marker = readCloneMarker(repoPath);
  if (!marker) return UNMANAGED;

  return {
    cloneSource: GITHUB_CLONE_SOURCE,
    gitRemoteUrl: marker.remoteUrl || null,
    githubOwnerRepo: marker.ownerRepo || null,
  };
}
