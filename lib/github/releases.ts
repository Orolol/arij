import { getOctokit } from "@/lib/github/client";

/**
 * Creates a draft GitHub release for a tag.
 */
export async function createDraftRelease(params: {
  owner: string;
  repo: string;
  tag: string;
  title: string;
  body: string;
}): Promise<{ id: number; url: string }> {
  const octokit = getOctokit();
  const { data } = await octokit.repos.createRelease({
    owner: params.owner,
    repo: params.repo,
    tag_name: params.tag,
    name: params.title,
    body: params.body,
    draft: true,
  });
  return { id: data.id, url: data.html_url };
}

/**
 * Publishes a draft GitHub release.
 */
export async function publishRelease(params: {
  owner: string;
  repo: string;
  releaseId: number;
}): Promise<{ url: string }> {
  const octokit = getOctokit();
  const { data } = await octokit.repos.updateRelease({
    owner: params.owner,
    repo: params.repo,
    release_id: params.releaseId,
    draft: false,
  });
  return { url: data.html_url };
}
