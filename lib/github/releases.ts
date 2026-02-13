import { getGitHubTokenFromSettings, createGitHubClient } from "@/lib/github/client";

function getOctokit() {
  const token = getGitHubTokenFromSettings();
  if (!token) {
    throw new Error("GitHub PAT not configured. Set it in project settings.");
  }
  return createGitHubClient(token);
}

export interface GitHubReleaseResult {
  id: number;
  htmlUrl: string;
  url: string;
  draft: boolean;
  tagName: string;
}

/**
 * Creates a draft GitHub release for a tag.
 */
export async function createDraftRelease(params: {
  owner: string;
  repo: string;
  tag: string;
  title: string;
  body: string;
}): Promise<GitHubReleaseResult> {
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.createRelease({
    owner: params.owner,
    repo: params.repo,
    tag_name: params.tag,
    name: params.title,
    body: params.body,
    draft: true,
  });
  return {
    id: data.id,
    htmlUrl: data.html_url,
    url: data.html_url,
    draft: data.draft,
    tagName: data.tag_name,
  };
}

/**
 * Publishes a draft GitHub release (sets draft=false).
 */
export async function publishRelease(params: {
  owner: string;
  repo: string;
  releaseId: number;
}): Promise<GitHubReleaseResult> {
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.updateRelease({
    owner: params.owner,
    repo: params.repo,
    release_id: params.releaseId,
    draft: false,
  });
  return {
    id: data.id,
    htmlUrl: data.html_url,
    url: data.html_url,
    draft: data.draft,
    tagName: data.tag_name,
  };
}

/**
 * Gets a release from GitHub by its ID.
 */
export async function getRelease(params: {
  owner: string;
  repo: string;
  releaseId: number;
}): Promise<GitHubReleaseResult> {
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.getRelease({
    owner: params.owner,
    repo: params.repo,
    release_id: params.releaseId,
  });
  return {
    id: data.id,
    htmlUrl: data.html_url,
    url: data.html_url,
    draft: data.draft,
    tagName: data.tag_name,
  };
}
