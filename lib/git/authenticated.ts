import { nonInteractiveEnv } from "./non-interactive";
import simpleGit from "simple-git";
import { getGitHubTokenFromSettings } from "@/lib/github/client";
import { redactedErrorMessage } from "./redact";

/** Ephemeral, host-scoped credentials: never persisted in .git/config. */
export async function runAuthenticatedGit(
  repoPath: string, args: string[],
  options: { token?: string | null; signal?: AbortSignal } = {},
): Promise<string> {
  const token = options.token === undefined ? getGitHubTokenFromSettings() : options.token;
  const config = token?.trim() ? ["-c", `http.https://github.com/.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token.trim()}`).toString("base64")}`] : [];
  try {
    return await simpleGit({ baseDir: repoPath, abort: options.signal, unsafe: { allowUnsafeAskPass: true } })
      .env(nonInteractiveEnv()).raw([...config, ...args]);
  } catch (error) {
    throw new Error(redactedErrorMessage(error, "Git operation failed"));
  }
}

