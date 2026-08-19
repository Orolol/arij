import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { resolveRemoteDefaultBranch } from "./remote";

export interface ReleaseBranchResult {
  releaseBranch: string;
  changelogCommitted: boolean;
  commitHash: string | null;
}

/**
 * `origin/HEAD` first — a repository whose default is `trunk` or `develop` is
 * not served by the main/master convention — then the convention, then
 * whatever branch exists. The remote's answer only counts when the branch is
 * present locally, since that is what gets checked out.
 */
async function pickBaseBranch(
  repoPath: string,
  branches: string[]
): Promise<string> {
  const remoteDefault = await resolveRemoteDefaultBranch(repoPath);
  if (remoteDefault && branches.includes(remoteDefault)) return remoteDefault;

  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";
  if (branches.length > 0) return branches[0];
  throw new Error("No local branches found in repository.");
}

export async function createReleaseBranchAndCommitChangelog(
  repoPath: string,
  version: string,
  changelog: string
): Promise<ReleaseBranchResult> {
  const git = simpleGit(repoPath);
  const releaseBranch = `release/v${version}`;

  const branchSummary = await git.branchLocal();
  const originalBranch = branchSummary.current;
  const baseBranch = await pickBaseBranch(repoPath, branchSummary.all);

  try {
    const branchExists = branchSummary.all.includes(releaseBranch);
    if (branchExists) {
      await git.checkout(releaseBranch);
    } else {
      await git.checkout(baseBranch);
      await git.checkoutLocalBranch(releaseBranch);
    }

    const changelogPath = path.join(repoPath, "CHANGELOG.md");
    fs.writeFileSync(changelogPath, `${changelog.trim()}\n`, "utf-8");

    await git.add(["CHANGELOG.md"]);
    const statusAfterStage = await git.status();
    const hasChange =
      statusAfterStage.staged.length > 0 ||
      statusAfterStage.created.length > 0 ||
      statusAfterStage.modified.length > 0;

    if (!hasChange) {
      return {
        releaseBranch,
        changelogCommitted: false,
        commitHash: null,
      };
    }

    await git.commit(`docs(release): add changelog for v${version}`);
    const last = await git.log({ maxCount: 1 });

    return {
      releaseBranch,
      changelogCommitted: true,
      commitHash: last.latest?.hash ?? null,
    };
  } finally {
    if (originalBranch && originalBranch !== releaseBranch) {
      await git.checkout(originalBranch);
    }
  }
}
