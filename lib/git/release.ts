import fs from "fs";
import path from "path";
import simpleGit from "simple-git";

export interface ReleaseBranchResult {
  releaseBranch: string;
  changelogCommitted: boolean;
  commitHash: string | null;
}

/**
 * Picks the branch a release branches off.
 *
 * `preferred` is the project's stored `default_branch` (set by a GitHub
 * import). When it still exists locally it wins — falling back to
 * `branches[0]` instead could pick a feature branch on a repo with a
 * non-main/master default. Otherwise `main` → `master` keep priority so
 * existing repos behave exactly as before.
 */
function pickBaseBranch(branches: string[], preferred?: string): string {
  if (preferred && branches.includes(preferred)) return preferred;
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";
  if (branches.length > 0) return branches[0];
  throw new Error("No local branches found in repository.");
}

export async function createReleaseBranchAndCommitChangelog(
  repoPath: string,
  version: string,
  changelog: string,
  preferredBaseBranch?: string
): Promise<ReleaseBranchResult> {
  const git = simpleGit(repoPath);
  const releaseBranch = `release/v${version}`;

  const branchSummary = await git.branchLocal();
  const originalBranch = branchSummary.current;
  const baseBranch = pickBaseBranch(
    branchSummary.all,
    preferredBaseBranch
  );

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
