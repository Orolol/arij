# Importing a project from a GitHub URL

Arij can attach a project to a directory that already exists on disk, or clone
one from GitHub itself. This document covers the second path: what runs, where
the code lands, and which invariants the implementation is defending.

## Flow

```
User pastes a GitHub URL          app/projects/import/page.tsx
        |
        v
POST /api/projects/clone          app/api/projects/clone/route.ts
  parseGitHubRepoInput(url)   ->  { owner, repo, ownerRepo, cloneUrl }
  cloneDestinationFor(...)    ->  <projects_root>/<owner>-<repo>
  cloneRepository(...)        ->  git clone (or fetch, if already there)
  -> { path, ownerRepo, remoteUrl, defaultBranch, reused }
        |
        v
POST /api/projects/import         unchanged: arij.json short-circuit,
  validatePath(path)              otherwise Claude analysis
  -> { preview, path, fromExistingFile }
        |
        v
POST /api/projects                + githubOwnerRepo, cloneSource,
                                    gitRemoteUrl, defaultBranch
  then epics, user stories, arij.json export
```

Cloning is a separate endpoint from analysis on purpose. The analysis route
stays unaware that clones exist, the two steps are independently testable, and
the UI can name them honestly — a multi-minute clone reported as "Analyzing"
reads as a hang.

## Where the code lands

```
<arij>/
  data/                    # SQLite DB, session logs   (gitignored)
  projects/                # clone root                (gitignored)
    <owner>-<repo>/        # the clone -> projects.git_repo_path
    .arij-worktrees/       # created by createWorktree()
```

The root is resolved by `resolveProjectsRoot()` (`lib/projects/workspace.ts`):
the `projects_root` setting when present, otherwise `<cwd>/projects`. A
relative override is resolved against the working directory, so a clone
destination never depends on where the server was started from.

`createWorktree()` places worktrees at `path.join(repoPath, "..",
".arij-worktrees")`. With the clone at `projects/<owner>-<repo>`, they land in
`projects/.arij-worktrees` — which is why a single `/projects` rule in
`.gitignore` is enough to keep Arij's own repository clean when dogfooding.

The `<owner>-<repo>` name is deterministic and collision-free across owners,
which is what makes re-importing the same repository idempotent.

## Full clones only

There is no `--depth` and no `--single-branch`, and there must not be: Arij
creates worktrees from the default branch, computes merge bases when merging
epic branches, and tags releases (`lib/git/manager.ts`, `lib/git/release.ts`).
A shallow clone breaks `worktree add` and merge-base computation, and a
single-branch clone hides every branch the user might want to work from.

`__tests__/git-clone-command.test.ts` asserts the absence of both flags in the
generated argv, so a future "optimisation" fails the suite rather than
production.

## Credentials

The PAT lives in the `settings` table (`github_pat`), read by
`getGitHubTokenFromSettings()`. The `GITHUB_TOKEN` environment variable is
documented in some older notes but is not read by any code path.

The clone runs as:

```
git -c http.extraHeader="Authorization: Basic <base64(x-access-token:PAT)>" \
    clone -- <clean-https-url> <dest>
```

Passing the header with `-c` scopes it to that one command: it never reaches
`.git/config`, and `origin` keeps the clean URL, so the clone is exactly what a
hand-made one would be and no secret is stored on disk. Public repositories
clone with no token at all.

The cost of that choice is that the credential has to be re-supplied by every
later command that talks to the remote. The reuse path does so: refreshing an
existing clone runs `git -c http.extraHeader=… fetch origin`, with prompts
disabled (`GIT_TERMINAL_PROMPT=0`) and the same timeout as the clone — an
unauthenticated fetch of a private repository would otherwise block on a
credential prompt with no terminal attached, which is a hang rather than an
error.

> **Known gap.** `pushGitBranch()`, `pullGitBranchWithConflictSupport()` and
> the release tagging in `lib/git/remote.ts` / `lib/git/release.ts` still run
> unauthenticated. They predate the import flow and are unaffected by it, but a
> private repository imported this way will need a credential helper for push
> until they route through the same authenticated transport.

## Default branch

`projects.default_branch` records what the *remote* considers default, read
from the `origin/HEAD` symbolic ref (`resolveRemoteDefaultBranch()` in
`lib/git/remote.ts`) — not whatever happens to be checked out, which for a
reused clone is simply where the user left it.

This matters beyond display: `createWorktree()` and `mergeWorktree()` base epic
branches on it. Both used to guess `main`-else-`master`, so a repository whose
default is `trunk` or `develop` imported cleanly and then failed at
`worktree add` against a branch that does not exist. They now ask `origin/HEAD`
first and fall back to the old convention only when there is no remote to ask.

Every string that can leave the clone layer — the HTTP response, the console
line, the `git_sync_log` row — goes through `redactGitError()`, which strips
the injected `Basic` header, URL userinfo, bearer tokens, raw GitHub token
shapes, and any exact secret the caller passes in.

## Safety properties

| Property | Where it is enforced |
|---|---|
| A pasted string can never escape the clone root | `parseGitHubRepoInput()` re-validates owner and repo against `^[A-Za-z0-9._-]+$`, rejecting the `.` and `..` components and a leading `-`. Dots *inside* a name are legal GitHub characters (`repo..archive`) and stay accepted: the character class excludes every separator, so such a name is still one directory below the root |
| …even if it did | `assertInsideRoot()` (`lib/projects/workspace-path.ts`) resolves the destination and refuses anything that is not a strict descendant of the root |
| An existing directory is never overwritten | matching repository → fetch and reuse; anything else → `409 conflict` naming what is in the way |
| A failed clone leaves nothing behind | the destination is removed, but only when this service created it |
| Two concurrent imports of one repo do not race | clones are serialized per destination |
| Only Arij-created directories are Arij's to delete | `projects.clone_source = 'github'`; `NULL` for user-supplied paths. `POST /api/projects` will not take the flag on trust: it recomputes `<projects_root>/<owner>-<repo>` and refuses the claim for any other path, so a request cannot mark a directory the user owns as Arij's |
| A stored remote URL never carries a credential | `POST /api/projects` re-parses `gitRemoteUrl` and stores the normalised `https://github.com/<owner>/<repo>.git`; a URL with userinfo does not parse and is rejected |

## Data model

Migration `0027_project_clone_source` adds three nullable columns to
`projects`: `clone_source`, `git_remote_url`, `default_branch`. Existing rows
keep `NULL` and behave exactly as before.

Migration `0028_git_sync_log_nullable_project` makes `git_sync_log.project_id`
nullable: a clone is logged before any project row exists, so the audit row for
`operation = 'clone'` has no project to point at.

Both are hand-written. `npx drizzle-kit generate` must not be run on this
repository — the snapshots under `meta/` stop at 0013 while the journal is far
ahead, so generate would diff against stale state.

## Out of scope

Non-GitHub hosts (GitLab, Bitbucket, self-hosted), SSH-key-based clones of
private repositories, background/queued cloning with cancellation, and
monorepo sub-directory imports. The parsing layer is written so a second host
can be added without touching the clone service.

## Tests

| Area | File |
|---|---|
| URL parsing, traversal payloads | `__tests__/github-url-parse.test.ts` |
| Clone root, destination, containment | `__tests__/projects-workspace.test.ts`, `__tests__/workspace-path-guard.test.ts` |
| git argv, cleanup, error classification (simple-git mocked) | `__tests__/git-clone-command.test.ts` |
| Real clones against local `file://` repositories | `__tests__/git-clone-service.test.ts` |
| Redaction | `__tests__/git-clone-redaction.test.ts` |
| Clone route: statuses, reuse, sync log, no PAT leak | `__tests__/projects-clone-route.test.ts` |
| Project creation: provenance, ownership checks, path normalisation | `__tests__/projects-route-post.test.ts` |
| Base-branch resolution from `origin/HEAD` | `__tests__/worktree-manager.test.ts` |
| Import page in jsdom | `__tests__/import-github-source.test.tsx` |
| Import page in a browser | `e2e/project-import.spec.ts` |

No test performs a network clone: the service suite clones from local
temporary repositories over `file://`, and everything else mocks `simple-git`
or stubs the endpoints.
