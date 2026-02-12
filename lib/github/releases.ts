import { Octokit } from "@octokit/rest";

export interface GitHubReleaseResult {
  id: number;
  htmlUrl: string;
  draft: boolean;
  tagName: string;
}

/**
 * Creates a draft release on GitHub.
 */
export async function createDraftRelease(
  octokit: Octokit,
  owner: string,
  repo: string,
  tag: string,
  title: string,
  body: string
): Promise<GitHubReleaseResult> {
  const { data } = await octokit.repos.createRelease({
    owner,
    repo,
    tag_name: tag,
    name: title,
    body,
    draft: true,
  });

  return {
    id: data.id,
    htmlUrl: data.html_url,
    draft: data.draft,
    tagName: data.tag_name,
  };
}

/**
 * Publishes a draft release on GitHub (sets draft=false).
 */
export async function publishRelease(
  octokit: Octokit,
  owner: string,
  repo: string,
  releaseId: number
): Promise<GitHubReleaseResult> {
  const { data } = await octokit.repos.updateRelease({
    owner,
    repo,
    release_id: releaseId,
    draft: false,
  });

  return {
    id: data.id,
    htmlUrl: data.html_url,
    draft: data.draft,
    tagName: data.tag_name,
  };
}

/**
 * Gets a release from GitHub by its ID.
 */
export async function getRelease(
  octokit: Octokit,
  owner: string,
  repo: string,
  releaseId: number
): Promise<GitHubReleaseResult> {
  const { data } = await octokit.repos.getRelease({
    owner,
    repo,
    release_id: releaseId,
  });

  return {
    id: data.id,
    htmlUrl: data.html_url,
    draft: data.draft,
    tagName: data.tag_name,
  };
}
