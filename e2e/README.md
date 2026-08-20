# End-to-end suite

```
npm run test:e2e
```

Playwright starts `next dev` itself (port 3100 by default) and drives the real
routes — no mocked fetches. Two things about this host are worth knowing before
the first run.

## The browser is the system Chrome

`npx playwright install chromium` fails here:

```
Playwright does not support chromium on ubuntu26.04-x64
```

So `playwright.config.ts` sets `channel: "chrome"` and uses the Chrome already
installed at `/usr/bin/google-chrome`. Where the bundled build *is*
installable (CI, other distros), `PLAYWRIGHT_CHANNEL= npm run test:e2e` opts
back into it.

## Reuse a dev server that is already running

Next 16 holds a lock on `.next/dev`, so a second `next dev` in the same
directory refuses to start:

```
Unable to acquire lock at .../.next/dev/lock, is another instance of next dev running?
```

If a dev server is already up for this worktree, point the suite at it instead
of letting it spawn its own — `reuseExistingServer` then finds it and skips the
spawn entirely:

```
E2E_PORT=3199 npm run test:e2e
```

## Test data

Every spec that needs a board uses the `project` fixture
(`e2e/fixtures/arij-project.ts`): it creates its own project against a scratch
git repo under the OS temp directory, and deletes both afterwards. Tests never
share a board, so they stay safe under `fullyParallel`, and the `arji.json`
export a board write triggers lands in the scratch repo rather than in this one.
