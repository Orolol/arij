import { describe, expect, it, vi } from "vitest";
import type { SimpleGit } from "simple-git";

/**
 * Which branch new work is based on.
 *
 * The old rule was `includes("main") ? "main" : "master"`, which silently
 * picked a branch that does not exist for any repository on `develop` or
 * `trunk` — the clone succeeded and the first `worktree add` failed. These
 * tests pin the order the replacement asks its questions in: what the project
 * recorded, then what the remote says, then the historical guess.
 */

import { resolveBaseBranch } from "@/lib/git/base-branch";

/** A git double whose only interesting answer is `origin/HEAD`. */
function git(originHead: string | null): SimpleGit {
  return {
    raw: vi.fn(async (args: string[]) => {
      if (args.includes("symbolic-ref")) {
        if (!originHead) throw new Error("ref does not exist");
        return `origin/${originHead}\n`;
      }
      return "";
    }),
  } as unknown as SimpleGit;
}

describe("resolveBaseBranch", () => {
  it("prefers the branch recorded for the project", async () => {
    const branches = ["develop", "main", "master"];

    expect(
      await resolveBaseBranch(git("main"), branches, { preferred: "develop" })
    ).toBe("develop");
  });

  it("ignores a recorded branch that no longer exists locally", async () => {
    // The row can outlive the branch: someone deleted it, or the clone was
    // re-made. Falling through beats failing.
    expect(
      await resolveBaseBranch(git("main"), ["main"], { preferred: "gone" })
    ).toBe("main");
  });

  it("falls back to origin/HEAD when nothing is recorded", async () => {
    expect(await resolveBaseBranch(git("develop"), ["develop", "main"])).toBe(
      "develop"
    );
  });

  it("falls back to main, then master, when the remote says nothing", async () => {
    expect(await resolveBaseBranch(git(null), ["main", "master"])).toBe("main");
    expect(await resolveBaseBranch(git(null), ["master", "topic"])).toBe(
      "master"
    );
  });

  it("uses the only branch there is rather than guessing a missing one", async () => {
    // The case that used to break: no main, no master, no origin/HEAD.
    expect(await resolveBaseBranch(git(null), ["trunk"])).toBe("trunk");
  });

  it("throws when the repository has no branches at all", async () => {
    await expect(resolveBaseBranch(git(null), [])).rejects.toThrow(
      /No local branches/
    );
  });

  it("does not trust origin/HEAD pointing at a branch with no local counterpart", async () => {
    expect(await resolveBaseBranch(git("develop"), ["main"])).toBe("main");
  });
});
