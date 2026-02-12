import { Octokit } from "@octokit/rest";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

let cachedOctokit: Octokit | null = null;
let cachedToken: string | null = null;

/**
 * Reads the GitHub PAT from the settings table.
 */
function getStoredToken(): string | null {
  const row = db.select().from(settings).where(eq(settings.key, "github_pat")).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as string;
  } catch {
    return row.value;
  }
}

/**
 * Returns an authenticated Octokit instance.
 * Throws if no GitHub PAT is configured.
 */
export function getOctokit(): Octokit {
  const token = getStoredToken();
  if (!token) {
    throw new Error("GitHub PAT not configured. Set it in Settings > GitHub.");
  }

  // Return cached instance if the token hasn't changed
  if (cachedOctokit && cachedToken === token) {
    return cachedOctokit;
  }

  cachedOctokit = new Octokit({ auth: token });
  cachedToken = token;
  return cachedOctokit;
}

/**
 * Validates a GitHub PAT by calling the GitHub API.
 * Returns the validity status and the associated login.
 */
export async function validateToken(
  token: string
): Promise<{ valid: boolean; login?: string }> {
  try {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.users.getAuthenticated();
    return { valid: true, login: data.login };
  } catch {
    return { valid: false };
  }
}
