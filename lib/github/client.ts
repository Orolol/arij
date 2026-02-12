import { Octokit } from "@octokit/rest";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const GITHUB_TOKEN_KEY = "github_pat";

/**
 * Retrieves the GitHub PAT from the settings table.
 * Returns null if not configured.
 */
export function getGitHubToken(): string | null {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, GITHUB_TOKEN_KEY))
    .get();

  if (!row) return null;

  try {
    const value = JSON.parse(row.value);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Creates an authenticated Octokit instance using the stored PAT.
 * Throws if no token is configured.
 */
export function createOctokit(): Octokit {
  const token = getGitHubToken();
  if (!token) {
    throw new Error("GitHub PAT not configured. Set it in Settings.");
  }
  return new Octokit({ auth: token });
}

/**
 * Parses an "owner/repo" string into its components.
 * Throws if the format is invalid.
 */
export function parseOwnerRepo(ownerRepo: string): {
  owner: string;
  repo: string;
} {
  const parts = ownerRepo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid GitHub owner/repo format: "${ownerRepo}". Expected "owner/repo".`
    );
  }
  return { owner: parts[0], repo: parts[1] };
}

/**
 * Validates that the stored token can authenticate with the GitHub API.
 * Returns the authenticated username on success, null on failure.
 */
export async function validateToken(): Promise<string | null> {
  try {
    const octokit = createOctokit();
    const { data } = await octokit.users.getAuthenticated();
    return data.login;
  } catch {
    return null;
  }
}
