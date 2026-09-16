# Bundled Pi

`pi` resolves to `BundledPiProvider`, which runs Arij's own Node executable
and `bin/arij-pi.mjs`. The launcher resolves `@arij/pi` relative to the app,
so agent worktree cwd and PATH cannot select an unrelated upstream Pi.
Node >=22.19 is required by the fork. Other provider choices and assignments
are preserved.

## Fork and distribution

Source: [Orolol/pi, arij branch](https://github.com/Orolol/pi/tree/arij).
Base: upstream v0.85.1 (`d981de1229ef899957bbe968bc8dcda02a21f477`).
The fork's `scripts/pack-arij.mjs` packages its built CLI as
`@arij/pi@0.85.1-arij.1`. `package.json` depends on the versioned GitHub release
asset; an identical copy is checked into `vendor/arij-pi-0.85.1-arij.1.tgz`.
The release URL also works when installing Arij's npm package outside a clone
(npm cannot resolve nested local tarball dependencies reliably).
The lockfile pins its integrity and runtime
dependencies. The package's `arijFork` metadata records upstream/source commits.
`npm ci` installs it without compiling the fork or installing Pi globally.

To update, follow `ARIJ.md` in the source fork: install its locked dependencies,
hydrate model data, build, run checks and MCP/CLI tests, commit the source,
and run `node scripts/pack-arij.mjs /path/to/arji/vendor`. Publish that artifact
on a versioned release in Orolol/pi. Update the dependency URL and lockfile,
then run the Arij provider and integration tests. Change the
fork package revision when publishing a new artifact.

## Session contract

- Every prompt goes through stdin, including prompts over the argv limit or
  beginning with `-` / `@`. The command log contains no prompt text.
- A unique 0700 temporary directory contains a 0600 MCP config. The file is
  removed on completion, cancellation or spawn error. Secrets are absent
  from argv and the CLI environment; stdio server env and HTTP headers carry
  only their own configured credentials.
- The MCP file is the complete server list. No MCP files are written into
  worktrees or user-global registries. Global and project-scoped extras work.
- Tools use `mcp__server__tool`. The Arij channel is narrowed to its per-session
  allowedToolNames; extra servers preserve their toolAllowlist, including an
  empty list. Schema, text/image content, structured content and errors survive
  the bridge. Tools/list pagination and cancellation are supported.
- A configured server failing initialization fails the run before model work.
- `--no-builtin-tools` starts with built-ins disabled; Arij explicitly loads
  `bin/arij-pi-runtime.mjs`, which activates the per-session policy and also
  refuses unauthorized calls at execution time. Plan/chat: read, grep, find,
  ls. Analyze adds write; code adds write, edit, bash and Task. Custom
  `allowedTools` are mapped to Pi's names and intersected with this bound.
  Unknown names fail the spawn. Discovered extensions stay disabled.
- NDJSON carries raw events, usage and the real session ID. The final result
  is the last assistant message. `--session` resumes it; each resumed process
  receives a fresh MCP config. JSON model errors return a non-zero exit code.
- BaseCliProvider owns cancellation of the process group and cleanup.
- Live deltas/status/questions reach the chat SSE stream. Raw events remain
  available on agent sessions; completed assistant usage (including cache
  input and Task children) is normalized for the existing usage dashboard.
  MCP `toolCall` records feed the same action timeline as Claude's `tool_use`.

## Chat, delegation and permissions

`pi-persistent` is a selectable conversation mode. It uses the fork's RPC
protocol, probes `get_state` before sending the first prompt, and reuses the
process between turns. Idle eviction, stall detection, cancellation and
restart release the MCP token and private config. A cwd/model/mode/options
change invalidates the warm process. Normal chat also streams; expired-session
fallback retains named-agent options. Exact UUIDs are resolved to session files
inside the fork's own store for headless resumption across worktrees. Legacy
upstream `~/.pi` sessions are not silently imported.

`AskUserQuestion` exposes the same question/options/multi-select schema as
Claude's chat forms. The tool presents questions, then instructs the model to
end its turn; user answers arrive through the next chat message. It does not
fabricate answers or hold an invisible permission dialog open. Workflow
`ask_question` remains available independently through Arij MCP.

`Task` starts a real Pi child with a separate session, the requested worktree,
the parent's model/thinking setting and the same MCP/tool restrictions. At most
four children run simultaneously, for at most 30 minutes each; children cannot
delegate recursively. Cancellation reaches the process group. Child errors
are failed tool results and child usage is included in the coordinator's cost.
The existing team-build route accepts Pi as well as Claude Code.

Named-agent `permission_mode` is limited to code-producing agents, as on Claude.
These are deterministic **headless policies**, not Claude's proprietary automatic
permission classifier: `auto`/`acceptEdits` permit file edits but require an
explicit Bash allowlist entry for shell commands; `manual`/`dontAsk` deny
mutating tools unless explicitly allowlisted. `bypassPermissions` allows the
mode's tools, still intersected with an explicit allowlist. No option expands
plan/chat/analyze permissions. MCP servers retain their own explicit toolsets.

Authentication is a user setup step (`arij pi` then `/login`, or provider API
keys). It is separate from CLI availability. Config/credentials/sessions default
to `~/.arij-pi/agent` and can be redirected with `PI_CODING_AGENT_DIR`.

## Verification and limits

`bundled-pi-launcher.test.ts` checks archive integrity and hoisted dependency
resolution. `bundled-pi.test.ts` covers mode mapping, private files, simultaneous spawns,
long prompt transport, exact tool allowlists and cleanup. `bundled-pi-e2e.test.ts`
launches the installed fork with a local fake model endpoint and the real
Arij MCP shim: tool discovery/calls, restricted tools, session resume, model
errors and cancellation. No paid model or real board mutation is involved.
`bundled-pi-parity-e2e.test.ts` verifies actual child writes in a separate
worktree, child error/usage propagation, image payloads, structured questions,
RPC warm reuse (including recovery after model errors), cross-worktree cold
resume and cancellation with a fake model.
`pi-runtime.test.mjs` checks the child concurrency cap, policy inheritance and
cancellation; `pi-parity.test.ts` checks streaming, usage and action parsing.

The fork supports MCP tools over stdio and Streamable HTTP. Legacy SSE,
HTTP OAuth enrollment and standalone MCP resource/prompt browsers are not
implemented. Tools must fit the 64-character model API name limit.
Built-in restrictions are not an OS sandbox; configured MCP servers and the
user's process privileges determine the actual filesystem/network access.
This integration targets Arij workflows, not binary compatibility with Claude
plugins/hooks or identical model output. Image understanding depends on the
selected model supporting vision.
