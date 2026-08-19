import type { ParsedGitHubRepoInput } from "@/lib/git/remote";

/**
 * Contract between the parsing/validation layer and the clone service.
 *
 * The service body lands with the "Service de clone git" epic; this module
 * defines the seam it fills so `POST /api/projects/clone` already calls a real
 * dependency instead of echoing its input back. Only a strictly validated
 * `ParsedGitHubRepoInput` can be handed over, so the git layer never sees an
 * owner/repo pair that has not been through `parseGitHubRepoInput()`.
 */

export interface CloneGitHubRepoOptions {
  /** Already validated by parseGitHubRepoInput() — never raw user input. */
  repo: ParsedGitHubRepoInput;
  /** Branch to check out; the repository default branch when null. */
  branch?: string | null;
}

export interface CloneGitHubRepoResult {
  /** Absolute path of the clone; becomes projects.git_repo_path. */
  path: string;
  ownerRepo: string;
  /** Clean HTTPS remote — never carries a token. */
  remoteUrl: string;
  defaultBranch: string;
  /** True when an existing clone with a matching origin was fetched instead. */
  reused: boolean;
}

export class CloneServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneServiceUnavailableError";
  }
}

export async function cloneGitHubRepo(
  options: CloneGitHubRepoOptions
): Promise<CloneGitHubRepoResult> {
  throw new CloneServiceUnavailableError(
    `Clone service is not available yet (requested ${options.repo.ownerRepo}).`
  );
}
